//! Harness adapters, and the conformance every one of them owes.
//!
//! Three harnesses emit three unrelated JSON protocols. What the transcript
//! needs from all of them is the same, so the interesting tests here are the
//! ones run against *every* adapter over its own fixture: whatever the wire
//! shape, a turn must produce prose, pair its tool calls, end with a terminal
//! event, and never panic on a truncated line.
//!
//! Fixtures under `tests/fixtures/harnesses/` come from live runs:
//!
//! - `codex.jsonl` is a real `codex exec --json` capture that really did edit a
//!   file, with this machine's paths neutralised.
//! - `claude.jsonl` uses the envelope from a real `claude -p --output-format
//!   stream-json` run and content blocks in the shapes read out of Claude
//!   Code's own session logs. The content is invented; every key and type in it
//!   was observed. Claude's OAuth had expired on the machine this was written
//!   on, so a live end-to-end run of the tool path is still owed — see
//!   `opencode_live.rs` for the pattern that check should follow.

use artemis_host::chat::adapters::{self, HarnessAdapter};
use artemis_host::types::{HarnessKind, RuntimeEvent};
use std::path::Path;

fn fixture(name: &str) -> Vec<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/harnesses")
        .join(name);
    std::fs::read_to_string(path)
        .expect("fixture")
        .lines()
        .map(str::to_string)
        .collect()
}

fn adapter(kind: HarnessKind) -> Box<dyn HarnessAdapter> {
    adapters::for_kind(kind, "session-1".into(), "turn-1".into())
        .unwrap_or_else(|| panic!("{kind:?} should have an adapter"))
}

/// Every harness with an adapter, and the capture it is checked against.
fn conformance_set() -> Vec<(HarnessKind, &'static str)> {
    vec![
        (HarnessKind::Opencode, "../opencode-apply-patch.jsonl"),
        (HarnessKind::Codex, "codex.jsonl"),
        (HarnessKind::Claude, "claude.jsonl"),
    ]
}

fn drain(kind: HarnessKind, name: &str) -> Vec<RuntimeEvent> {
    let mut adapter = adapter(kind);
    fixture(name)
        .iter()
        .flat_map(|line| adapter.parse_line(line))
        .collect()
}

fn text_of(events: &[RuntimeEvent]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            RuntimeEvent::TextDelta { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

// -------------------------------------------------------------- conformance

#[test]
fn every_adapter_produces_prose() {
    for (kind, name) in conformance_set() {
        let events = drain(kind, name);
        assert!(
            !text_of(&events).trim().is_empty(),
            "{kind:?} produced no answer at all"
        );
    }
}

#[test]
fn every_adapter_names_the_tools_it_ran() {
    for (kind, name) in conformance_set() {
        let events = drain(kind, name);
        let names: Vec<&str> = events
            .iter()
            .filter_map(|event| match event {
                RuntimeEvent::ToolCallStarted { name, .. } => Some(name.as_str()),
                RuntimeEvent::ToolCallCompleted { name, .. } => name.as_deref(),
                _ => None,
            })
            .collect();
        assert!(!names.is_empty(), "{kind:?} reported no tool calls");
        assert!(
            names.iter().all(|name| !name.is_empty() && *name != "tool"),
            "{kind:?} left a call unnamed: {names:?}"
        );
    }
}

/// A block that starts and never finishes leaves a spinner running forever.
#[test]
fn every_adapter_closes_the_calls_it_opens() {
    for (kind, name) in conformance_set() {
        let events = drain(kind, name);
        let mut open: Vec<&str> = Vec::new();
        for event in &events {
            match event {
                RuntimeEvent::ToolCallStarted { block_id, .. } => open.push(block_id),
                RuntimeEvent::ToolCallCompleted { block_id, .. }
                | RuntimeEvent::ToolCallErrored { block_id, .. } => {
                    open.retain(|id| id != block_id)
                }
                _ => {}
            }
        }
        assert!(open.is_empty(), "{kind:?} left {open:?} running");
    }
}

#[test]
fn every_adapter_stamps_its_events_with_the_session_and_turn() {
    for (kind, name) in conformance_set() {
        for event in drain(kind, name) {
            assert_eq!(event.session_id(), "session-1", "{kind:?}");
            assert_eq!(event.turn_id(), "turn-1", "{kind:?}");
        }
    }
}

/// Junk on stdout is normal — a warning, a progress line, a half-written frame
/// from a killed process. None of it may take the turn down.
#[test]
fn every_adapter_survives_rubbish_on_stdout() {
    for (kind, _) in conformance_set() {
        let mut adapter = adapter(kind);
        for junk in [
            "",
            "   ",
            "not json at all",
            "{\"type\":\"assistant\",\"message\":", // truncated mid-frame
            "{}",
            "[]",
            "null",
            "{\"type\":\"totally-unknown-frame\"}",
        ] {
            let events = adapter.parse_line(junk);
            assert!(events.is_empty(), "{kind:?} invented events from {junk:?}");
        }
    }
}

#[test]
fn every_adapter_reports_the_id_needed_to_resume() {
    for (kind, name) in conformance_set() {
        let mut adapter = adapter(kind);
        for line in fixture(name) {
            adapter.parse_line(&line);
        }
        assert!(
            adapter.observed_session_id().is_some(),
            "{kind:?} never reported a session id, so its next turn cannot resume"
        );
    }
}

// ------------------------------------------------------- per-harness detail

#[test]
fn codex_reads_its_own_item_protocol() {
    let events = drain(HarnessKind::Codex, "codex.jsonl");

    assert!(text_of(&events).contains("Added `delta`"));

    let commands: Vec<&str> = events
        .iter()
        .filter_map(|event| match event {
            RuntimeEvent::ToolCallStarted { name, .. } => Some(name.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        commands.contains(&"command_execution"),
        "the shell call should be a tool call: {commands:?}"
    );
}

/// Codex reports edits as first-class `file_change` items rather than leaving
/// them to be inferred from a tool's arguments.
#[test]
fn codex_reports_file_changes_natively() {
    let changes: Vec<_> = drain(HarnessKind::Codex, "codex.jsonl")
        .into_iter()
        .filter_map(|event| match event {
            RuntimeEvent::ToolCallCompleted { file_changes, .. } => file_changes,
            _ => None,
        })
        .flatten()
        .collect();

    assert_eq!(changes.len(), 1, "one file was edited");
    assert_eq!(changes[0].path, "seed.txt", "relative to the workspace");
    // Codex names the file but sends no diff, so there is nothing to count.
    // Reporting zero would read as "changed nothing".
    assert_eq!(changes[0].additions, 0);
    assert!(changes[0].patch.is_none());
}

#[test]
fn claude_reads_anthropic_content_blocks() {
    let events = drain(HarnessKind::Claude, "claude.jsonl");

    assert!(text_of(&events).contains("Added `delta`"));
    assert!(
        events
            .iter()
            .any(|event| matches!(event, RuntimeEvent::ReasoningDelta { .. })),
        "a thinking block is reasoning, not prose"
    );

    let edit = events.iter().find_map(|event| match event {
        RuntimeEvent::ToolCallStarted { name, input, .. } if name == "Edit" => Some(input.clone()),
        _ => None,
    });
    assert!(
        edit.expect("the Edit call").unwrap().contains("seed.txt"),
        "the tool's arguments are what say which file"
    );
}

/// Claude's hook chatter is machinery, not conversation.
#[test]
fn claude_ignores_its_own_hook_frames() {
    let mut adapter = adapter(HarnessKind::Claude);
    let events = adapter.parse_line(
        r#"{"type":"system","subtype":"hook_started","hook_name":"PreToolUse","hook_id":"h1"}"#,
    );
    assert!(events.is_empty());
}

#[test]
fn claude_surfaces_a_failed_run() {
    let mut adapter = adapter(HarnessKind::Claude);
    adapter.parse_line(
        r#"{"type":"assistant","message":{"content":[{"type":"text",
           "text":"Failed to authenticate: OAuth session expired"}]}}"#,
    );
    adapter.parse_line(r#"{"type":"result","subtype":"error","is_error":true}"#);

    assert!(
        adapter.error_message().is_some(),
        "a run that failed must not read as a run that succeeded"
    );
}

// ------------------------------------------------------------- degradation

/// The exit criterion's second half: a harness with no adapter is not broken,
/// it is a terminal. Saying so is what lets the UI route it to the dock.
#[test]
fn a_harness_without_an_adapter_says_so_rather_than_half_working() {
    assert!(adapters::for_kind(HarnessKind::Amp, "s".into(), "t".into()).is_none());
    assert!(adapters::for_kind(HarnessKind::Custom, "s".into(), "t".into()).is_none());
    assert!(!adapters::supports_streaming(HarnessKind::Amp));
    assert!(!adapters::supports_streaming(HarnessKind::Gemini));
}

#[test]
fn the_three_adapted_harnesses_are_the_ones_that_stream() {
    for kind in [
        HarnessKind::Opencode,
        HarnessKind::Codex,
        HarnessKind::Claude,
    ] {
        assert!(adapters::supports_streaming(kind), "{kind:?}");
        assert!(adapters::for_kind(kind, "s".into(), "t".into()).is_some());
    }
}

/// Each harness needs its own argv, and getting one wrong is a turn that never
/// starts. Pinned because they are easy to break and invisible until run.
#[test]
fn each_harness_is_invoked_the_way_it_expects() {
    let opencode = adapters::argv(HarnessKind::Opencode, "/work", None, None);
    assert_eq!(opencode[..3], ["run", "--format", "json"]);

    let codex = adapters::argv(HarnessKind::Codex, "/work", None, None);
    assert!(codex.contains(&"exec".to_string()));
    assert!(codex.contains(&"--json".to_string()));

    let claude = adapters::argv(HarnessKind::Claude, "/work", None, None);
    assert!(claude.contains(&"--output-format".to_string()));
    assert!(
        claude.contains(&"stream-json".to_string()) && claude.contains(&"--verbose".to_string()),
        "claude only streams json with --verbose: {claude:?}"
    );
}

#[test]
fn resuming_passes_the_harness_its_own_session_id() {
    let opencode = adapters::argv(HarnessKind::Opencode, "/work", None, Some("ses_1"));
    assert!(opencode.windows(2).any(|w| w == ["--session", "ses_1"]));

    let claude = adapters::argv(HarnessKind::Claude, "/work", None, Some("uuid-1"));
    assert!(claude.windows(2).any(|w| w == ["--resume", "uuid-1"]));

    // `codex exec resume [OPTIONS] <SESSION_ID>`, so the id trails the flags
    // rather than sitting immediately after the subcommand.
    let codex = adapters::argv(HarnessKind::Codex, "/work", None, Some("thread-1"));
    let resume = codex
        .iter()
        .position(|arg| arg == "resume")
        .expect("resume");
    let id = codex.iter().position(|arg| arg == "thread-1").expect("id");
    assert!(resume < id, "{codex:?}");
}
