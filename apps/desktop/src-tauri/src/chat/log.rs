//! Per-session event log.
//!
//! One JSONL file per chat session under `~/.artemis/sessions/`. Append-only,
//! so a turn can be replayed when the app reopens: the M1 exit criterion.
//!
//! JSONL rather than a single JSON document on purpose: a crash mid-turn
//! truncates the last line instead of corrupting the file, and reading skips
//! anything that will not parse.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use crate::types::RuntimeEvent;

pub struct EventLog {
    path: PathBuf,
}

/// `~/.artemis/sessions`, or `$ARTEMIS_SESSIONS_DIR` when set (tests use this).
pub fn sessions_dir() -> PathBuf {
    std::env::var_os("ARTEMIS_SESSIONS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::scanner::home_dir().join(".artemis/sessions"))
}

/// Session ids reach the filesystem, so anything that could escape the
/// directory is replaced rather than trusted.
fn safe_file_name(session_id: &str) -> String {
    let cleaned: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!(
        "{}.jsonl",
        if cleaned.is_empty() {
            "session"
        } else {
            &cleaned
        }
    )
}

impl EventLog {
    pub fn for_session(session_id: &str) -> Self {
        Self::in_dir(sessions_dir(), session_id)
    }

    /// Explicit directory. Tests use this rather than an environment variable:
    /// env vars are process-global, and `cargo test` runs in parallel.
    pub fn in_dir(dir: PathBuf, session_id: &str) -> Self {
        EventLog {
            path: dir.join(safe_file_name(session_id)),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append events. Logging is best-effort: failing to persist a delta must
    /// not abort the turn the user is watching.
    pub fn append(&self, events: &[RuntimeEvent]) {
        if events.is_empty() {
            return;
        }
        let Some(parent) = self.path.parent() else {
            return;
        };
        if fs::create_dir_all(parent).is_err() {
            return;
        }
        let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        else {
            return;
        };
        let mut buffer = String::new();
        for event in events {
            if let Ok(line) = serde_json::to_string(event) {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
        let _ = file.write_all(buffer.as_bytes());
    }

    /// Every event previously recorded. Unparseable lines are skipped: a
    /// truncated tail from a crash, or a format from an older build.
    pub fn read(&self) -> Vec<RuntimeEvent> {
        let Ok(file) = File::open(&self.path) else {
            return Vec::new();
        };
        BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str::<RuntimeEvent>(&line).ok())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(turn: &str, text: &str) -> RuntimeEvent {
        RuntimeEvent::TextDelta {
            id: format!("e-{text}"),
            session_id: "s1".into(),
            timestamp: "2026-08-10T00:00:00Z".into(),
            turn_id: turn.into(),
            block_id: "b1".into(),
            text: text.into(),
        }
    }

    pub(crate) struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("artemis-log-{name}"));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn round_trips_events() {
        let dir = TempDir::new("round-trip");
        let log = EventLog::in_dir(dir.0.clone(), "s1");
        log.append(&[event("t1", "a"), event("t1", "b")]);

        let read = log.read();
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].turn_id(), "t1");
    }

    #[test]
    fn appends_across_calls_so_a_reopened_session_sees_the_whole_turn() {
        let dir = TempDir::new("append");
        let log = EventLog::in_dir(dir.0.clone(), "s2");
        log.append(&[event("t1", "a")]);
        log.append(&[event("t1", "b")]);
        assert_eq!(log.read().len(), 2);
    }

    #[test]
    fn missing_log_reads_as_empty_not_an_error() {
        let dir = TempDir::new("missing");
        assert!(EventLog::in_dir(dir.0.clone(), "never-written")
            .read()
            .is_empty());
    }

    #[test]
    fn skips_a_truncated_tail() {
        let dir = TempDir::new("truncated");
        let log = EventLog::in_dir(dir.0.clone(), "s3");
        log.append(&[event("t1", "a")]);
        // Simulate a crash mid-write.
        let mut file = OpenOptions::new().append(true).open(log.path()).unwrap();
        file.write_all(b"{\"type\":\"text.del").unwrap();

        assert_eq!(log.read().len(), 1, "the good line still reads");
    }

    #[test]
    fn session_ids_cannot_escape_the_sessions_directory() {
        let dir = TempDir::new("traversal");
        let log = EventLog::in_dir(dir.0.clone(), "../../etc/passwd");
        assert_eq!(log.path().parent().unwrap(), dir.0);
        assert!(!log.path().to_string_lossy().contains(".."));
    }
}
