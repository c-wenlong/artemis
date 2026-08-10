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
use artemis_host::types::RuntimeEvent;

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
