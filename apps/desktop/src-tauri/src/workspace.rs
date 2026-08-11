//! Projects, workspaces, sessions, and review snapshots.
//!
//! The TypeScript host returned a single hardcoded project pointing at one
//! developer's home directory. Projects are discovered here instead — still
//! shallow (M5 owns worktrees and lifecycle), but real.

use std::fs;
use std::path::{Path, PathBuf};

use crate::git;
use crate::settings;
use crate::types::{
    AgentSessionSummary, ProjectRef, ReviewSnapshot, WorkspaceStatus, WorkspaceSummary,
};

const MAX_PROJECTS: usize = 60;

fn project_id_for(path: &Path) -> String {
    path.to_string_lossy()
        .trim_matches('/')
        .replace(['/', ' ', '.'], "-")
        .to_lowercase()
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// How far below the scan root to look for repositories. Two levels covers the
/// common `workspace/category/repo` layout without turning into a full-disk
/// crawl; a repository is never descended into, so nested vendored checkouts
/// stay invisible.
const MAX_PROJECT_DEPTH: usize = 2;

const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "Library"];

/// Git repositories at or below the scan root, breadth-first.
pub fn list_projects() -> Vec<ProjectRef> {
    let root = settings::scan_root(&settings::read());
    let mut projects = Vec::new();

    if git::is_repo(&root) {
        projects.push(project_for(&root));
        return projects;
    }

    let mut frontier = vec![root.clone()];
    for _ in 0..MAX_PROJECT_DEPTH {
        let mut next = Vec::new();
        for directory in frontier {
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            let mut children: Vec<PathBuf> = entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .filter(|path| {
                    path.file_name()
                        .map(|name| {
                            let name = name.to_string_lossy();
                            !name.starts_with('.') && !SKIPPED_DIRS.contains(&name.as_ref())
                        })
                        .unwrap_or(false)
                })
                .collect();
            children.sort();

            for child in children {
                if projects.len() >= MAX_PROJECTS {
                    return projects;
                }
                if git::is_repo(&child) {
                    // A repository is a leaf: whatever it vendors is its business.
                    projects.push(project_for(&child));
                } else {
                    next.push(child);
                }
            }
        }
        frontier = next;
    }

    // Never show nothing: an un-versioned scan root is still somewhere to work.
    if projects.is_empty() {
        projects.push(project_for(&root));
    }
    projects
}

fn project_for(path: &Path) -> ProjectRef {
    ProjectRef {
        id: project_id_for(path),
        name: display_name(path),
        root_path: path.to_string_lossy().into_owned(),
        main_branch: git::base_branch(path),
    }
}

/// Where Artemis puts worktrees it creates.
///
/// Outside the repository on purpose: a worktree inside the checkout shows up
/// in its own `git status`, in editor file trees, and in every glob the agent
/// runs.
pub fn worktrees_root(project_id: &str) -> PathBuf {
    std::env::var_os("ARTEMIS_WORKTREES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::scanner::home_dir().join(".artemis/worktrees"))
        .join(project_id)
}

fn workspace_id_for(project_id: &str, path: &Path) -> String {
    let leaf = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "root".to_string());
    let cleaned: String = leaf
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("ws-{project_id}-{}", cleaned.to_lowercase())
}

fn summarise(project: &ProjectRef, worktree: &git::Worktree) -> WorkspaceSummary {
    let path = &worktree.path;
    let exists = path.is_dir();
    let changed = git::changed_file_count(path);

    WorkspaceSummary {
        id: if worktree.is_main {
            format!("ws-{}", project.id)
        } else {
            workspace_id_for(&project.id, path)
        },
        project_id: project.id.clone(),
        // The main checkout carries the project's name; a worktree carries its
        // branch, which is what distinguishes it.
        name: if worktree.is_main {
            project.name.clone()
        } else {
            worktree
                .branch
                .clone()
                .unwrap_or_else(|| "detached".to_string())
        },
        branch: match &worktree.branch {
            Some(name) => name.clone(),
            None => "detached HEAD".to_string(),
        },
        worktree_path: path.to_string_lossy().into_owned(),
        // A directory git still lists but that is no longer on disk needs
        // attention rather than looking ready.
        status: if exists {
            WorkspaceStatus::Ready
        } else {
            WorkspaceStatus::NeedsAttention
        },
        active_session_ids: Vec::new(),
        changed_file_count: changed.unwrap_or(0),
        last_activity_at: chrono::Utc::now().to_rfc3339(),
    }
}

/// Every workspace: each project's checkout plus each of its worktrees.
///
/// Worktrees come from git's own list, so ones created outside Artemis appear
/// without being registered anywhere.
pub fn list_workspaces(project_id: Option<&str>) -> Vec<WorkspaceSummary> {
    list_projects()
        .into_iter()
        // `Option::is_none_or` would read better but is stable only since 1.82;
        // the crate's MSRV is 1.77.
        .filter(|project| project_id.map_or(true, |wanted| wanted == project.id))
        .flat_map(|project| {
            let root = PathBuf::from(&project.root_path);

            if !git::is_repo(&root) {
                // No invented branch name: a non-repository says so.
                return vec![WorkspaceSummary {
                    id: format!("ws-{}", project.id),
                    project_id: project.id.clone(),
                    name: project.name.clone(),
                    branch: "not a git repository".to_string(),
                    worktree_path: project.root_path.clone(),
                    status: WorkspaceStatus::NeedsAttention,
                    active_session_ids: Vec::new(),
                    changed_file_count: 0,
                    last_activity_at: chrono::Utc::now().to_rfc3339(),
                }];
            }

            git::list_worktrees(&root)
                .iter()
                .map(|worktree| summarise(&project, worktree))
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Create a worktree for `branch` in `project_id`, returning the new workspace.
pub fn create_workspace(project_id: &str, branch: &str) -> Result<WorkspaceSummary, String> {
    let project = list_projects()
        .into_iter()
        .find(|candidate| candidate.id == project_id)
        .ok_or_else(|| format!("Unknown project: {project_id}"))?;

    let root = PathBuf::from(&project.root_path);
    if !git::is_repo(&root) {
        return Err(format!("{} is not a git repository.", project.name));
    }

    let worktree = git::create_worktree(&root, &worktrees_root(project_id), branch)?;
    Ok(summarise(&project, &worktree))
}

/// Remove a worktree. Refuses to discard uncommitted work unless `force`.
///
/// The main checkout is never removable: it is the repository, not a workspace
/// Artemis made.
pub fn delete_workspace(workspace_id: &str, force: bool) -> Result<(), String> {
    let projects = list_projects();
    for project in &projects {
        let root = PathBuf::from(&project.root_path);
        if !git::is_repo(&root) {
            continue;
        }
        for worktree in git::list_worktrees(&root) {
            let summary = summarise(project, &worktree);
            if summary.id != workspace_id {
                continue;
            }
            if worktree.is_main {
                return Err(
                    "This is the project's own checkout, not a worktree Artemis created."
                        .to_string(),
                );
            }
            return git::remove_worktree(&root, &worktree.path, force);
        }
    }
    Err(format!("Unknown workspace: {workspace_id}"))
}

/// Sessions are not persisted yet — M7 adds the store, M1 the event log.
/// Past sessions for a workspace, imported from Quiver's history.
///
/// Artemis records its own conversations in its event log; this is everything
/// that happened in the same directory under *other* harnesses, which is the
/// single thing Quiver is most worth reading for. Empty without Quiver, which
/// is the normal case and not an error.
pub fn list_sessions(workspace_id: Option<&str>) -> Vec<AgentSessionSummary> {
    let root = crate::quiver::config_root();
    let Some(workspace_id) = workspace_id else {
        return crate::quiver::session_summaries(&root, "", None);
    };

    let Some(workspace) = list_workspaces(None)
        .into_iter()
        .find(|candidate| candidate.id == workspace_id)
    else {
        return Vec::new();
    };

    crate::quiver::session_summaries(&root, workspace_id, Some(&workspace.worktree_path))
}

pub fn review_snapshot(workspace_id: &str) -> ReviewSnapshot {
    let workspace = list_workspaces(None)
        .into_iter()
        .find(|candidate| candidate.id == workspace_id);

    let Some(workspace) = workspace else {
        return ReviewSnapshot {
            workspace_id: workspace_id.to_string(),
            base_branch: "main".to_string(),
            files: Vec::new(),
            artifact_paths: Vec::new(),
        };
    };

    let path = PathBuf::from(&workspace.worktree_path);
    ReviewSnapshot {
        workspace_id: workspace_id.to_string(),
        base_branch: git::base_branch(&path),
        files: git::changed_files(&path),
        artifact_paths: Vec::new(),
    }
}
