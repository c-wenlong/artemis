//! Persisted state: chat sessions and launch presets.
//!
//! Two things justify a database here rather than more JSON files. The first is
//! `opencode_session_id` — without it a restart cannot resume a conversation
//! with its context, so the agent starts over having forgotten everything. The
//! second is crash recovery: a session left marked `running` by a hard quit has
//! to be corrected on the next launch, or the UI shows a spinner for work that
//! stopped when the process died.
//!
//! The event log stays as JSONL; see the note in `chat/log.rs`.

use artemis_host::db::Db;
use artemis_host::types::{ChatSession, ChatSessionStatus, HarnessKind};

fn session(id: &str, status: ChatSessionStatus) -> ChatSession {
    ChatSession {
        created_at: "2026-08-10T12:00:00Z".into(),
        harness_id: "opencode".into(),
        harness_kind: Some(HarnessKind::Opencode),
        id: id.into(),
        last_event_at: "2026-08-10T12:05:00Z".into(),
        model: Some("anthropic/claude-opus-5".into()),
        opencode_session_id: Some("ses_abc123".into()),
        start_path: Some("packages/core".into()),
        status,
        title: "explain the scanner".into(),
        workspace_id: "ws-artemis".into(),
        workspace_path: "/work/artemis".into(),
    }
}

#[test]
fn a_fresh_database_is_migrated_to_the_current_schema() {
    let db = Db::in_memory().expect("opens");
    assert_eq!(db.schema_version().unwrap(), Db::SCHEMA_VERSION);
}

#[test]
fn migrations_are_idempotent() {
    let path = std::env::temp_dir().join("artemis-db-idempotent.sqlite");
    let _ = std::fs::remove_file(&path);

    {
        let db = Db::open(&path).expect("first open");
        db.save_session(&session("chat-1", ChatSessionStatus::Idle))
            .unwrap();
    }
    // Reopening must migrate to the same version without touching the rows.
    {
        let db = Db::open(&path).expect("second open");
        assert_eq!(db.schema_version().unwrap(), Db::SCHEMA_VERSION);
        assert!(db.session("chat-1").unwrap().is_some());
    }

    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_session_round_trips_every_field() {
    let db = Db::in_memory().unwrap();
    let original = session("chat-1", ChatSessionStatus::Idle);
    db.save_session(&original).unwrap();

    let loaded = db.session("chat-1").unwrap().expect("the session");
    assert_eq!(loaded.id, original.id);
    assert_eq!(loaded.workspace_id, original.workspace_id);
    assert_eq!(loaded.workspace_path, original.workspace_path);
    assert_eq!(loaded.harness_id, original.harness_id);
    assert_eq!(loaded.model, original.model);
    assert_eq!(loaded.start_path, original.start_path);
    assert_eq!(loaded.title, original.title);
    assert_eq!(loaded.status, original.status);
    assert_eq!(loaded.created_at, original.created_at);
    assert_eq!(loaded.last_event_at, original.last_event_at);
}

/// Without this, a restart starts the conversation over and the agent has
/// forgotten everything it was told.
#[test]
fn the_opencode_session_id_survives_a_restart() {
    let path = std::env::temp_dir().join("artemis-db-resume.sqlite");
    let _ = std::fs::remove_file(&path);

    {
        let db = Db::open(&path).unwrap();
        db.save_session(&session("chat-1", ChatSessionStatus::Idle))
            .unwrap();
    }
    {
        let db = Db::open(&path).unwrap();
        let loaded = db.session("chat-1").unwrap().unwrap();
        assert_eq!(loaded.opencode_session_id.as_deref(), Some("ses_abc123"));
    }

    let _ = std::fs::remove_file(&path);
}

#[test]
fn saving_the_same_session_updates_it_rather_than_duplicating() {
    let db = Db::in_memory().unwrap();
    db.save_session(&session("chat-1", ChatSessionStatus::Idle))
        .unwrap();

    let mut updated = session("chat-1", ChatSessionStatus::Running);
    updated.title = "a later title".into();
    updated.opencode_session_id = Some("ses_later".into());
    db.save_session(&updated).unwrap();

    assert_eq!(db.sessions().unwrap().len(), 1);
    let loaded = db.session("chat-1").unwrap().unwrap();
    assert_eq!(loaded.title, "a later title");
    assert_eq!(loaded.opencode_session_id.as_deref(), Some("ses_later"));
}

#[test]
fn an_unknown_session_reads_as_absent_not_an_error() {
    let db = Db::in_memory().unwrap();
    assert!(db.session("never-saved").unwrap().is_none());
}

/**
 * The crash case. A hard quit leaves whatever was in flight marked `running`;
 * nothing is running after the process dies, so the next launch has to say so
 * rather than showing a spinner for work that ended.
 */
#[test]
fn recovery_stops_sessions_left_running_by_a_crash() {
    let db = Db::in_memory().unwrap();
    db.save_session(&session("chat-running", ChatSessionStatus::Running))
        .unwrap();
    db.save_session(&session("chat-idle", ChatSessionStatus::Idle))
        .unwrap();
    db.save_session(&session("chat-failed", ChatSessionStatus::Failed))
        .unwrap();

    let corrected = db.recover_interrupted_sessions().unwrap();
    assert_eq!(corrected, 1, "only the running one needed correcting");

    assert_eq!(
        db.session("chat-running").unwrap().unwrap().status,
        ChatSessionStatus::Stopped
    );
    // Sessions that had already finished are left exactly as they were.
    assert_eq!(
        db.session("chat-idle").unwrap().unwrap().status,
        ChatSessionStatus::Idle
    );
    assert_eq!(
        db.session("chat-failed").unwrap().unwrap().status,
        ChatSessionStatus::Failed
    );
}

#[test]
fn recovery_is_safe_to_run_when_nothing_was_interrupted() {
    let db = Db::in_memory().unwrap();
    db.save_session(&session("chat-1", ChatSessionStatus::Idle))
        .unwrap();
    assert_eq!(db.recover_interrupted_sessions().unwrap(), 0);
}

#[test]
fn sessions_can_be_found_by_workspace() {
    let db = Db::in_memory().unwrap();
    let mut other = session("chat-other", ChatSessionStatus::Idle);
    other.workspace_id = "ws-quiver".into();

    db.save_session(&session("chat-1", ChatSessionStatus::Idle))
        .unwrap();
    db.save_session(&other).unwrap();

    let found = db.sessions_for_workspace("ws-artemis").unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].id, "chat-1");
}

// ------------------------------------------------------------------ presets

#[test]
fn a_launch_preset_round_trips() {
    let db = Db::in_memory().unwrap();
    db.save_preset("ws-artemis", "claude", Some("anthropic/claude-opus-5"))
        .unwrap();

    let preset = db.preset("ws-artemis").unwrap().expect("the preset");
    assert_eq!(preset.harness_id, "claude");
    assert_eq!(preset.model.as_deref(), Some("anthropic/claude-opus-5"));
}

#[test]
fn a_workspace_keeps_one_preset_which_the_latest_choice_replaces() {
    let db = Db::in_memory().unwrap();
    db.save_preset("ws-artemis", "claude", None).unwrap();
    db.save_preset("ws-artemis", "opencode", Some("zai/glm"))
        .unwrap();

    let preset = db.preset("ws-artemis").unwrap().unwrap();
    assert_eq!(preset.harness_id, "opencode");
    assert_eq!(preset.model.as_deref(), Some("zai/glm"));
}

#[test]
fn presets_are_per_workspace() {
    let db = Db::in_memory().unwrap();
    db.save_preset("ws-a", "claude", None).unwrap();
    db.save_preset("ws-b", "codex", None).unwrap();

    assert_eq!(db.preset("ws-a").unwrap().unwrap().harness_id, "claude");
    assert_eq!(db.preset("ws-b").unwrap().unwrap().harness_id, "codex");
    assert!(db.preset("ws-never-used").unwrap().is_none());
}

#[test]
fn an_empty_model_is_stored_as_absent_rather_than_an_empty_string() {
    let db = Db::in_memory().unwrap();
    db.save_preset("ws-a", "claude", Some("   ")).unwrap();
    // "no model chosen" and "the model is whitespace" are not different things.
    assert!(db.preset("ws-a").unwrap().unwrap().model.is_none());
}
