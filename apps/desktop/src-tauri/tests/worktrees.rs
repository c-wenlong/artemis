//! Worktree lifecycle, against real git.
//!
//! These drive the actual binary in throwaway repositories rather than mocking
//! it. Worktrees are the one place Artemis can destroy work that is not
//! recoverable from anywhere else, so the behaviour that matters: refusing to
//! delete uncommitted changes, cleaning up after a failed create: has to be
//! tested against git's real semantics, not an approximation of them.

use std::path::{Path, PathBuf};
use std::process::Command;

use artemis_host::git;

struct TempRepo {
    root: PathBuf,
    worktrees: PathBuf,
}

fn run(command: &str, args: &[&str], cwd: &Path) {
    let status = Command::new(command)
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap_or_else(|error| panic!("{command} {args:?}: {error}"));
    assert!(
        status.status.success(),
        "{command} {args:?} failed: {}",
        String::from_utf8_lossy(&status.stderr)
    );
}

impl TempRepo {
    fn new(name: &str) -> Self {
        let base = std::env::temp_dir().join(format!("artemis-wt-{name}"));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("repo");
        let worktrees = base.join("worktrees");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&worktrees).unwrap();

        run("git", &["init", "-b", "main"], &root);
        run("git", &["config", "user.email", "test@artemis.dev"], &root);
        run("git", &["config", "user.name", "Artemis Test"], &root);
        std::fs::write(root.join("README.md"), "hello\n").unwrap();
        run("git", &["add", "."], &root);
        run("git", &["commit", "-m", "initial"], &root);

        TempRepo { root, worktrees }
    }

    fn write(&self, path: &Path, contents: &str) {
        std::fs::write(path, contents).unwrap();
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.root.parent().unwrap());
    }
}

#[test]
fn a_fresh_repo_reports_only_its_main_checkout() {
    let repo = TempRepo::new("fresh");
    let worktrees = git::list_worktrees(&repo.root);
    assert_eq!(worktrees.len(), 1);
    assert!(worktrees[0].is_main);
    assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
}

#[test]
fn creates_a_worktree_on_a_new_branch() {
    let repo = TempRepo::new("create");
    let created = git::create_worktree(&repo.root, &repo.worktrees, "feature/login")
        .expect("worktree created");

    assert!(created.path.is_dir(), "the directory should exist");
    assert!(
        created.path.join("README.md").is_file(),
        "content checked out"
    );
    assert_eq!(created.branch.as_deref(), Some("feature/login"));

    let listed = git::list_worktrees(&repo.root);
    assert_eq!(listed.len(), 2);
    assert!(listed.iter().any(|w| !w.is_main));
}

#[test]
fn a_branch_name_with_slashes_becomes_a_safe_directory() {
    let repo = TempRepo::new("slashes");
    let created = git::create_worktree(&repo.root, &repo.worktrees, "feature/deep/name").unwrap();

    let name = created
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(!name.contains('/'), "got {name}");
    // Canonicalised first: on Windows the temp directory comes back as an 8.3
    // short name while git reports the long one, and two spellings of one
    // location are still one location.
    assert!(
        std::fs::canonicalize(&created.path)
            .expect("the worktree exists")
            .starts_with(std::fs::canonicalize(&repo.worktrees).expect("the root exists")),
        "stays inside the root"
    );
    // The branch itself keeps its real name.
    assert_eq!(created.branch.as_deref(), Some("feature/deep/name"));
}

#[test]
fn refuses_a_branch_that_already_has_a_worktree() {
    let repo = TempRepo::new("duplicate");
    git::create_worktree(&repo.root, &repo.worktrees, "dup").unwrap();

    let second = git::create_worktree(&repo.root, &repo.worktrees, "dup");
    let error = second.expect_err("the second create should fail");
    assert!(
        !error.is_empty(),
        "the failure needs a message a user can read"
    );

    // And the failure left nothing half-made behind.
    assert_eq!(git::list_worktrees(&repo.root).len(), 2);
}

#[test]
fn removes_a_clean_worktree() {
    let repo = TempRepo::new("remove");
    let created = git::create_worktree(&repo.root, &repo.worktrees, "temp").unwrap();

    git::remove_worktree(&repo.root, &created.path, false).expect("removed");
    assert!(!created.path.exists(), "the directory is gone");
    assert_eq!(git::list_worktrees(&repo.root).len(), 1);
}

/**
 * The one operation that can destroy work with no way back. Refusing by
 * default is the whole point; `force` exists so the caller has to say it.
 */
#[test]
fn refuses_to_delete_a_worktree_with_uncommitted_changes() {
    let repo = TempRepo::new("dirty");
    let created = git::create_worktree(&repo.root, &repo.worktrees, "dirty").unwrap();
    repo.write(&created.path.join("scratch.txt"), "work in progress");

    let refused = git::remove_worktree(&repo.root, &created.path, false);
    assert!(
        refused.is_err(),
        "uncommitted work must not be discarded silently"
    );
    assert!(
        created.path.exists(),
        "and the directory must survive the refusal"
    );
    assert!(
        created.path.join("scratch.txt").is_file(),
        "the work itself must survive"
    );
}

#[test]
fn deletes_a_dirty_worktree_when_forced() {
    let repo = TempRepo::new("forced");
    let created = git::create_worktree(&repo.root, &repo.worktrees, "forced").unwrap();
    repo.write(&created.path.join("scratch.txt"), "throwaway");

    git::remove_worktree(&repo.root, &created.path, true).expect("forced removal");
    assert!(!created.path.exists());
}

#[test]
fn reports_whether_a_worktree_has_uncommitted_work() {
    let repo = TempRepo::new("dirty-check");
    let created = git::create_worktree(&repo.root, &repo.worktrees, "check").unwrap();
    assert!(!git::has_uncommitted_changes(&created.path));

    repo.write(&created.path.join("new.txt"), "x");
    assert!(git::has_uncommitted_changes(&created.path));
}

/// A worktree directory deleted outside Artemis leaves stale metadata behind;
/// git keeps listing it until pruned.
#[test]
fn prunes_a_worktree_whose_directory_vanished() {
    let repo = TempRepo::new("prune");
    let created = git::create_worktree(&repo.root, &repo.worktrees, "ghost").unwrap();
    std::fs::remove_dir_all(&created.path).unwrap();

    git::prune_worktrees(&repo.root);
    assert_eq!(
        git::list_worktrees(&repo.root).len(),
        1,
        "the ghost should be gone from git's list"
    );
}

/// Worktrees made outside Artemis are still Artemis workspaces: adoption is
/// reading git's own list rather than keeping a registry that can drift.
#[test]
fn adopts_a_worktree_created_outside_artemis() {
    let repo = TempRepo::new("adopt");
    let external = repo.worktrees.join("made-by-hand");
    run(
        "git",
        &[
            "worktree",
            "add",
            "-b",
            "external",
            external.to_str().unwrap(),
        ],
        &repo.root,
    );

    let listed = git::list_worktrees(&repo.root);
    assert_eq!(listed.len(), 2);
    assert!(listed
        .iter()
        .any(|w| w.branch.as_deref() == Some("external")));
}

#[test]
fn a_detached_worktree_reports_no_branch_rather_than_a_wrong_one() {
    let repo = TempRepo::new("detached");
    let path = repo.worktrees.join("detached");
    run(
        "git",
        &["worktree", "add", "--detach", path.to_str().unwrap()],
        &repo.root,
    );

    let listed = git::list_worktrees(&repo.root);
    let detached = listed.iter().find(|w| !w.is_main).expect("the worktree");
    assert_eq!(detached.branch, None);
}
