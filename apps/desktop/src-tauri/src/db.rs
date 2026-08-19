//! Persisted state.
//!
//! Deliberately narrow. Projects and workspaces are *derived*: from the
//! filesystem and from `git worktree list`, and storing them would create a
//! second answer that drifts from the first. What genuinely cannot be
//! recomputed is here:
//!
//! - **Chat sessions**, above all `opencode_session_id`. Without it a restart
//!   resumes nothing and the agent has forgotten the conversation.
//! - **Launch presets**, so a workspace reopens with the harness and model it
//!   was last used with.
//!
//! The event log stays as JSONL. It is append-only, a crash truncates the last
//! line instead of corrupting a file, and nothing has yet needed to query it.
//! Moving it here would be churn for its own sake.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{ChatSession, ChatSessionStatus, HarnessKind};

pub struct LaunchPreset {
    pub harness_id: String,
    pub model: Option<String>,
}

pub struct Db {
    connection: Mutex<Connection>,
}

/// `ChatSessionStatus` reaches the database as text so a schema dump reads as
/// something a human can follow.
fn status_to_text(status: ChatSessionStatus) -> &'static str {
    match status {
        ChatSessionStatus::Idle => "idle",
        ChatSessionStatus::Running => "running",
        ChatSessionStatus::Failed => "failed",
        ChatSessionStatus::Stopped => "stopped",
    }
}

fn status_from_text(text: &str) -> ChatSessionStatus {
    match text {
        "running" => ChatSessionStatus::Running,
        "failed" => ChatSessionStatus::Failed,
        "stopped" => ChatSessionStatus::Stopped,
        // Anything unrecognised is treated as finished rather than as work in
        // progress: showing a spinner for a session nobody can explain is worse
        // than showing it as done.
        _ => ChatSessionStatus::Idle,
    }
}

/// Trimmed, with whitespace-only treated as absent: "no model chosen" and
/// "the model is spaces" are not different states.
fn clean(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

pub fn default_path() -> PathBuf {
    std::env::var_os("ARTEMIS_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::scanner::home_dir().join(".artemis/artemis.sqlite"))
}

impl Db {
    /// Bumped whenever a migration is added. `PRAGMA user_version` holds the
    /// applied value, so reopening an existing database applies only what is
    /// missing.
    pub const SCHEMA_VERSION: i64 = 1;

    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create {parent:?}: {error}"))?;
        }
        let connection =
            Connection::open(path).map_err(|error| format!("open {path:?}: {error}"))?;
        Self::prepare(connection)
    }

    pub fn in_memory() -> Result<Self, String> {
        let connection =
            Connection::open_in_memory().map_err(|error| format!("open memory db: {error}"))?;
        Self::prepare(connection)
    }

    fn prepare(connection: Connection) -> Result<Self, String> {
        // WAL survives a hard quit far better than the default journal, which
        // is the case this database exists for.
        let _ = connection.pragma_update(None, "journal_mode", "WAL");
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| error.to_string())?;

        let db = Db {
            connection: Mutex::new(connection),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn schema_version(&self) -> Result<i64, String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| error.to_string())
    }

    fn migrate(&self) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        let current: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;

        if current < 1 {
            connection
                .execute_batch(
                    "CREATE TABLE chat_sessions (
                        id                  TEXT PRIMARY KEY,
                        workspace_id        TEXT NOT NULL,
                        workspace_path      TEXT NOT NULL,
                        harness_id          TEXT NOT NULL,
                        harness_kind        TEXT,
                        model               TEXT,
                        opencode_session_id TEXT,
                        start_path          TEXT,
                        title               TEXT NOT NULL,
                        status              TEXT NOT NULL,
                        created_at          TEXT NOT NULL,
                        last_event_at       TEXT NOT NULL
                     );
                     CREATE INDEX chat_sessions_workspace
                        ON chat_sessions (workspace_id);

                     CREATE TABLE launch_presets (
                        workspace_id TEXT PRIMARY KEY,
                        harness_id   TEXT NOT NULL,
                        model        TEXT,
                        updated_at   TEXT NOT NULL
                     );",
                )
                .map_err(|error| format!("migration 1: {error}"))?;
        }

        connection
            .pragma_update(None, "user_version", Self::SCHEMA_VERSION)
            .map_err(|error| error.to_string())
    }

    // ------------------------------------------------------------- sessions

    pub fn save_session(&self, session: &ChatSession) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        connection
            .execute(
                "INSERT INTO chat_sessions (
                    id, workspace_id, workspace_path, harness_id, harness_kind,
                    model, opencode_session_id, start_path, title, status,
                    created_at, last_event_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    workspace_id        = excluded.workspace_id,
                    workspace_path      = excluded.workspace_path,
                    harness_id          = excluded.harness_id,
                    harness_kind        = excluded.harness_kind,
                    model               = excluded.model,
                    opencode_session_id = excluded.opencode_session_id,
                    start_path          = excluded.start_path,
                    title               = excluded.title,
                    status              = excluded.status,
                    last_event_at       = excluded.last_event_at",
                params![
                    session.id,
                    session.workspace_id,
                    session.workspace_path,
                    session.harness_id,
                    session
                        .harness_kind
                        .and_then(|kind| serde_json::to_value(kind).ok())
                        .and_then(|value| value.as_str().map(str::to_string)),
                    session.model,
                    session.opencode_session_id,
                    session.start_path,
                    session.title,
                    status_to_text(session.status),
                    session.created_at,
                    session.last_event_at,
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("save session: {error}"))
    }

    fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatSession> {
        let status: String = row.get("status")?;
        let kind: Option<String> = row.get("harness_kind")?;
        Ok(ChatSession {
            id: row.get("id")?,
            workspace_id: row.get("workspace_id")?,
            workspace_path: row.get("workspace_path")?,
            harness_id: row.get("harness_id")?,
            harness_kind: kind
                .and_then(|text| serde_json::from_value::<HarnessKind>(text.into()).ok()),
            model: row.get("model")?,
            opencode_session_id: row.get("opencode_session_id")?,
            start_path: row.get("start_path")?,
            title: row.get("title")?,
            status: status_from_text(&status),
            created_at: row.get("created_at")?,
            last_event_at: row.get("last_event_at")?,
        })
    }

    pub fn session(&self, id: &str) -> Result<Option<ChatSession>, String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        connection
            .query_row(
                "SELECT * FROM chat_sessions WHERE id = ?1",
                params![id],
                Self::row_to_session,
            )
            .optional()
            .map_err(|error| format!("load session: {error}"))
    }

    pub fn sessions(&self) -> Result<Vec<ChatSession>, String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        let mut statement = connection
            .prepare("SELECT * FROM chat_sessions ORDER BY last_event_at DESC")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], Self::row_to_session)
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }

    pub fn sessions_for_workspace(&self, workspace_id: &str) -> Result<Vec<ChatSession>, String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT * FROM chat_sessions
                 WHERE workspace_id = ?1
                 ORDER BY last_event_at DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![workspace_id], Self::row_to_session)
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }

    /// Correct sessions a crash left marked `running`.
    ///
    /// Nothing is running after the process dies, so a stored `running` is
    /// always stale on startup. Returns how many were corrected.
    pub fn recover_interrupted_sessions(&self) -> Result<usize, String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        connection
            .execute(
                "UPDATE chat_sessions SET status = 'stopped' WHERE status = 'running'",
                [],
            )
            .map_err(|error| format!("recover sessions: {error}"))
    }

    // -------------------------------------------------------------- presets

    pub fn save_preset(
        &self,
        workspace_id: &str,
        harness_id: &str,
        model: Option<&str>,
    ) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        connection
            .execute(
                "INSERT INTO launch_presets (workspace_id, harness_id, model, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    harness_id = excluded.harness_id,
                    model      = excluded.model,
                    updated_at = excluded.updated_at",
                params![
                    workspace_id,
                    harness_id,
                    clean(model),
                    chrono::Utc::now().to_rfc3339()
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("save preset: {error}"))
    }

    pub fn preset(&self, workspace_id: &str) -> Result<Option<LaunchPreset>, String> {
        let connection = self.connection.lock().map_err(|_| "db lock".to_string())?;
        connection
            .query_row(
                "SELECT harness_id, model FROM launch_presets WHERE workspace_id = ?1",
                params![workspace_id],
                |row| {
                    Ok(LaunchPreset {
                        harness_id: row.get(0)?,
                        model: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("load preset: {error}"))
    }
}
