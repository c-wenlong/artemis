//! Chat: sessions, streamed turns, and the event log behind them.

pub mod adapters;
pub mod log;
pub mod parser;
pub mod stream;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::db::Db;
use crate::inventory;
use crate::settings;
use crate::types::{
    ChatSession, ChatSessionStatus, CreateChatSessionRequest, HarnessKind, RuntimeEvent,
    SendChatMessageRequest,
};

use log::EventLog;
use stream::{new_turn_handle, run_turn, EventSink, TurnHandle, TurnRequest};

/// Sessions and their in-flight turns.
///
/// Sessions live in the database rather than in memory: `opencode_session_id`
/// is what lets a restart resume a conversation with its context, and losing it
/// means the agent starts over having forgotten everything. In-flight turns
/// stay in memory, because a turn cannot outlive the process that spawned it.
pub struct ChatStore {
    db: Arc<Db>,
    running: Mutex<HashMap<String, TurnHandle>>,
}

/// The protocol a session's harness speaks.
///
/// `harness_kind` is recorded on the session when known; otherwise the id is
/// the best signal, and an unrecognised one is `Custom`, which has no adapter
/// and belongs in the terminal dock.
fn harness_kind_of(session: &ChatSession) -> HarnessKind {
    session
        .harness_kind
        .unwrap_or_else(|| match session.harness_id.to_lowercase().as_str() {
            "opencode" => HarnessKind::Opencode,
            "codex" => HarnessKind::Codex,
            "claude" => HarnessKind::Claude,
            _ => HarnessKind::Custom,
        })
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// A first line of the prompt, good enough to identify the session in a list.
fn title_for(prompt: &str) -> String {
    let condensed = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = condensed.chars().take(48).collect();
    if trimmed.is_empty() {
        "OpenCode session".to_string()
    } else {
        trimmed
    }
}

/// Chat session id for a workspace.
///
/// Deterministic rather than timestamped: the event log is keyed by session id,
/// so a random id per launch would orphan the previous log and make replay
/// silently return nothing. One workspace is one conversation until M5 gives
/// workspaces multiple worktrees.
pub fn session_id_for_workspace(workspace_id: &str) -> String {
    let cleaned: String = workspace_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("chat-{cleaned}")
}

impl ChatStore {
    pub fn new(db: Arc<Db>) -> Self {
        ChatStore {
            db,
            running: Mutex::new(HashMap::new()),
        }
    }

    /// Idempotent: reopening a workspace returns the existing session, keeping
    /// the opencode session id so the conversation resumes with its context.
    pub fn create_session(&self, request: CreateChatSessionRequest) -> ChatSession {
        let id = session_id_for_workspace(&request.workspace_id);
        if let Some(existing) = self.session(&id) {
            return existing;
        }

        let timestamp = now();
        let session = ChatSession {
            created_at: timestamp.clone(),
            harness_id: request.harness_id.clone(),
            harness_kind: None,
            id,
            last_event_at: timestamp,
            model: request.model,
            opencode_session_id: request.opencode_session_id,
            start_path: request.start_path,
            status: ChatSessionStatus::Idle,
            title: request.title.unwrap_or_else(|| "OpenCode session".into()),
            workspace_id: request.workspace_id,
            workspace_path: request.workspace_path,
        };
        let _ = self.db.save_session(&session);
        session
    }

    pub fn session(&self, session_id: &str) -> Option<ChatSession> {
        self.db.session(session_id).ok().flatten()
    }

    fn update_session(&self, session: ChatSession) {
        // Best-effort: failing to persist a status change must not abort the
        // turn the user is watching.
        let _ = self.db.save_session(&session);
    }

    /// Stop the running turn for a session, if there is one.
    pub fn cancel(&self, session_id: &str) {
        let handle = self
            .running
            .lock()
            .ok()
            .and_then(|running| running.get(session_id).cloned());
        if let Some(handle) = handle {
            handle.cancel();
        }
    }

    pub fn is_running(&self, session_id: &str) -> bool {
        self.running
            .lock()
            .map(|running| running.contains_key(session_id))
            .unwrap_or(false)
    }

    /// Everything previously recorded for a session: the replay path.
    pub fn replay(session_id: &str) -> Vec<RuntimeEvent> {
        EventLog::for_session(session_id).read()
    }

    /// Copy a conversation up to `through_turn_id` into a new session.
    ///
    /// What carries over is the transcript. What does not is
    /// `opencode_session_id`: reusing it would make the fork an alias rather
    /// than a branch, with both sides appending to one server-side
    /// conversation. So the fork reads back identically and the *next* turn
    /// starts a fresh opencode session, which the model has no memory of. That
    /// is a real limitation, not an oversight: closing it needs opencode to
    /// support seeding a session from a transcript.
    pub fn fork_session(&self, session_id: &str, through_turn_id: &str) -> Option<ChatSession> {
        self.fork_session_in(&log::sessions_dir(), session_id, through_turn_id)
    }

    /// Fork against an explicit log directory, so tests do not touch the real one.
    pub fn fork_session_in(
        &self,
        dir: &Path,
        session_id: &str,
        through_turn_id: &str,
    ) -> Option<ChatSession> {
        let source = self.session(session_id)?;
        let events = EventLog::in_dir(dir.to_path_buf(), session_id).read();

        // Everything through the *last* event of that turn, so the turn arrives
        // complete rather than cut off mid-stream.
        let end = events
            .iter()
            .rposition(|event| event.turn_id() == through_turn_id)?;

        let id = self.next_fork_id(session_id);
        let mut copied = events[..=end].to_vec();
        for event in &mut copied {
            event.set_session_id(&id);
        }
        EventLog::in_dir(dir.to_path_buf(), &id).append(&copied);

        let timestamp = now();
        let forked = ChatSession {
            created_at: timestamp.clone(),
            harness_id: source.harness_id,
            harness_kind: source.harness_kind,
            id,
            last_event_at: timestamp,
            model: source.model,
            opencode_session_id: None,
            start_path: source.start_path,
            status: ChatSessionStatus::Idle,
            title: format!("Fork of {}", source.title),
            workspace_id: source.workspace_id,
            workspace_path: source.workspace_path,
        };
        let _ = self.db.save_session(&forked);
        Some(forked)
    }

    /// Lowest unused `-fork-N`. Counting rather than timestamping keeps the id
    /// deterministic, which matters because the event log is keyed by it.
    fn next_fork_id(&self, session_id: &str) -> String {
        (1..)
            .map(|n| format!("{session_id}-fork-{n}"))
            .find(|candidate| self.session(candidate).is_none())
            .expect("an unused fork id exists")
    }

    /// Run a turn to completion, streaming into `sink`. Blocking.
    pub fn send_message(
        &self,
        session_id: &str,
        request: SendChatMessageRequest,
        sink: Arc<dyn EventSink>,
    ) -> Result<(), String> {
        let Some(session) = self.session(session_id) else {
            return Err(format!("Unknown chat session: {session_id}"));
        };
        if self.is_running(session_id) {
            return Err("This session already has a turn in flight.".to_string());
        }

        let prompt = request.prompt.trim().to_string();
        if prompt.is_empty() {
            return Err("Prompt is empty.".to_string());
        }

        let harness = inventory::harnesses(false, false)
            .into_iter()
            .find(|candidate| candidate.id == session.harness_id)
            .ok_or_else(|| format!("Unknown harness: {}", session.harness_id))?;

        if harness.kind != HarnessKind::Opencode {
            return Err(
                "Streaming chat supports OpenCode only for now; other harnesses run in the \
                 terminal dock."
                    .to_string(),
            );
        }
        let executable = harness
            .executable_path
            .clone()
            .ok_or_else(|| "OpenCode is not installed or not on PATH.".to_string())?;

        let start_path = request
            .start_path
            .clone()
            .or_else(|| session.start_path.clone());
        let cwd = PathBuf::from(&session.workspace_path).join(start_path.as_deref().unwrap_or("."));
        if !cwd.is_dir() {
            return Err(format!(
                "Start path does not exist or is not a directory: {}",
                cwd.display()
            ));
        }

        // A harness Artemis cannot parse must not be launched as a transcript:
        // it would stream a page of unrendered JSON. The dock runs it properly.
        let kind = harness_kind_of(&session);
        if !adapters::supports_streaming(kind) {
            return Err(format!(
                "{} does not stream a transcript. Open it in the terminal dock instead.",
                session.harness_id
            ));
        }

        let settings = settings::read();
        let model = session
            .model
            .clone()
            .or_else(|| settings.opencode_default_model.clone());

        // Each harness speaks its own dialect and wants its own flags; the
        // adapter layer owns both, so nothing here knows which one is running.
        let mut args = adapters::argv(
            kind,
            &cwd.to_string_lossy(),
            model.as_deref(),
            session.opencode_session_id.as_deref(),
        );
        // Codex reads the prompt from stdin; the rest take it as a trailing
        // argument. The run loop opens the pipe when it is the former.
        if !adapters::prompt_via_stdin(kind) {
            args.push(prompt.clone());
        }

        let turn_id = format!("turn-{}", now().replace([':', '.', '-', '+'], ""));
        let handle = new_turn_handle();

        if let Ok(mut running) = self.running.lock() {
            running.insert(session_id.to_string(), handle.clone());
        }
        self.update_session(ChatSession {
            status: ChatSessionStatus::Running,
            last_event_at: now(),
            start_path: start_path.clone(),
            ..session.clone()
        });

        let outcome = run_turn(
            TurnRequest {
                session_id: session.id.clone(),
                turn_id,
                kind,
                command: executable,
                args,
                cwd: &cwd,
                prompt: prompt.clone(),
                harness_id: session.harness_id.clone(),
                workspace_id: session.workspace_id.clone(),
            },
            handle,
            sink,
            &EventLog::for_session(&session.id),
        );

        if let Ok(mut running) = self.running.lock() {
            running.remove(session_id);
        }

        let title = if session.title == "OpenCode session" {
            title_for(&prompt)
        } else {
            session.title.clone()
        };
        self.update_session(ChatSession {
            status: match (outcome.cancelled, outcome.failed) {
                (true, _) => ChatSessionStatus::Stopped,
                (_, true) => ChatSessionStatus::Failed,
                _ => ChatSessionStatus::Idle,
            },
            last_event_at: now(),
            opencode_session_id: outcome
                .opencode_session_id
                .or(session.opencode_session_id.clone()),
            start_path,
            title,
            ..session
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> ChatStore {
        ChatStore::new(Arc::new(Db::in_memory().expect("in-memory db")))
    }

    fn request() -> CreateChatSessionRequest {
        CreateChatSessionRequest {
            harness_id: "opencode".into(),
            model: None,
            opencode_session_id: None,
            start_path: None,
            title: None,
            workspace_id: "ws".into(),
            workspace_path: "/tmp".into(),
        }
    }

    struct NullSink;
    impl EventSink for NullSink {
        fn emit(&self, _events: &[RuntimeEvent]) {}
    }

    #[test]
    fn a_new_session_starts_idle_and_is_retrievable() {
        let store = store();
        let session = store.create_session(request());
        assert_eq!(session.status, ChatSessionStatus::Idle);
        assert!(store.session(&session.id).is_some());
    }

    /// The event log is keyed by session id. A fresh id per launch would orphan
    /// the previous log, and replay would silently return nothing.
    #[test]
    fn a_workspace_always_maps_to_the_same_session_id() {
        let store = store();
        let first = store.create_session(request());
        let second = store.create_session(request());
        assert_eq!(first.id, second.id);
        assert_eq!(first.id, session_id_for_workspace("ws"));
    }

    #[test]
    fn reopening_keeps_the_opencode_session_so_context_survives() {
        let store = store();
        let session = store.create_session(request());
        store.update_session(ChatSession {
            opencode_session_id: Some("ses_abc".into()),
            ..session
        });

        let reopened = store.create_session(request());
        assert_eq!(reopened.opencode_session_id.as_deref(), Some("ses_abc"));
    }

    #[test]
    fn session_ids_are_filesystem_safe() {
        let id = session_id_for_workspace("../../etc/passwd");
        assert!(!id.contains('/') && !id.contains(".."));
    }

    #[test]
    fn sending_to_an_unknown_session_is_an_error_not_a_panic() {
        let store = store();
        let result = store.send_message(
            "nope",
            SendChatMessageRequest {
                prompt: "hi".into(),
                start_path: None,
            },
            Arc::new(NullSink),
        );
        assert!(result.unwrap_err().contains("Unknown chat session"));
    }

    #[test]
    fn an_empty_prompt_is_rejected_before_spawning_anything() {
        let store = store();
        let session = store.create_session(request());
        let result = store.send_message(
            &session.id,
            SendChatMessageRequest {
                prompt: "   ".into(),
                start_path: None,
            },
            Arc::new(NullSink),
        );
        assert_eq!(result.unwrap_err(), "Prompt is empty.");
    }

    #[test]
    fn cancelling_an_idle_session_is_a_no_op() {
        let store = store();
        let session = store.create_session(request());
        store.cancel(&session.id); // must not panic
        assert!(!store.is_running(&session.id));
    }

    #[test]
    fn titles_are_derived_from_the_prompt_and_bounded() {
        assert_eq!(
            title_for("  explain   the   scanner "),
            "explain the scanner"
        );
        assert_eq!(title_for(""), "OpenCode session");
        assert!(title_for(&"x".repeat(200)).chars().count() <= 48);
    }
}
