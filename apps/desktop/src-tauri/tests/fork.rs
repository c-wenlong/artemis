//! Forking a conversation.
//!
//! A fork copies the transcript up to a chosen turn into a new session, so the
//! user can take a conversation in a second direction without losing the first.

use artemis_host::chat::{log::EventLog, ChatStore};
use artemis_host::db::Db;
use artemis_host::types::{CreateChatSessionRequest, RuntimeEvent};
use std::path::PathBuf;
use std::sync::Arc;

/// A private directory per test, named for the test rather than randomised so a
/// failure leaves something inspectable.
fn store(name: &str) -> (ChatStore, PathBuf) {
    let dir = std::env::temp_dir().join(format!("artemis-fork-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    let db = Db::open(&dir.join("artemis.db")).expect("db");
    (ChatStore::new(Arc::new(db)), dir)
}

fn seed(session_id: &str, dir: &std::path::Path) {
    let log = EventLog::in_dir(dir.to_path_buf(), session_id);
    let mut events = Vec::new();
    for turn in ["turn-1", "turn-2"] {
        events.push(RuntimeEvent::UserMessage {
            id: format!("{turn}-user"),
            session_id: session_id.to_string(),
            timestamp: "2026-08-11T09:00:00Z".into(),
            turn_id: turn.to_string(),
            text: format!("prompt for {turn}"),
        });
        events.push(RuntimeEvent::TurnCompleted {
            id: format!("{turn}-done"),
            session_id: session_id.to_string(),
            timestamp: "2026-08-11T09:01:00Z".into(),
            turn_id: turn.to_string(),
            opencode_session_id: Some("oc-original".into()),
        });
    }
    log.append(&events);
}

fn session_request() -> CreateChatSessionRequest {
    CreateChatSessionRequest {
        harness_id: "opencode".into(),
        model: Some("anthropic/claude-opus-5".into()),
        opencode_session_id: Some("oc-original".into()),
        start_path: None,
        title: Some("Original".into()),
        workspace_id: "ws-artemis".into(),
        workspace_path: "/work/artemis".into(),
    }
}

#[test]
fn a_fork_keeps_only_the_turns_up_to_the_one_chosen() {
    let (store, dir) = store("keeps_chosen_turn");
    let source = store.create_session(session_request());
    seed(&source.id, &dir);

    let forked = store
        .fork_session_in(&dir, &source.id, "turn-1")
        .expect("fork");

    let events = EventLog::in_dir(dir.clone(), &forked.id).read();
    let turns: Vec<&str> = events.iter().map(RuntimeEvent::turn_id).collect();
    assert_eq!(
        turns,
        vec!["turn-1", "turn-1"],
        "the fork should stop after the chosen turn"
    );
}

#[test]
fn the_copied_events_belong_to_the_new_session() {
    let (store, dir) = store("copied_events_rebound");
    let source = store.create_session(session_request());
    seed(&source.id, &dir);

    let forked = store
        .fork_session_in(&dir, &source.id, "turn-2")
        .expect("fork");

    assert_ne!(forked.id, source.id, "a fork is a different session");
    for event in EventLog::in_dir(dir.clone(), &forked.id).read() {
        assert_eq!(
            event.session_id(),
            forked.id,
            "an event still pointing at the original would replay into it"
        );
    }
}

#[test]
fn the_original_is_left_alone() {
    let (store, dir) = store("original_untouched");
    let source = store.create_session(session_request());
    seed(&source.id, &dir);
    store
        .fork_session_in(&dir, &source.id, "turn-1")
        .expect("fork");

    let events = EventLog::in_dir(dir.clone(), &source.id).read();
    assert_eq!(events.len(), 4, "the source log must not be truncated");
}

/// Reusing the opencode session id would make the fork an alias: both sides
/// would append to one server-side conversation and immediately entangle. The
/// transcript is copied; the harness context is not.
#[test]
fn a_fork_does_not_inherit_the_opencode_session() {
    let (store, dir) = store("no_inherited_opencode");
    let source = store.create_session(session_request());
    seed(&source.id, &dir);

    let forked = store
        .fork_session_in(&dir, &source.id, "turn-1")
        .expect("fork");
    assert!(forked.opencode_session_id.is_none());
    assert_eq!(forked.harness_id, source.harness_id);
    assert_eq!(forked.workspace_id, source.workspace_id);
    assert_eq!(forked.model, source.model);
}

#[test]
fn forks_do_not_collide() {
    let (store, dir) = store("no_collision");
    let source = store.create_session(session_request());
    seed(&source.id, &dir);

    let first = store
        .fork_session_in(&dir, &source.id, "turn-1")
        .expect("first");
    let second = store
        .fork_session_in(&dir, &source.id, "turn-1")
        .expect("second");
    assert_ne!(first.id, second.id);
}

#[test]
fn forking_an_unknown_turn_fails_rather_than_producing_an_empty_session() {
    let (store, dir) = store("unknown_turn");
    let source = store.create_session(session_request());
    seed(&source.id, &dir);

    assert!(store.fork_session_in(&dir, &source.id, "turn-99").is_none());
    assert!(store
        .fork_session_in(&dir, "no-such-session", "turn-1")
        .is_none());
}
