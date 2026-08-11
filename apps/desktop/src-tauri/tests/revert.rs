//! Undoing an agent's edit.
//!
//! Reverse-applying the patch opencode reported, rather than restoring from git
//! history: the workspace usually holds the user's own uncommitted work too, and
//! `git checkout -- file` would take that with it. A reverse patch touches only
//! the lines the agent wrote.
//!
//! The safety property that matters is refusal. If the file moved on since the
//! agent edited it, the patch no longer describes reality, and applying it
//! anyway would corrupt whatever came after. It has to fail instead.

use artemis_host::git;
use std::path::{Path, PathBuf};
use std::process::Command;

fn repo(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("artemis-revert-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    for args in [
        vec!["init", "-q"],
        vec!["config", "user.email", "t@example.com"],
        vec!["config", "user.name", "Test"],
    ] {
        Command::new("git")
            .args(&args)
            .current_dir(&dir)
            .output()
            .expect("git");
    }
    dir
}

fn commit_all(dir: &Path) {
    Command::new("git")
        .args(["add", "-A"])
        .current_dir(dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-qm", "seed"])
        .current_dir(dir)
        .output()
        .unwrap();
}

/// The shape opencode reports: absolute paths in the headers, which is exactly
/// why they are rebuilt rather than trusted.
fn patch_for(dir: &Path, relative: &str, body: &str) -> String {
    let absolute = dir.join(relative);
    let absolute = absolute.to_string_lossy();
    format!(
        "Index: {absolute}\n\
         ===================================================================\n\
         --- {absolute}\n\
         +++ {absolute}\n\
         {body}"
    )
}

const ADD_DELTA: &str = "@@ -1,3 +1,4 @@\n alpha\n beta\n gamma\n+delta\n";

#[test]
fn reverse_applying_removes_the_line_the_agent_added() {
    let dir = repo("removes_added_line");
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\n").unwrap();
    commit_all(&dir);
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\ndelta\n").unwrap();

    git::revert_patch(&dir, "seed.txt", &patch_for(&dir, "seed.txt", ADD_DELTA))
        .expect("revert should apply");

    assert_eq!(
        std::fs::read_to_string(dir.join("seed.txt")).unwrap(),
        "alpha\nbeta\ngamma\n"
    );
}

/// The whole point of using a patch: the user's own edits elsewhere survive,
/// where `git checkout -- file` would have discarded them.
///
/// "Elsewhere" means outside the hunk's context. An edit *inside* it is a
/// genuine conflict and gets refused — see the drift test below. That is the
/// right way round: silently reverting across a changed context is how an undo
/// eats work it did not write.
#[test]
fn work_the_user_did_elsewhere_in_the_file_is_kept() {
    let dir = repo("keeps_user_work");
    let original = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n";
    std::fs::write(dir.join("seed.txt"), original).unwrap();
    commit_all(&dir);
    // The agent appended a line at the end; the user then edited the top.
    std::fs::write(
        dir.join("seed.txt"),
        "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n",
    )
    .unwrap();

    let appended = "@@ -6,3 +6,4 @@\n six\n seven\n eight\n+nine\n";
    git::revert_patch(&dir, "seed.txt", &patch_for(&dir, "seed.txt", appended))
        .expect("the context around the change is intact");

    assert_eq!(
        std::fs::read_to_string(dir.join("seed.txt")).unwrap(),
        "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n",
        "the user's edit must survive the undo"
    );
}

#[test]
fn refuses_when_the_line_is_no_longer_there() {
    let dir = repo("refuses_when_gone");
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\n").unwrap();
    commit_all(&dir);
    // Someone already removed the agent's line by hand.

    let error = git::revert_patch(&dir, "seed.txt", &patch_for(&dir, "seed.txt", ADD_DELTA))
        .expect_err("nothing to reverse");
    assert!(!error.is_empty(), "the refusal has to say something");
    assert_eq!(
        std::fs::read_to_string(dir.join("seed.txt")).unwrap(),
        "alpha\nbeta\ngamma\n",
        "a refused undo must not have written anything"
    );
}

#[test]
fn refuses_when_the_surrounding_lines_have_changed() {
    let dir = repo("refuses_on_drift");
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\n").unwrap();
    commit_all(&dir);
    // The context the patch expects is gone.
    std::fs::write(
        dir.join("seed.txt"),
        "completely\ndifferent\ncontent\ndelta\n",
    )
    .unwrap();

    assert!(git::revert_patch(&dir, "seed.txt", &patch_for(&dir, "seed.txt", ADD_DELTA)).is_err());
    assert!(
        std::fs::read_to_string(dir.join("seed.txt"))
            .unwrap()
            .contains("completely"),
        "the file must be left exactly as it was"
    );
}

/// The paths inside a patch are attacker-adjacent: they come from a model's
/// tool call. They are rebuilt from the vetted relative path instead.
#[test]
fn a_patch_cannot_write_outside_the_workspace() {
    let dir = repo("no_escape");
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\n").unwrap();
    commit_all(&dir);

    let outside = dir.parent().unwrap().join("artemis-revert-victim.txt");
    let _ = std::fs::remove_file(&outside);
    std::fs::write(&outside, "untouched\n").unwrap();

    for escape in ["../artemis-revert-victim.txt", "/etc/passwd", "a/../../x"] {
        let error = git::revert_patch(&dir, escape, ADD_DELTA)
            .expect_err(&format!("{escape} should be refused"));
        assert!(
            error.to_lowercase().contains("outside") || error.to_lowercase().contains("path"),
            "{escape} refused for the wrong reason: {error}"
        );
    }

    assert_eq!(
        std::fs::read_to_string(&outside).unwrap(),
        "untouched\n",
        "nothing outside the workspace may be written"
    );
    let _ = std::fs::remove_file(&outside);
}

/// Even when the header inside the patch points somewhere else entirely, only
/// the path the caller vetted is written.
#[test]
fn the_header_in_the_patch_is_not_trusted() {
    let dir = repo("header_ignored");
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\n").unwrap();
    std::fs::write(dir.join("other.txt"), "alpha\nbeta\ngamma\ndelta\n").unwrap();
    commit_all(&dir);
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\ndelta\n").unwrap();

    // Headers name other.txt; the caller says seed.txt.
    let lying = patch_for(&dir, "other.txt", ADD_DELTA);
    git::revert_patch(&dir, "seed.txt", &lying).expect("applies to the vetted path");

    assert_eq!(
        std::fs::read_to_string(dir.join("seed.txt")).unwrap(),
        "alpha\nbeta\ngamma\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("other.txt")).unwrap(),
        "alpha\nbeta\ngamma\ndelta\n",
        "the file named in the header must be untouched"
    );
}

#[test]
fn reverting_a_created_file_deletes_it() {
    let dir = repo("undo_create");
    std::fs::write(dir.join("seed.txt"), "x\n").unwrap();
    commit_all(&dir);
    std::fs::write(dir.join("notes.md"), "- one\n- two\n").unwrap();

    let created = patch_for(&dir, "notes.md", "@@ -0,0 +1,2 @@\n+- one\n+- two\n");
    git::revert_patch(&dir, "notes.md", &created).expect("revert a creation");

    assert!(
        !dir.join("notes.md").exists(),
        "undoing a file that was created should remove it"
    );
}

#[test]
fn an_empty_patch_is_refused_rather_than_treated_as_a_no_op() {
    let dir = repo("empty_patch");
    std::fs::write(dir.join("seed.txt"), "alpha\n").unwrap();
    commit_all(&dir);
    assert!(git::revert_patch(&dir, "seed.txt", "").is_err());
    assert!(git::revert_patch(&dir, "seed.txt", "   \n").is_err());
}
