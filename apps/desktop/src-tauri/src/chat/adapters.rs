//! One transcript, three protocols.
//!
//! opencode, Codex and Claude Code each stream a JSON dialect of their own
//! invention, sharing no field names and no envelope. An adapter turns one of
//! them into `RuntimeEvent`s, which is the only shape the rest of Artemis
//! knows. `tests/adapters.rs` runs the same conformance over all three.
//!
//! A trait is justified here in a way it was not for the Quiver source in M10:
//! there really are several implementations, chosen at runtime by the harness
//! the user picked, and a fourth harness legitimately has none.
//!
//! **A harness without an adapter is not broken, it is a terminal.** Artemis
//! supports far more harnesses than it can parse, and the honest answer for the
//! rest is the dock from M6 — a real terminal running the real tool — rather
//! than a half-rendered transcript. `supports_streaming` is what lets the UI
//! decide which it is.

pub mod claude;
pub mod codex;

use crate::types::{HarnessKind, RuntimeEvent};

/// Turns one harness's stdout into Artemis's events, one line at a time.
///
/// Line-at-a-time because that is how the streams arrive and because a turn has
/// to render while it runs. An implementation is stateful: most of these
/// protocols send cumulative text, so knowing what was already emitted is the
/// difference between a delta and a duplicate.
pub trait HarnessAdapter: Send {
    /// Events this line produced. Empty for anything unrecognised — a warning,
    /// a progress line, a frame truncated by a killed process. Never an error:
    /// junk on stdout must not end a turn.
    fn parse_line(&mut self, line: &str) -> Vec<RuntimeEvent>;

    /// The harness's own id for this conversation, once it has said. Without it
    /// the next turn starts a stranger.
    fn observed_session_id(&self) -> Option<&str>;

    /// The first failure the harness reported, if any.
    fn error_message(&self) -> Option<&str>;
}

/// An adapter for this harness, or `None` if it belongs in the terminal dock.
pub fn for_kind(
    kind: HarnessKind,
    session_id: String,
    turn_id: String,
) -> Option<Box<dyn HarnessAdapter>> {
    match kind {
        HarnessKind::Opencode => Some(Box::new(super::parser::OpenCodeParser::new(
            session_id, turn_id,
        ))),
        HarnessKind::Codex => Some(Box::new(codex::CodexAdapter::new(session_id, turn_id))),
        HarnessKind::Claude => Some(Box::new(claude::ClaudeAdapter::new(session_id, turn_id))),
        _ => None,
    }
}

/// Whether this harness renders as a transcript. The rest go to the dock.
pub fn supports_streaming(kind: HarnessKind) -> bool {
    matches!(
        kind,
        HarnessKind::Opencode | HarnessKind::Codex | HarnessKind::Claude
    )
}

/// How to invoke a harness for one non-interactive, JSON-streaming turn.
///
/// The prompt is not included: opencode takes it as a trailing argument while
/// Codex reads it from stdin, so the caller appends or pipes as the harness
/// requires. Every flag here was read off the installed binary's `--help`, not
/// from documentation.
pub fn argv(
    kind: HarnessKind,
    cwd: &str,
    model: Option<&str>,
    resume_id: Option<&str>,
) -> Vec<String> {
    let owned = |values: &[&str]| values.iter().map(|value| value.to_string()).collect();

    match kind {
        HarnessKind::Opencode => {
            let mut args: Vec<String> = owned(&["run", "--format", "json", "--thinking", "--dir"]);
            args.push(cwd.to_string());
            if let Some(model) = model {
                args.push("--model".into());
                args.push(model.into());
            }
            if let Some(id) = resume_id {
                args.push("--session".into());
                args.push(id.into());
            }
            args
        }

        // `codex exec [--json] [PROMPT]`, and `codex exec resume [OPTIONS]
        // <SESSION_ID> [PROMPT]` to continue one. The prompt arrives on stdin
        // as `-`, because passing it positionally alongside a session id is
        // ambiguous and codex hangs waiting for stdin without it.
        HarnessKind::Codex => {
            let mut args: Vec<String> = vec!["exec".into()];
            if let Some(id) = resume_id {
                args.push("resume".into());
                args.push("--json".into());
                args.push(id.into());
            } else {
                args.push("--json".into());
            }
            if let Some(model) = model {
                args.push("--model".into());
                args.push(model.into());
            }
            args.push("-".into());
            args
        }

        // `--verbose` is not optional: claude refuses `--output-format
        // stream-json` under `--print` without it.
        HarnessKind::Claude => {
            let mut args: Vec<String> =
                owned(&["--print", "--output-format", "stream-json", "--verbose"]);
            if let Some(model) = model {
                args.push("--model".into());
                args.push(model.into());
            }
            if let Some(id) = resume_id {
                args.push("--resume".into());
                args.push(id.into());
            }
            args
        }

        _ => Vec::new(),
    }
}

/// Whether the prompt is written to the process's stdin rather than passed as
/// an argument. Codex is the odd one out, and hangs waiting for stdin if the
/// pipe is never opened.
pub fn prompt_via_stdin(kind: HarnessKind) -> bool {
    matches!(kind, HarnessKind::Codex)
}

/// Shared plumbing every adapter needs: monotonic event ids, and the session
/// and turn each event is stamped with.
pub(crate) struct Stamp {
    pub session_id: String,
    pub turn_id: String,
    counter: u64,
}

impl Stamp {
    pub fn new(session_id: String, turn_id: String) -> Self {
        Stamp {
            session_id,
            turn_id,
            counter: 0,
        }
    }

    pub fn next_id(&mut self) -> String {
        self.counter += 1;
        format!("{}-{}", self.turn_id, self.counter)
    }

    pub fn now(&self) -> String {
        chrono::Utc::now().to_rfc3339()
    }
}
