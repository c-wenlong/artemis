//! Git state for workspaces.
//!
//! The TypeScript host swallowed every git failure and silently fell back to a
//! seeded branch name, so a directory that was not a repository still displayed
//! `main / 0 changed`. Here, "not a repository" is a representable answer and
//! callers must handle it.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use crate::proc::{run, RunOptions};
use crate::types::{ChangeKind, ChangedFile};

const GIT_TIMEOUT: Duration = Duration::from_millis(1_500);

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

/// Changed files with real line counts. Untracked files report zero additions —
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
