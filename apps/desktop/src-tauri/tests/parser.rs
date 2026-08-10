//! OpenCode stdout → `RuntimeEvent`.
//!
//! Ported from `packages/host-service/src/node/opencodeChat.ts`. The shapes here
//! are the ones opencode actually emits: JSON lines whose structure varies by
//! version, carrying **cumulative** text per part rather than deltas.
//!
//! Written before the parser existed. The load-bearing case is
//! `cumulative_text_becomes_deltas` — get that wrong and the UI renders every
//! token repeated.

use artemis_host::chat::parser::OpenCodeParser;
use artemis_host::types::RuntimeEvent;
use serde_json::json;

fn parser() -> OpenCodeParser {
    OpenCodeParser::new("session-1".into(), "turn-1".into())
}

fn text_of(event: &RuntimeEvent) -> Option<&str> {
    match event {
        RuntimeEvent::TextDelta { text, .. } | RuntimeEvent::ReasoningDelta { text, .. } => {
            Some(text)
        }
        _ => None,
    }
}

#[test]
fn ignores_lines_that_are_not_json() {
    let mut parser = parser();
    assert!(parser.parse_line("not json at all").is_empty());
    assert!(parser.parse_line("").is_empty());
}

#[test]
fn emits_a_text_delta() {
    let mut parser = parser();
    let events =
        parser.parse_line(&json!({ "type": "text", "id": "p1", "text": "Hello" }).to_string());
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], RuntimeEvent::TextDelta { .. }));
    assert_eq!(text_of(&events[0]), Some("Hello"));
}

/// OpenCode resends the whole part each time it grows. Emitting the raw text
/// would repeat everything already shown.
#[test]
fn cumulative_text_becomes_deltas() {
    let mut parser = parser();
    let first =
        parser.parse_line(&json!({ "type": "text", "id": "p1", "text": "Hel" }).to_string());
    let second =
        parser.parse_line(&json!({ "type": "text", "id": "p1", "text": "Hello" }).to_string());
    let third = parser
        .parse_line(&json!({ "type": "text", "id": "p1", "text": "Hello there" }).to_string());

    assert_eq!(text_of(&first[0]), Some("Hel"));
    assert_eq!(text_of(&second[0]), Some("lo"));
    assert_eq!(text_of(&third[0]), Some(" there"));
}

#[test]
fn unchanged_text_emits_nothing() {
    let mut parser = parser();
    parser.parse_line(&json!({ "type": "text", "id": "p1", "text": "same" }).to_string());
    let repeat =
        parser.parse_line(&json!({ "type": "text", "id": "p1", "text": "same" }).to_string());
    assert!(repeat.is_empty(), "a resend with no growth is not a delta");
}

/// If the text is rewritten rather than appended, the prefix no longer matches;
/// replaying the whole value is the only safe reading.
#[test]
fn rewritten_text_falls_back_to_the_full_value() {
    let mut parser = parser();
    parser.parse_line(&json!({ "type": "text", "id": "p1", "text": "abc" }).to_string());
    let rewritten =
        parser.parse_line(&json!({ "type": "text", "id": "p1", "text": "xyz" }).to_string());
    assert_eq!(text_of(&rewritten[0]), Some("xyz"));
}

#[test]
fn tracks_blocks_independently() {
    let mut parser = parser();
    parser.parse_line(&json!({ "type": "text", "id": "a", "text": "one" }).to_string());
    parser.parse_line(&json!({ "type": "text", "id": "b", "text": "two" }).to_string());
    let a = parser.parse_line(&json!({ "type": "text", "id": "a", "text": "one!" }).to_string());
    assert_eq!(text_of(&a[0]), Some("!"));
}

#[test]
fn classifies_reasoning_by_any_of_its_names() {
    for kind in ["reasoning", "thinking", "thought"] {
        let mut parser = parser();
        let events =
            parser.parse_line(&json!({ "type": kind, "id": "r1", "text": "hmm" }).to_string());
        assert!(
            matches!(events[0], RuntimeEvent::ReasoningDelta { .. }),
            "{kind} should read as reasoning"
        );
    }
}

#[test]
fn emits_tool_started_once_per_block() {
    let mut parser = parser();
    let line = json!({
        "type": "tool", "id": "t1", "tool": "bash", "input": { "command": "ls" }
    })
    .to_string();
    let first = parser.parse_line(&line);
    let second = parser.parse_line(&line);

    assert_eq!(first.len(), 1);
    match &first[0] {
        RuntimeEvent::ToolCallStarted { name, input, .. } => {
            assert_eq!(name, "bash");
            assert!(input.as_deref().unwrap().contains("ls"));
        }
        other => panic!("expected tool_call.started, got {other:?}"),
    }
    assert!(second.is_empty(), "a repeated start is not a second call");
}

#[test]
fn completes_and_errors_tool_calls() {
    let mut parser = parser();
    let done = parser.parse_line(
        &json!({ "type": "tool", "id": "t1", "tool": "bash", "status": "completed",
                 "output": "file.txt" })
        .to_string(),
    );
    assert!(matches!(done[0], RuntimeEvent::ToolCallCompleted { .. }));

    let failed = parser.parse_line(
        &json!({ "type": "tool", "id": "t2", "tool": "bash", "status": "error",
                 "output": "boom" })
        .to_string(),
    );
    assert!(matches!(failed[0], RuntimeEvent::ToolCallErrored { .. }));
}

#[test]
fn reads_tool_status_from_the_event_type_when_the_part_omits_it() {
    let mut parser = parser();
    let events = parser.parse_line(
        &json!({ "type": "tool.result", "id": "t1", "tool": "read", "text": "contents" })
            .to_string(),
    );
    assert!(
        matches!(events[0], RuntimeEvent::ToolCallCompleted { .. }),
        "a `result` event type means the call finished"
    );
}

#[test]
fn finds_parts_nested_inside_an_envelope() {
    let mut parser = parser();
    let events = parser.parse_line(
        &json!({
            "type": "message.part.updated",
            "properties": { "part": { "type": "text", "id": "p9", "text": "nested" } }
        })
        .to_string(),
    );
    assert_eq!(text_of(&events[0]), Some("nested"));
}

#[test]
fn observes_the_opencode_session_id_for_resumption() {
    let mut parser = parser();
    parser.parse_line(
        &json!({ "type": "text", "id": "p1", "text": "hi", "sessionID": "ses_abc" }).to_string(),
    );
    assert_eq!(parser.observed_session_id(), Some("ses_abc"));
}

#[test]
fn captures_the_first_error_message() {
    let mut parser = parser();
    parser.parse_line(
        &json!({ "type": "error", "error": { "name": "ProviderError",
                 "message": "no credits" } })
        .to_string(),
    );
    let message = parser.error_message().expect("an error was reported");
    assert!(message.contains("no credits"), "got {message}");
    assert!(message.contains("ProviderError"), "got {message}");

    parser.parse_line(&json!({ "type": "error", "error": { "message": "second" } }).to_string());
    assert!(
        parser.error_message().unwrap().contains("no credits"),
        "the first error is the cause; later ones are usually fallout"
    );
}

/// Captured from a real `opencode run --format json --thinking` invocation
/// rather than written from the docs — the envelope wraps the content in
/// `part`, and `step_start` / `step_finish` frames carry no content at all.
#[test]
fn handles_the_real_opencode_envelope() {
    let mut parser = parser();

    let step_start = r#"{"type":"step_start","timestamp":1786364754033,"sessionID":"ses_0145d364effezoFs6VY738muXR","part":{"id":"prt_feba2f86d001d6d1XtCrq2EUBY","messageID":"msg_feba2d193001UrD8dXpRLhigTs","sessionID":"ses_0145d364effezoFs6VY738muXR","type":"step-start"}}"#;
    assert!(
        parser.parse_line(step_start).is_empty(),
        "step frames carry no content and must not become blocks"
    );

    let reasoning = r#"{"type":"reasoning","timestamp":1786364754626,"sessionID":"ses_0145d364effezoFs6VY738muXR","part":{"id":"prt_feba2f885001DknKEPWNc7eFZ3","messageID":"msg_x","sessionID":"ses_0145d364effezoFs6VY738muXR","type":"reasoning","text":"The user asked"}}"#;
    let events = parser.parse_line(reasoning);
    assert!(matches!(events[0], RuntimeEvent::ReasoningDelta { .. }));
    assert_eq!(text_of(&events[0]), Some("The user asked"));

    let text = r#"{"type":"text","timestamp":1786364754655,"sessionID":"ses_0145d364effezoFs6VY738muXR","part":{"id":"prt_feba2fac0001iXbt822QGip2li","messageID":"msg_x","sessionID":"ses_0145d364effezoFs6VY738muXR","type":"text","text":"ok"}}"#;
    let events = parser.parse_line(text);
    assert!(matches!(events[0], RuntimeEvent::TextDelta { .. }));
    assert_eq!(text_of(&events[0]), Some("ok"));

    let step_finish = r#"{"type":"step_finish","timestamp":1786364754673,"sessionID":"ses_0145d364effezoFs6VY738muXR","part":{"id":"prt_feba2fae1001VnKVA3PmOUv8MI","reason":"stop","messageID":"msg_x","sessionID":"ses_0145d364effezoFs6VY738muXR","type":"step-finish"}}"#;
    assert!(parser.parse_line(step_finish).is_empty());

    assert_eq!(
        parser.observed_session_id(),
        Some("ses_0145d364effezoFs6VY738muXR"),
        "the opencode session id is what lets the next turn resume"
    );
    assert!(parser.error_message().is_none());
}

#[test]
fn every_event_carries_session_and_turn_identity() {
    let mut parser = parser();
    let events =
        parser.parse_line(&json!({ "type": "text", "id": "p1", "text": "hi" }).to_string());
    match &events[0] {
        RuntimeEvent::TextDelta {
            session_id,
            turn_id,
            id,
            ..
        } => {
            assert_eq!(session_id, "session-1");
            assert_eq!(turn_id, "turn-1");
            assert!(!id.is_empty(), "events need their own id");
        }
        other => panic!("unexpected {other:?}"),
    }
}
