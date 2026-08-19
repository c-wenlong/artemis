//! Worktrees through the workspace layer, where ids have to round-trip.
//!
//! `tests/worktrees.rs` covers the git operations. This covers the layer above:
//! a worktree created here must appear in `list_workspaces` under an id that
//! `delete_workspace` accepts. Those are three separate id derivations, and
//! nothing else notices if they drift apart.
//!
//! One test, deliberately. Scan root and worktree root come from environment
//! variables, which are process-global, and `cargo test` runs tests in
//! parallel, so this lives in its own binary with a single entry point rather
//! than racing itself.

use std::path::{Path, PathBuf};
use std::process::Command;

use artemis_host::workspace;

fn run(args: &[&str], cwd: &Path) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn make_repo(root: &Path) {
    std::fs::create_dir_all(root).unwrap();
    run(&["init", "-b", "main"], root);
    run(&["config", "user.email", "test@artemis.dev"], root);
    run(&["config", "user.name", "Artemis Test"], root);
    std::fs::write(root.join("README.md"), "hello\n").unwrap();
    run(&["add", "."], root);
    run(&["commit", "-m", "initial"], root);
}

#[test]
fn a_worktree_round_trips_from_creation_to_deletion() {
    let base = std::env::temp_dir().join("artemis-workspace-lifecycle");
    let _ = std::fs::remove_dir_all(&base);
    let scan_root = base.join("scan");
    let repo = scan_root.join("demo");
    let worktrees: PathBuf = base.join("worktrees");
    make_repo(&repo);
    std::fs::create_dir_all(&worktrees).unwrap();

    std::env::set_var("ARTEMIS_SCAN_ROOT", &scan_root);
    std::env::set_var("ARTEMIS_WORKTREES_DIR", &worktrees);

    // ---- one project, one workspace: its own checkout ----
    let projects = workspace::list_projects();
    assert_eq!(projects.len(), 1, "the scan root holds one repository");
    let project = projects[0].clone();

    let initial = workspace::list_workspaces(None);
    assert_eq!(initial.len(), 1);
    assert_eq!(initial[0].branch, "main");

    // ---- create ----
    let created =
        workspace::create_workspace(&project.id, "feature/login").expect("worktree created");
    assert_eq!(created.branch, "feature/login");
    assert!(
        Path::new(&created.worktree_path).is_dir(),
        "the checkout exists on disk"
    );
    // Compared after canonicalising, because two spellings of one location are
    // still one location. On Windows `std::env::temp_dir()` hands back the 8.3
    // short form (`RUNNER~1`) while git reports the long one, so the prefix
    // check failed on paths that were in fact the same directory.
    let created_real =
        std::fs::canonicalize(&created.worktree_path).expect("the new worktree exists");
    let worktrees_real = std::fs::canonicalize(&worktrees).expect("the worktree root exists");
    assert!(
        created_real.starts_with(&worktrees_real),
        "worktrees live outside the repository, not inside it\n  \
         created:  {created_real:?}\n  \
         root:     {worktrees_real:?}\n  \
         raw path: {:?}\n  \
         raw root: {worktrees:?}",
        created.worktree_path
    );

    // ---- it appears in the list, under the id create returned ----
    let listed = workspace::list_workspaces(None);
    assert_eq!(listed.len(), 2, "checkout plus worktree");
    let found = listed
        .iter()
        .find(|workspace| workspace.id == created.id)
        .expect("create and list must agree on the id");
    assert_eq!(found.project_id, project.id);
    assert_eq!(found.name, "feature/login");

    // ---- filtering by project keeps both ----
    assert_eq!(workspace::list_workspaces(Some(&project.id)).len(), 2);

    // ---- the project's own checkout is not deletable ----
    let main_id = &initial[0].id;
    let refused = workspace::delete_workspace(main_id, false)
        .expect_err("the repository itself is not a worktree");
    assert!(refused.contains("checkout"), "got {refused}");

    // ---- uncommitted work is not discarded silently ----
    std::fs::write(
        Path::new(&created.worktree_path).join("scratch.txt"),
        "unsaved",
    )
    .unwrap();
    let dirty = workspace::delete_workspace(&created.id, false)
        .expect_err("a dirty worktree must be refused");
    assert!(dirty.contains("uncommitted"), "got {dirty}");
    assert!(
        Path::new(&created.worktree_path).is_dir(),
        "the refusal must leave the work in place"
    );

    // ---- forcing removes it ----
    workspace::delete_workspace(&created.id, true).expect("forced deletion");
    assert!(!Path::new(&created.worktree_path).exists());
    assert_eq!(
        workspace::list_workspaces(None).len(),
        1,
        "back to just the checkout"
    );

    // ---- deleting something that is gone is an error, not a panic ----
    assert!(workspace::delete_workspace(&created.id, false).is_err());

    // ---- a branch that already has a worktree is refused with git's wording ----
    let first = workspace::create_workspace(&project.id, "dup").unwrap();
    let duplicate = workspace::create_workspace(&project.id, "dup")
        .expect_err("the same branch cannot be checked out twice");
    assert!(!duplicate.is_empty());
    workspace::delete_workspace(&first.id, false).unwrap();

    let _ = std::fs::remove_dir_all(&base);
}
