//! End-to-end against the real `opencode` binary.
//!
//! Ignored by default: it needs opencode installed, authenticated, and costs a
//! model call. Run deliberately:
//!
//! ```text
//! OPENCODE_BIN=$(command -v opencode) \
//!   cargo test --test opencode_live -- --ignored --nocapture
//! ```
//!
//! Everything else about streaming is covered by fast tests with a fake
//! harness. This one exists to catch the thing fixtures cannot: opencode
//! changing its output format.

use std::sync::{Arc, Mutex};

use artemis_host::chat::log::EventLog;
use artemis_host::chat::stream::{new_turn_handle, run_turn, EventSink, TurnRequest};
use artemis_host::types::{HarnessKind, RuntimeEvent};

#[derive(Default)]
struct Collector {
    batches: Mutex<Vec<Vec<RuntimeEvent>>>,
}

impl EventSink for Collector {
    fn emit(&self, events: &[RuntimeEvent]) {
        self.batches.lock().unwrap().push(events.to_vec());
    }
}

fn opencode_binary() -> Option<String> {
    if let Ok(explicit) = std::env::var("OPENCODE_BIN") {
        return Some(explicit);
    }
    let home = std::env::var("HOME").ok()?;
    let candidate = format!("{home}/.opencode/bin/opencode");
    std::path::Path::new(&candidate)
        .is_file()
        .then_some(candidate)
}

#[test]
#[ignore]
fn streams_a_real_opencode_turn() {
    let Some(binary) = opencode_binary() else {
        eprintln!("opencode not found; set OPENCODE_BIN");
        return;
    };

    let dir = std::env::temp_dir().join("artemis-opencode-live");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let sink = Arc::new(Collector::default());
    let log = EventLog::in_dir(dir.clone(), "live-session");

    let outcome = run_turn(
        TurnRequest {
            kind: HarnessKind::Opencode,
            session_id: "live-session".into(),
            turn_id: "live-turn".into(),
            command: binary,
            args: vec![
                "run".into(),
                "--format".into(),
                "json".into(),
                "--dir".into(),
                dir.to_string_lossy().into_owned(),
                "reply with the single word: ok".into(),
            ],
            cwd: &dir,
            prompt: "reply with the single word: ok".into(),
            harness_id: "opencode".into(),
            workspace_id: "ws-live".into(),
        },
        new_turn_handle(),
        sink.clone(),
        &log,
    );

    let batches = sink.batches.lock().unwrap();
    let events: Vec<&RuntimeEvent> = batches.iter().flatten().collect();

    println!(
        "{} batches, {} events, opencode session {:?}",
        batches.len(),
        events.len(),
        outcome.opencode_session_id
    );

    assert!(!outcome.failed, "the turn should succeed");
    assert!(
        events
            .iter()
            .any(|e| matches!(e, RuntimeEvent::TextDelta { .. })),
        "a real turn produces text"
    );
    assert!(
        events.last().unwrap().is_terminal(),
        "the turn must end with a terminal event"
    );
    assert!(
        outcome.opencode_session_id.is_some(),
        "the opencode session id is needed to resume"
    );

    // Streaming means more than one delivery, not one blob at the end.
    assert!(
        batches.len() >= 3,
        "expected incremental batches, got {}",
        batches.len()
    );

    let replayed = log.read();
    assert_eq!(
        replayed.len(),
        events.len(),
        "the log must replay exactly what streamed"
    );

    let text: String = events
        .iter()
        .filter_map(|event| match event {
            RuntimeEvent::TextDelta { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    println!("assistant said: {text:?}");
    assert!(!text.trim().is_empty());
}

/// The edit path, end to end.
///
/// The parser previously read `state` as a status string when opencode sends an
/// object carrying `status`, `input`, `output` and `metadata.files`. The result
/// was tool calls named "tool" with no input and no file information at all,
/// which no fixture caught because the fixtures were written from the wrong
/// shape. This asks the real binary to edit a real file.
///
/// ```text
/// OPENCODE_BIN=$(command -v opencode) OPENCODE_MODEL=openai/gpt-5-mini \
///   cargo test --test opencode_live edits -- --ignored --nocapture
/// ```
#[test]
#[ignore]
fn reports_the_files_a_real_turn_edited() {
    let Some(binary) = opencode_binary() else {
        eprintln!("opencode not found; set OPENCODE_BIN");
        return;
    };

    let dir = std::env::temp_dir().join("artemis-opencode-live-edit");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\n").unwrap();

    let prompt = "Add a line reading 'delta' to the end of seed.txt. Use your edit tools.";
    let mut args = vec![
        "run".to_string(),
        "--format".into(),
        "json".into(),
        "--dir".into(),
        dir.to_string_lossy().into_owned(),
    ];
    if let Ok(model) = std::env::var("OPENCODE_MODEL") {
        args.push("--model".into());
        args.push(model);
    }
    args.push(prompt.to_string());

    let sink = Arc::new(Collector::default());
    let log = EventLog::in_dir(dir.clone(), "live-edit");
    let outcome = run_turn(
        TurnRequest {
            kind: HarnessKind::Opencode,
            session_id: "live-edit".into(),
            turn_id: "live-edit-turn".into(),
            command: binary,
            args,
            cwd: &dir,
            prompt: prompt.into(),
            harness_id: "opencode".into(),
            workspace_id: "ws-live".into(),
        },
        new_turn_handle(),
        sink.clone(),
        &log,
    );
    assert!(!outcome.failed, "the turn should succeed");

    let batches = sink.batches.lock().unwrap();
    let events: Vec<&RuntimeEvent> = batches.iter().flatten().collect();

    let named: Vec<&str> = events
        .iter()
        .filter_map(|event| match event {
            RuntimeEvent::ToolCallCompleted { name, .. } => name.as_deref(),
            RuntimeEvent::ToolCallStarted { name, .. } => Some(name.as_str()),
            _ => None,
        })
        .collect();
    println!("tools: {named:?}");
    assert!(
        !named.is_empty() && named.iter().all(|name| *name != "tool"),
        "every call should be named by what ran, got {named:?}"
    );

    let changes: Vec<_> = events
        .iter()
        .filter_map(|event| match event {
            RuntimeEvent::ToolCallCompleted { file_changes, .. } => file_changes.clone(),
            _ => None,
        })
        .flatten()
        .collect();
    println!("file changes: {changes:?}");

    // Workspace-relative, exactly. opencode's own `relativePath` is not: on
    // macOS `/var` symlinks to `/private/var`, and its path arithmetic returns a
    // stripped absolute path instead. This is the assertion that caught that.
    assert!(
        changes.iter().any(|change| change.path == "seed.txt"),
        "expected a relative seed.txt, got {changes:?}"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("seed.txt"))
            .unwrap()
            .lines()
            .count(),
        4,
        "and the file should really have been edited"
    );
}

/// Undo, against a patch a real model actually produced.
///
/// The fixture tests prove the reverse-apply logic; this proves the patch
/// opencode emits is one `git apply --reverse` will accept. Those are different
/// claims, and the second is the one that breaks when opencode changes format.
///
/// ```text
/// OPENCODE_BIN=$(command -v opencode) OPENCODE_MODEL=openai/gpt-5-mini \
///   cargo test --test opencode_live undo -- --ignored --nocapture
/// ```
#[test]
#[ignore]
fn undo_reverses_a_real_edit() {
    let Some(binary) = opencode_binary() else {
        eprintln!("opencode not found; set OPENCODE_BIN");
        return;
    };

    let dir = std::env::temp_dir().join("artemis-opencode-live-undo");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let original = "alpha\nbeta\ngamma\n";
    std::fs::write(dir.join("seed.txt"), original).unwrap();
    for args in [
        vec!["init", "-q"],
        vec!["config", "user.email", "t@example.com"],
        vec!["config", "user.name", "Test"],
        // Same reason as tests/revert.rs: these compare file contents, and a
        // Windows checkout would rewrite the line endings underneath them.
        vec!["config", "core.autocrlf", "false"],
        vec!["add", "-A"],
        vec!["commit", "-qm", "seed"],
    ] {
        std::process::Command::new("git")
            .args(&args)
            .current_dir(&dir)
            .output()
            .expect("git");
    }

    let prompt = "Add a line reading 'delta' to the end of seed.txt. Use your edit tools.";
    let mut args = vec![
        "run".to_string(),
        "--format".into(),
        "json".into(),
        "--dir".into(),
        dir.to_string_lossy().into_owned(),
    ];
    if let Ok(model) = std::env::var("OPENCODE_MODEL") {
        args.push("--model".into());
        args.push(model);
    }
    args.push(prompt.to_string());

    let sink = Arc::new(Collector::default());
    let log = EventLog::in_dir(dir.clone(), "live-undo");
    let outcome = run_turn(
        TurnRequest {
            kind: HarnessKind::Opencode,
            session_id: "live-undo".into(),
            turn_id: "live-undo-turn".into(),
            command: binary,
            args,
            cwd: &dir,
            prompt: prompt.into(),
            harness_id: "opencode".into(),
            workspace_id: "ws-live".into(),
        },
        new_turn_handle(),
        sink.clone(),
        &log,
    );
    assert!(!outcome.failed);
    assert_ne!(
        std::fs::read_to_string(dir.join("seed.txt")).unwrap(),
        original,
        "the model was supposed to edit the file"
    );

    let batches = sink.batches.lock().unwrap();
    let change = batches
        .iter()
        .flatten()
        .filter_map(|event| match event {
            RuntimeEvent::ToolCallCompleted { file_changes, .. } => file_changes.clone(),
            _ => None,
        })
        .flatten()
        .find(|change| change.path == "seed.txt")
        .expect("seed.txt should have been reported as changed");

    let patch = change.patch.as_deref().expect("with a patch attached");
    println!("reversing:\n{patch}");
    artemis_host::git::revert_patch(&dir, &change.path, patch).expect("undo should apply");

    assert_eq!(
        std::fs::read_to_string(dir.join("seed.txt")).unwrap(),
        original,
        "undo should have put the file back exactly"
    );
}

/// Codex, end to end through the same run loop.
///
/// The adapter is checked against a recorded capture in `tests/adapters.rs`;
/// this checks the parts a capture cannot, that the argv is right, that the
/// prompt reaches a harness which reads it from stdin, and that the events come
/// back through `run_turn` rather than only through the parser.
///
/// ```text
/// CODEX_BIN=$(command -v codex) \
///   cargo test --test opencode_live codex_turn -- --ignored --nocapture
/// ```
#[test]
#[ignore]
fn a_real_codex_turn_streams_and_edits() {
    let Ok(binary) = std::env::var("CODEX_BIN") else {
        eprintln!("set CODEX_BIN to run this");
        return;
    };

    let dir = std::env::temp_dir().join("artemis-codex-live");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("seed.txt"), "alpha\nbeta\ngamma\n").unwrap();

    let prompt = "Add a line reading 'delta' to the end of seed.txt.";
    let mut args =
        artemis_host::chat::adapters::argv(HarnessKind::Codex, &dir.to_string_lossy(), None, None);
    // The sandbox is already a throwaway directory; approvals would block a
    // non-interactive run forever.
    args.insert(1, "--dangerously-bypass-approvals-and-sandbox".into());

    let sink = Arc::new(Collector::default());
    let log = EventLog::in_dir(dir.clone(), "codex-live");
    let outcome = run_turn(
        TurnRequest {
            kind: HarnessKind::Codex,
            session_id: "codex-live".into(),
            turn_id: "codex-live-turn".into(),
            command: binary,
            args,
            cwd: &dir,
            prompt: prompt.into(),
            harness_id: "codex".into(),
            workspace_id: "ws-live".into(),
        },
        new_turn_handle(),
        sink.clone(),
        &log,
    );

    let batches = sink.batches.lock().unwrap();
    let events: Vec<&RuntimeEvent> = batches.iter().flatten().collect();
    println!("{} events, failed={}", events.len(), outcome.failed);

    assert!(!outcome.failed, "the turn should succeed");
    assert!(
        events
            .iter()
            .any(|e| matches!(e, RuntimeEvent::TextDelta { .. })),
        "codex should have said something"
    );
    assert!(
        outcome.opencode_session_id.is_some(),
        "the thread id is what lets the next turn resume"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("seed.txt")).unwrap(),
        "alpha\nbeta\ngamma\ndelta\n",
        "and the edit should really have happened"
    );
}
