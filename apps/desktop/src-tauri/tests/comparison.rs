//! Running one prompt against several harnesses at once.
//!
//! The wedge: three agents, three isolated worktrees, three diffs, keep one.
//! Everything here runs against real git, because the part that can lose work
//! is the part that deletes the losers.
//!
//! Two properties matter more than the rest, and most of this file is about
//! them. **Isolation:** no two harnesses may share a worktree, or they overwrite
//! each other's answer and the comparison is meaningless. **Resolution:** the
//! winner survives and only the losers are discarded: this is the one
//! operation in Artemis that deliberately destroys an agent's work, so it has to
//! refuse anything it does not understand rather than guess.

use std::path::{Path, PathBuf};
use std::process::Command;

use artemis_host::comparison::{self, ComparisonPlan};
use artemis_host::git;

struct Fixture {
    repo: PathBuf,
    worktrees: PathBuf,
}

fn run(command: &str, args: &[&str], cwd: &Path) {
    let output = Command::new(command)
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap_or_else(|error| panic!("{command} {args:?}: {error}"));
    assert!(
        output.status.success(),
        "{command} {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn fixture(name: &str) -> Fixture {
    let base = std::env::temp_dir().join(format!("artemis-compare-{name}"));
    let _ = std::fs::remove_dir_all(&base);
    let repo = base.join("repo");
    let worktrees = base.join("worktrees");
    std::fs::create_dir_all(&repo).expect("repo dir");
    std::fs::create_dir_all(&worktrees).expect("worktree dir");

    run("git", &["init", "-q", "-b", "main"], &repo);
    run("git", &["config", "user.email", "t@example.com"], &repo);
    run("git", &["config", "user.name", "Test"], &repo);
    // Windows turns `core.autocrlf` on by default, so a checkout rewrites the
    // committed `alpha\n` to `alpha\r\n` while the seed file written here, which
    // never goes through a checkout: stays LF. Pinning it off makes every
    // worktree byte-identical to the commit on every platform, so these tests
    // measure isolation rather than the runner's line-ending policy.
    //
    // This is the fixture's own config, not advice for real repositories. What
    // CRLF does to a real comparison is an open question, noted in MILESTONES.
    run("git", &["config", "core.autocrlf", "false"], &repo);
    std::fs::write(repo.join("seed.txt"), "alpha\n").expect("seed");
    run("git", &["add", "-A"], &repo);
    run("git", &["commit", "-qm", "init"], &repo);

    Fixture { repo, worktrees }
}

fn plan(prompt: &str, harnesses: &[&str]) -> ComparisonPlan {
    comparison::plan(
        "demo",
        prompt,
        &harnesses.iter().map(|h| h.to_string()).collect::<Vec<_>>(),
    )
    .expect("a plan")
}

/// Agents leave work uncommitted, so a loser always has changes to discard.
fn dirty(worktree: &Path, text: &str) {
    std::fs::write(worktree.join("answer.txt"), text).expect("write");
}

// ------------------------------------------------------------------ planning

#[test]
fn one_branch_per_harness_named_for_the_prompt() {
    let plan = plan("Add retry logic to the client", &["opencode", "codex"]);

    assert_eq!(plan.entries.len(), 2);
    let branches: Vec<&str> = plan.entries.iter().map(|e| e.branch.as_str()).collect();
    assert!(
        branches.iter().all(|b| b.contains("add-retry-logic")),
        "a branch should say what was asked: {branches:?}"
    );
    assert!(branches[0] != branches[1], "one branch each: {branches:?}");
    assert!(
        branches.iter().any(|b| b.contains("opencode"))
            && branches.iter().any(|b| b.contains("codex")),
        "and which harness produced it: {branches:?}"
    );
}

#[test]
fn branch_names_survive_a_prompt_that_is_not_a_branch_name() {
    let plan = plan(
        "  Fix the ~/.config loader!! (it breaks on spaces & colons: really)  ",
        &["codex"],
    );
    let branch = &plan.entries[0].branch;

    // git refuses these outright, so a prompt containing them must not reach it.
    for bad in [' ', '~', ':', '?', '*', '[', '\\', '\''] {
        assert!(!branch.contains(bad), "{bad:?} in {branch}");
    }
    assert!(!branch.contains(".."), "{branch}");
    assert!(!branch.ends_with('.') && !branch.ends_with('/'), "{branch}");
    assert!(branch.len() < 100, "unreasonably long: {branch}");
}

#[test]
fn a_prompt_with_nothing_usable_still_produces_a_branch() {
    let plan = plan("!!! ???", &["codex"]);
    assert!(
        !plan.entries[0].branch.is_empty(),
        "a nameless prompt still needs somewhere to run"
    );
}

#[test]
fn the_same_harness_twice_is_one_entry() {
    let plan = plan("do a thing", &["codex", "codex", "opencode"]);
    assert_eq!(plan.entries.len(), 2, "asking codex twice is asking once");
}

#[test]
fn a_comparison_of_nothing_is_refused() {
    assert!(comparison::plan("demo", "do a thing", &[]).is_err());
    assert!(comparison::plan("demo", "   ", &["codex".into()]).is_err());
}

// ----------------------------------------------------------------- isolation

#[test]
fn every_harness_gets_a_worktree_of_its_own() {
    let f = fixture("isolation");
    let started = comparison::start_in(
        &f.repo,
        &f.worktrees,
        &plan("add retries", &["opencode", "codex", "claude"]),
    );

    assert_eq!(started.entries.len(), 3);
    assert!(
        started.entries.iter().all(|entry| entry.error.is_none()),
        "{:?}",
        started.entries
    );

    let paths: Vec<&PathBuf> = started
        .entries
        .iter()
        .filter_map(|e| e.path.as_ref())
        .collect();
    assert_eq!(paths.len(), 3);
    for path in &paths {
        assert!(path.is_dir(), "{path:?} was not created");
    }

    let mut unique: Vec<&PathBuf> = paths.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 3, "two harnesses shared a worktree");
}

/// Each starts from the same commit, so the diffs are comparable.
///
/// The line endings here are the fixture's doing, not this test's: it pins
/// `core.autocrlf` off, because on Windows a checkout would otherwise rewrite
/// the committed `alpha\n` and the worktrees would legitimately differ from the
/// seed file, which never goes through a checkout at all. An earlier attempt to
/// fix this by comparing worktrees against that seed file failed for exactly
/// that reason: it compared checked-out files to one that was not.
#[test]
fn every_worktree_starts_from_the_same_place() {
    let f = fixture("same_base");
    let started = comparison::start_in(&f.repo, &f.worktrees, &plan("go", &["codex", "claude"]));

    let contents: Vec<String> = started
        .entries
        .iter()
        .map(|entry| {
            let path = entry.path.as_ref().expect("a worktree");
            std::fs::read_to_string(path.join("seed.txt")).unwrap()
        })
        .collect();

    assert_eq!(contents.len(), 2, "both harnesses should have started");
    for content in &contents {
        assert_eq!(content, "alpha\n", "worktrees must match the commit");
    }
}

/// One harness failing to get a worktree must not cost the others their run.
#[test]
fn a_harness_that_cannot_start_does_not_take_the_others_down() {
    let f = fixture("partial");
    // Claim one of the branches first, so git refuses that worktree.
    let taken = plan("go", &["codex"]).entries[0].branch.clone();
    run("git", &["branch", &taken], &f.repo);
    run(
        "git",
        &["worktree", "add", "-q", "../taken", &taken],
        &f.repo,
    );

    let started = comparison::start_in(
        &f.repo,
        &f.worktrees,
        &plan("go", &["codex", "opencode", "claude"]),
    );

    let failed: Vec<&str> = started
        .entries
        .iter()
        .filter(|e| e.error.is_some())
        .map(|e| e.harness_id.as_str())
        .collect();
    assert_eq!(failed, vec!["codex"], "only the blocked one should fail");
    assert_eq!(
        started.entries.iter().filter(|e| e.error.is_none()).count(),
        2,
        "the other two should still have somewhere to work"
    );
}

// ---------------------------------------------------------------- resolution

#[test]
fn keeping_one_discards_the_rest() {
    let f = fixture("keep_one");
    let started = comparison::start_in(
        &f.repo,
        &f.worktrees,
        &plan("go", &["opencode", "codex", "claude"]),
    );
    for entry in &started.entries {
        dirty(entry.path.as_ref().unwrap(), "an answer");
    }

    let winner = started.entries[1].workspace_id.clone();
    comparison::resolve_in(&f.repo, &started, &winner).expect("resolve");

    let kept = started.entries[1].path.clone().unwrap();
    assert!(kept.is_dir(), "the winner must survive");
    assert_eq!(
        std::fs::read_to_string(kept.join("answer.txt")).unwrap(),
        "an answer",
        "and keep its work"
    );

    for loser in [0, 2] {
        let path = started.entries[loser].path.clone().unwrap();
        assert!(!path.exists(), "{path:?} should have been discarded");
    }
}

/// Discarding a loser means discarding uncommitted work on purpose. That is the
/// intent here, but it must never reach a worktree outside the comparison.
#[test]
fn resolution_only_ever_touches_this_comparison() {
    let f = fixture("scoped");
    run("git", &["branch", "unrelated"], &f.repo);
    let bystander = f.worktrees.join("bystander");
    run(
        "git",
        &[
            "worktree",
            "add",
            "-q",
            bystander.to_str().unwrap(),
            "unrelated",
        ],
        &f.repo,
    );
    dirty(&bystander, "someone else's work");

    let started = comparison::start_in(&f.repo, &f.worktrees, &plan("go", &["codex", "claude"]));
    let winner = started.entries[0].workspace_id.clone();
    comparison::resolve_in(&f.repo, &started, &winner).expect("resolve");

    assert!(bystander.is_dir(), "an unrelated worktree was deleted");
    assert_eq!(
        std::fs::read_to_string(bystander.join("answer.txt")).unwrap(),
        "someone else's work"
    );
}

/// A winner that is not in the comparison would otherwise mean "delete all of
/// them", which is the worst possible reading of an unrecognised id.
#[test]
fn an_unknown_winner_is_refused_and_nothing_is_deleted() {
    let f = fixture("unknown_winner");
    let started = comparison::start_in(&f.repo, &f.worktrees, &plan("go", &["codex", "claude"]));

    assert!(comparison::resolve_in(&f.repo, &started, "ws-not-in-this-run").is_err());
    for entry in &started.entries {
        assert!(
            entry.path.as_ref().unwrap().is_dir(),
            "a refused resolve must delete nothing"
        );
    }
}

#[test]
fn abandoning_a_comparison_discards_every_worktree() {
    let f = fixture("abandon");
    let started = comparison::start_in(&f.repo, &f.worktrees, &plan("go", &["codex", "claude"]));
    for entry in &started.entries {
        dirty(entry.path.as_ref().unwrap(), "wasted work");
    }

    comparison::abandon_in(&f.repo, &started).expect("abandon");
    for entry in &started.entries {
        assert!(!entry.path.as_ref().unwrap().exists());
    }
}

/// A harness that never got a worktree has nothing to discard, and must not
/// make the resolution fail for the ones that did.
#[test]
fn resolution_steps_over_an_entry_that_never_started() {
    let f = fixture("resolve_partial");
    let taken = plan("go", &["codex"]).entries[0].branch.clone();
    run("git", &["branch", &taken], &f.repo);
    run(
        "git",
        &["worktree", "add", "-q", "../taken2", &taken],
        &f.repo,
    );

    let started = comparison::start_in(
        &f.repo,
        &f.worktrees,
        &plan("go", &["codex", "opencode", "claude"]),
    );
    let winner = started
        .entries
        .iter()
        .find(|e| e.error.is_none())
        .unwrap()
        .workspace_id
        .clone();

    comparison::resolve_in(&f.repo, &started, &winner).expect("resolve");
    assert!(started
        .entries
        .iter()
        .find(|e| e.workspace_id == winner)
        .unwrap()
        .path
        .as_ref()
        .unwrap()
        .is_dir());
}

// ------------------------------------------------------------------- reading

/// A comparison is only useful if the diffs can be read side by side.
#[test]
fn each_entry_reports_what_its_harness_changed() {
    let f = fixture("diffstat");
    let started = comparison::start_in(&f.repo, &f.worktrees, &plan("go", &["codex", "claude"]));

    let busy = started.entries[0].path.clone().unwrap();
    std::fs::write(busy.join("seed.txt"), "alpha\nbeta\n").unwrap();
    dirty(&busy, "new file\n");

    let changed = git::changed_files(&busy);
    assert_eq!(changed.len(), 2, "{changed:?}");

    let idle = started.entries[1].path.clone().unwrap();
    assert!(
        git::changed_files(&idle).is_empty(),
        "a harness that did nothing should show nothing"
    );
}

/// The whole wedge, against real agents.
///
/// Everything above uses real git but no models. This runs two harnesses for
/// real, in their own worktrees, on the same prompt, then checks the diffs are
/// genuinely independent and keeps one.
///
/// Ignored: it costs two model calls and about a minute.
///
/// ```text
/// OPENCODE_BIN=$(command -v opencode) CODEX_BIN=$(command -v codex) \
///   OPENCODE_MODEL=openai/gpt-5-mini \
///   cargo test --test comparison live_comparison -- --ignored --nocapture
/// ```
#[test]
#[ignore]
fn live_comparison_of_two_real_harnesses() {
    use artemis_host::chat::stream::{new_turn_handle, run_turn, EventSink, TurnRequest};
    use artemis_host::types::{HarnessKind, RuntimeEvent};

    struct Silent;
    impl EventSink for Silent {
        fn emit(&self, _events: &[RuntimeEvent]) {}
    }

    let (Ok(opencode), Ok(codex)) = (std::env::var("OPENCODE_BIN"), std::env::var("CODEX_BIN"))
    else {
        eprintln!("set OPENCODE_BIN and CODEX_BIN to run this");
        return;
    };

    let f = fixture("live");
    let prompt = "Add a line reading 'delta' to the end of seed.txt.";
    let started =
        comparison::start_in(&f.repo, &f.worktrees, &plan(prompt, &["opencode", "codex"]));
    assert!(started.entries.iter().all(|e| e.error.is_none()));

    for entry in &started.entries {
        let cwd = entry.path.clone().unwrap();
        let kind = if entry.harness_id == "codex" {
            HarnessKind::Codex
        } else {
            HarnessKind::Opencode
        };

        // A model id belongs to one harness. Handing opencode's to codex made
        // its model refresh time out, which is a real lesson for the product,
        // not just for this test: a comparison has to choose a model per
        // harness, never one for the run.
        let model = match kind {
            HarnessKind::Opencode => std::env::var("OPENCODE_MODEL").ok(),
            _ => None,
        };
        let mut args = artemis_host::chat::adapters::argv(
            kind,
            &cwd.to_string_lossy(),
            model.as_deref(),
            None,
        );
        if kind == HarnessKind::Codex {
            args.insert(1, "--dangerously-bypass-approvals-and-sandbox".into());
        } else {
            args.push(prompt.to_string());
        }

        let outcome = run_turn(
            TurnRequest {
                kind,
                session_id: format!("live-{}", entry.harness_id),
                turn_id: "t1".into(),
                command: if kind == HarnessKind::Codex {
                    codex.clone()
                } else {
                    opencode.clone()
                },
                args,
                cwd: &cwd,
                prompt: prompt.into(),
                harness_id: entry.harness_id.clone(),
                workspace_id: entry.workspace_id.clone(),
            },
            new_turn_handle(),
            std::sync::Arc::new(Silent),
            // Outside the worktree: a log written inside it would show up as
            // one of the harness's own changes.
            &artemis_host::chat::log::EventLog::in_dir(
                f.repo.parent().unwrap().to_path_buf(),
                &format!("live-{}", entry.harness_id),
            ),
        );
        println!("{}: failed={}", entry.harness_id, outcome.failed);
        assert!(!outcome.failed, "{} did not finish", entry.harness_id);
    }

    // Both edited their own copy, and neither saw the other's.
    for entry in &started.entries {
        let path = entry.path.clone().unwrap();
        let changed = git::changed_files(&path);
        println!("{}: {:?}", entry.harness_id, changed);
        assert!(!changed.is_empty(), "{} changed nothing", entry.harness_id);
        assert_eq!(
            std::fs::read_to_string(path.join("seed.txt")).unwrap(),
            "alpha\ndelta\n",
            "{} should have edited only its own worktree",
            entry.harness_id
        );
    }

    let winner = started.entries[0].workspace_id.clone();
    comparison::resolve_in(&f.repo, &started, &winner).expect("resolve");
    assert!(started.entries[0].path.as_ref().unwrap().is_dir());
    assert!(!started.entries[1].path.as_ref().unwrap().exists());
    println!("kept {}", started.entries[0].harness_id);
}
