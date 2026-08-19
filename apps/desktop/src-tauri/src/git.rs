//! Git state for workspaces.
//!
//! The TypeScript host swallowed every git failure and silently fell back to a
//! seeded branch name, so a directory that was not a repository still displayed
//! `main / 0 changed`. Here, "not a repository" is a representable answer and
//! callers must handle it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::proc::{run, RunOptions};
use crate::types::{ChangeKind, ChangedFile};

const GIT_TIMEOUT: Duration = Duration::from_millis(1_500);
/// Creating a worktree copies a whole tree; a large repository needs longer
/// than a status query.
const WORKTREE_TIMEOUT: Duration = Duration::from_secs(60);

fn git(args: &[&str], cwd: &Path) -> Option<String> {
    let captured = run(
        "git",
        args,
        RunOptions {
            cwd: Some(cwd),
            timeout: GIT_TIMEOUT,
            ..Default::default()
        },
    )?;
    captured.ok().then_some(captured.stdout)
}

/// Run git, keeping stderr on failure: worktree errors are the ones a user has
/// to read and act on ("branch already checked out", "contains modified files").
fn git_checked(args: &[&str], cwd: &Path, timeout: Duration) -> Result<String, String> {
    let captured = run(
        "git",
        args,
        RunOptions {
            cwd: Some(cwd),
            timeout,
            ..Default::default()
        },
    )
    .ok_or_else(|| "Could not run git.".to_string())?;

    if captured.timed_out {
        return Err(format!("git {} timed out.", args.join(" ")));
    }
    if captured.exit_code == Some(0) {
        return Ok(captured.stdout);
    }

    let message = captured
        .stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("git failed")
        .to_string();
    Err(message)
}

pub fn is_repo(cwd: &Path) -> bool {
    git(&["rev-parse", "--is-inside-work-tree"], cwd)
        .map(|out| out.trim() == "true")
        .unwrap_or(false)
}

/// Current branch, or `None` when detached or not a repository.
pub fn current_branch(cwd: &Path) -> Option<String> {
    let branch = git(&["branch", "--show-current"], cwd)?.trim().to_string();
    (!branch.is_empty()).then_some(branch)
}

pub fn changed_file_count(cwd: &Path) -> Option<u32> {
    let output = git(&["status", "--porcelain"], cwd)?;
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Some(0);
    }
    Some(trimmed.lines().count() as u32)
}

fn kind_from_status(code: &str) -> ChangeKind {
    // Porcelain v1 status codes: index status then worktree status.
    match code.trim() {
        s if s.starts_with('R') => ChangeKind::Renamed,
        s if s.starts_with('D') || s.ends_with('D') => ChangeKind::Deleted,
        s if s.starts_with('A') || s == "??" => ChangeKind::Added,
        _ => ChangeKind::Modified,
    }
}

/// Changed files with real line counts. Untracked files report zero additions:
/// `git diff` does not see them and counting lines by hand would be a guess
/// about what the eventual diff looks like.
pub fn changed_files(cwd: &Path) -> Vec<ChangedFile> {
    let Some(status_output) = git(&["status", "--porcelain"], cwd) else {
        return Vec::new();
    };

    let mut numstat: HashMap<String, (u32, u32)> = HashMap::new();
    if let Some(diff_output) = git(&["diff", "--numstat", "HEAD"], cwd) {
        for line in diff_output.lines() {
            let mut parts = line.split('\t');
            let (Some(added), Some(removed), Some(path)) =
                (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            // "-" marks a binary file.
            let added = added.parse::<u32>().unwrap_or(0);
            let removed = removed.parse::<u32>().unwrap_or(0);
            numstat.insert(path.to_string(), (added, removed));
        }
    }

    status_output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let (code, rest) = line.split_at(2);
            let path = rest.trim();
            // Renames read as "old -> new"; the new path is what matters.
            let path = path.rsplit(" -> ").next().unwrap_or(path).to_string();
            let (additions, deletions) = numstat.get(&path).copied().unwrap_or((0, 0));
            Some(ChangedFile {
                path,
                kind: kind_from_status(code),
                additions,
                deletions,
            })
        })
        .collect()
}

/// Best guess at the trunk branch: whatever `origin/HEAD` points at, else the
/// first of the usual suspects that exists, else `main`.
pub fn base_branch(cwd: &Path) -> String {
    if let Some(output) = git(
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        cwd,
    ) {
        if let Some(name) = output.trim().rsplit('/').next() {
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    for candidate in ["main", "master", "trunk"] {
        let reference = format!("refs/heads/{candidate}");
        if git(&["show-ref", "--verify", "--quiet", &reference], cwd).is_some() {
            return candidate.to_string();
        }
    }
    "main".to_string()
}

// ---------------------------------------------------------------- worktrees

#[derive(Debug, Clone)]
pub struct Worktree {
    pub path: PathBuf,
    /// `None` when detached: a detached worktree has no branch, and naming one
    /// anyway would be a guess.
    pub branch: Option<String>,
    pub is_main: bool,
}

/// Every worktree git knows about, main checkout first.
///
/// Git's own list is the source of truth rather than a registry Artemis keeps.
/// A registry drifts: worktrees created with `git worktree add` on the command
/// line would be invisible, and ones deleted by hand would linger. Reading
/// git means adoption is automatic.
pub fn list_worktrees(repo: &Path) -> Vec<Worktree> {
    let Some(output) = git(&["worktree", "list", "--porcelain"], repo) else {
        return Vec::new();
    };

    let mut worktrees = Vec::new();
    let mut path: Option<PathBuf> = None;
    let mut branch: Option<String> = None;
    let mut detached = false;

    // Porcelain output is stanzas separated by blank lines.
    let mut flush =
        |path: &mut Option<PathBuf>, branch: &mut Option<String>, detached: &mut bool| {
            if let Some(found) = path.take() {
                let is_main = worktrees.is_empty();
                worktrees.push(Worktree {
                    path: found,
                    branch: if *detached { None } else { branch.take() },
                    is_main,
                });
            }
            *branch = None;
            *detached = false;
        };

    for line in output.lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            flush(&mut path, &mut branch, &mut detached);
            path = Some(PathBuf::from(value));
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(
                value
                    .strip_prefix("refs/heads/")
                    .unwrap_or(value)
                    .to_string(),
            );
        } else if line.trim() == "detached" {
            detached = true;
        }
    }
    flush(&mut path, &mut branch, &mut detached);

    worktrees
}

/// Directory name for a branch. Branch names carry slashes; paths must not
/// gain extra levels from them.
fn worktree_dir_name(branch: &str) -> String {
    let cleaned: String = branch
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "worktree".to_string()
    } else {
        trimmed
    }
}

/// Create a worktree for `branch` under `root`.
///
/// Uses an existing branch when there is one and creates it otherwise, so the
/// caller does not have to know which. On failure the metadata is pruned:
/// a half-finished `worktree add` otherwise leaves an entry pointing at a
/// directory that does not exist, and every later call has to work around it.
pub fn create_worktree(repo: &Path, root: &Path, branch: &str) -> Result<Worktree, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("A branch name is required.".to_string());
    }

    let mut path = root.join(worktree_dir_name(branch));
    // Two branches can sanitise to the same directory name.
    let mut suffix = 2;
    while path.exists() {
        path = root.join(format!("{}-{suffix}", worktree_dir_name(branch)));
        suffix += 1;
    }

    std::fs::create_dir_all(root).map_err(|error| format!("create {root:?}: {error}"))?;

    let branch_exists = git(
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
        repo,
    )
    .is_some();

    let path_arg = path.to_string_lossy().into_owned();
    let args: Vec<&str> = if branch_exists {
        vec!["worktree", "add", &path_arg, branch]
    } else {
        vec!["worktree", "add", "-b", branch, &path_arg]
    };

    match git_checked(&args, repo, WORKTREE_TIMEOUT) {
        Ok(_) => Ok(Worktree {
            path,
            branch: Some(branch.to_string()),
            is_main: false,
        }),
        Err(error) => {
            // Leave nothing half-made behind.
            prune_worktrees(repo);
            let _ = std::fs::remove_dir_all(&path);
            Err(error)
        }
    }
}

/// True when the worktree has staged, unstaged, or untracked changes.
pub fn has_uncommitted_changes(worktree: &Path) -> bool {
    git(&["status", "--porcelain"], worktree)
        .map(|output| !output.trim().is_empty())
        .unwrap_or(false)
}

/// Remove a worktree.
///
/// Refuses by default when the worktree holds uncommitted work. This is the one
/// operation in Artemis that can destroy something with no copy anywhere else,
/// so discarding it has to be asked for explicitly rather than assumed.
pub fn remove_worktree(repo: &Path, worktree: &Path, force: bool) -> Result<(), String> {
    if !force && has_uncommitted_changes(worktree) {
        return Err(
            "This worktree has uncommitted changes. Commit them, or delete it again \
             to discard them."
                .to_string(),
        );
    }

    let path_arg = worktree.to_string_lossy().into_owned();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&path_arg);

    git_checked(&args, repo, WORKTREE_TIMEOUT).map(|_| ())
}

/// Drop metadata for worktrees whose directories are gone.
pub fn prune_worktrees(repo: &Path) {
    let _ = git(&["worktree", "prune"], repo);
}

/// Reverse-apply a patch, undoing one file's worth of an agent's edit.
///
/// Two decisions worth stating.
///
/// It is a reverse patch rather than `git checkout -- file` because the
/// workspace usually holds the user's own uncommitted work as well. Restoring
/// from the index would discard that; reversing the patch touches only the
/// lines the agent wrote, and leaves an unrelated edit in the same file alone.
///
/// The paths inside the patch are rebuilt rather than trusted. They arrive from
/// a model's tool call, opencode writes them as absolute, and `git apply` will
/// happily follow `../..` out of the workspace. So `relative` is validated and
/// the headers are regenerated from it: whatever the patch claims is ignored.
pub fn revert_patch(workspace: &Path, relative: &str, patch: &str) -> Result<(), String> {
    if patch.trim().is_empty() {
        return Err("There is no patch to reverse.".to_string());
    }
    let relative = crate::paths::vetted(relative)?;
    let rewritten = rewrite_patch_headers(patch, &relative)?;

    // opencode writes a newly created file as an ordinary patch against an
    // empty original (`@@ -0,0 +1,n @@`) rather than a git "new file mode"
    // one. Reversing that removes every line and leaves an empty file sitting
    // there, which is not what undoing a creation means.
    if creates_the_file(&rewritten) {
        let target = workspace.join(&relative);
        return match std::fs::remove_file(&target) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Err("That file is already gone.".to_string())
            }
            Err(error) => Err(format!("Could not remove {relative}: {error}")),
        };
    }

    // `--check` first so a patch that no longer fits leaves the file untouched
    // rather than half-applied.
    let args = ["apply", "--reverse", "-p1", "--unidiff-zero", "-"];
    git_stdin(&args, workspace, &rewritten, true).map_err(|error| {
        format!("This edit no longer matches the file, so it was not undone. {error}")
    })?;
    git_stdin(&args, workspace, &rewritten, false)
}

/// True when every hunk starts from an empty original, i.e. the patch is the
/// creation of the whole file.
fn creates_the_file(patch: &str) -> bool {
    let mut hunks = 0;
    for line in patch.lines().filter(|line| line.starts_with("@@")) {
        hunks += 1;
        // "@@ -0,0 +1,3 @@": the original side is the part after '-'.
        let Some(original) = line.split_whitespace().nth(1) else {
            return false;
        };
        let count = original
            .trim_start_matches('-')
            .split(',')
            .nth(1)
            .unwrap_or("1");
        if count != "0" {
            return false;
        }
    }
    hunks > 0
}

/// Replace whatever the patch calls the file with `a/<relative>` and
/// `b/<relative>`, and drop the `Index:` line opencode prefixes it with.
fn rewrite_patch_headers(patch: &str, relative: &str) -> Result<String, String> {
    let body: Vec<&str> = patch
        .lines()
        .skip_while(|line| {
            line.starts_with("Index:")
                || line.starts_with("===")
                || line.starts_with("--- ")
                || line.starts_with("+++ ")
        })
        .collect();

    if !body.iter().any(|line| line.starts_with("@@")) {
        return Err("The patch has no hunks to reverse.".to_string());
    }

    let mut rewritten = format!("--- a/{relative}\n+++ b/{relative}\n");
    rewritten.push_str(&body.join("\n"));
    if !rewritten.ends_with('\n') {
        rewritten.push('\n');
    }
    Ok(rewritten)
}

/// Run git with the patch on stdin. `check_only` adds `--check`, which reports
/// whether it would apply without touching anything.
fn git_stdin(args: &[&str], cwd: &Path, stdin: &str, check_only: bool) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut full: Vec<&str> = args.to_vec();
    if check_only {
        full.insert(1, "--check");
    }

    let mut child = Command::new("git")
        .args(&full)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not run git: {error}"))?;

    child
        .stdin
        .take()
        .ok_or_else(|| "git refused stdin.".to_string())?
        .write_all(stdin.as_bytes())
        .map_err(|error| format!("Could not send the patch to git: {error}"))?;

    let output = child
        .wait_with_output()
        .map_err(|error| format!("git did not finish: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("git apply failed")
        .to_string())
}
