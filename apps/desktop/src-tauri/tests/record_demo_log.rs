//! Records a real opencode turn into the session log for a real workspace.
//!
//! Ignored by default; it needs opencode and costs a model call. Its purpose is
//! to give the browser preview something genuine to render, so the transcript
//! can be looked at without driving the desktop window:
//!
//! ```text
//! ARTEMIS_SCAN_ROOT=<repo> cargo test --test record_demo_log -- --ignored --nocapture
//! pnpm --dir apps/desktop run dev:web
//! ```
//!
//! It writes only what opencode actually emitted: no fabricated events.

use std::sync::Arc;

use artemis_host::chat::stream::EventSink;
use artemis_host::chat::ChatStore;
use artemis_host::db::Db;
use artemis_host::types::{CreateChatSessionRequest, RuntimeEvent, SendChatMessageRequest};

struct Printer;

impl EventSink for Printer {
    fn emit(&self, events: &[RuntimeEvent]) {
        for event in events {
            let kind = match event {
                RuntimeEvent::TextDelta { .. } => "text",
                RuntimeEvent::ReasoningDelta { .. } => "reasoning",
                RuntimeEvent::ToolCallStarted { name, .. } => name,
                RuntimeEvent::ToolCallCompleted { .. } => "tool done",
                RuntimeEvent::ToolCallErrored { .. } => "tool failed",
                RuntimeEvent::TurnStarted { .. } => "turn start",
                RuntimeEvent::UserMessage { .. } => "user",
                RuntimeEvent::TurnCompleted { .. } => "turn done",
                RuntimeEvent::TurnErrored { .. } => "turn failed",
            };
            println!("  · {kind}");
        }
    }
}

#[test]
#[ignore]
fn record_a_demo_turn() {
    let store = ChatStore::new(Arc::new(Db::in_memory().expect("db")));

    // Use the first workspace the host actually reports, so the recorded log
    // lands under the session id the UI will ask for.
    let workspace = artemis_host::workspace::list_workspaces(None)
        .into_iter()
        .next()
        .expect("at least one workspace under ARTEMIS_SCAN_ROOT");
    println!("workspace: {} at {}", workspace.id, workspace.worktree_path);

    let session = store.create_session(CreateChatSessionRequest {
        harness_id: "opencode".into(),
        model: None,
        opencode_session_id: None,
        start_path: None,
        title: None,
        workspace_id: workspace.id.clone(),
        workspace_path: workspace.worktree_path.clone(),
    });
    println!("session:   {}", session.id);

    let result = store.send_message(
        &session.id,
        SendChatMessageRequest {
            // Phrased to make the agent read a few files, so the transcript has
            // a run of tool calls worth grouping.
            prompt: std::env::var("ARTEMIS_DEMO_PROMPT").unwrap_or_else(|_| {
                // Phrased to make the agent read a few files, so the transcript
                // has a run of tool calls worth grouping.
                "List the Rust source files under src-tauri/src and say in one \
                 sentence what each of the three smallest ones does."
                    .to_string()
            }),
            start_path: None,
        },
        Arc::new(Printer),
    );

    println!("result: {result:?}");
    let recorded = ChatStore::replay(&session.id);
    println!("recorded {} events", recorded.len());
    assert!(!recorded.is_empty(), "the log should hold the turn");
}
