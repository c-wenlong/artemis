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

/// One workspace per project for now — the checkout itself. M5 adds worktrees.
pub fn list_workspaces(project_id: Option<&str>) -> Vec<WorkspaceSummary> {
    list_projects()
        .into_iter()
        // `Option::is_none_or` would read better but is stable only since 1.82;
        // the crate's MSRV is 1.77.
        .filter(|project| project_id.map_or(true, |wanted| wanted == project.id))
        .map(|project| {
            let path = PathBuf::from(&project.root_path);
            let is_repo = git::is_repo(&path);
            let branch = git::current_branch(&path);
            let changed = git::changed_file_count(&path);

            WorkspaceSummary {
                id: format!("ws-{}", project.id),
                project_id: project.id.clone(),
                // Named after the project: every workspace being "Current
                // checkout" made a nine-project list unreadable. M5 gives
                // worktrees their own names.
                name: project.name.clone(),
                // No invented branch name: a non-repository says so.
                branch: match (is_repo, branch) {
                    (true, Some(name)) => name,
                    (true, None) => "detached HEAD".to_string(),
                    (false, _) => "not a git repository".to_string(),
                },
                worktree_path: project.root_path.clone(),
                status: if is_repo {
                    WorkspaceStatus::Ready
                } else {
                    WorkspaceStatus::NeedsAttention
                },
                active_session_ids: Vec::new(),
                changed_file_count: changed.unwrap_or(0),
                last_activity_at: chrono::Utc::now().to_rfc3339(),
            }
        })
        .collect()
}

/// Sessions are not persisted yet — M7 adds the store, M1 the event log.
pub fn list_sessions(_workspace_id: Option<&str>) -> Vec<AgentSessionSummary> {
    Vec::new()
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
