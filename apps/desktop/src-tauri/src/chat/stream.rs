//! Turn execution: spawn the harness, parse its stdout, stream events.
//!
//! Everything Tauri-specific stays behind `EventSink`, so the run loop, the
//! coalescer and cancellation are all testable with an ordinary process.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::chat::log::EventLog;
use crate::chat::parser::OpenCodeParser;
use crate::types::RuntimeEvent;

/// Where streamed events go. Implemented by a Tauri channel in the app and by a
/// collecting vector in tests.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, events: &[RuntimeEvent]);
}

/// How long deltas accumulate before a flush. Long enough to batch a fast
/// model's tokens, short enough to still read as streaming.
const FLUSH_INTERVAL: Duration = Duration::from_millis(40);

/// Merge consecutive deltas for the same block into one event.
///
/// A fast model emits a line per token; forwarding each one individually means
/// an IPC message and a React render per token. Merging preserves the text
/// exactly while cutting the message count by an order of magnitude.
pub fn coalesce(events: Vec<RuntimeEvent>) -> Vec<RuntimeEvent> {
    let mut out: Vec<RuntimeEvent> = Vec::with_capacity(events.len());

    for event in events {
        let merged = match (out.last_mut(), &event) {
            (
                Some(RuntimeEvent::TextDelta {
                    block_id: previous_block,
                    text: previous_text,
                    ..
                }),
                RuntimeEvent::TextDelta { block_id, text, .. },
            ) if previous_block == block_id => {
                previous_text.push_str(text);
                true
            }
            (
                Some(RuntimeEvent::ReasoningDelta {
                    block_id: previous_block,
                    text: previous_text,
                    ..
                }),
                RuntimeEvent::ReasoningDelta { block_id, text, .. },
            ) if previous_block == block_id => {
                previous_text.push_str(text);
                true
            }
            _ => false,
        };
        if !merged {
            out.push(event);
        }
    }
    out
}

/// Handle on a turn in flight. Dropping it does not stop the turn; `cancel`
/// does.
#[derive(Clone)]
pub struct TurnHandle {
    child: Arc<Mutex<Option<Child>>>,
    cancelled: Arc<AtomicBool>,
}

/// Kill the child *and everything it spawned*.
///
/// Killing only the direct child is not enough: opencode spawns subprocesses
/// that inherit the stdout pipe, so the read loop keeps blocking on a pipe
/// nobody will ever close and the turn appears to hang. The child is started in
/// its own process group precisely so the whole group can be signalled here.
#[cfg(unix)]
fn kill_process_group(child: &mut Child) {
    let pid = child.id() as i32;
    // Negative pid targets the group. If the group is already gone this is a
    // harmless ESRCH.
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(not(unix))]
fn kill_process_group(child: &mut Child) {
    let _ = child.kill();
}

impl TurnHandle {
    fn new() -> Self {
        TurnHandle {
            child: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Stop the turn. The run loop still emits a terminal event, so the UI
    /// never sits on a turn that will not end.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                kill_process_group(child);
            }
        }
    }
}

pub struct TurnRequest<'a> {
    pub session_id: String,
    pub turn_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: &'a Path,
    pub prompt: String,
    pub harness_id: String,
    pub workspace_id: String,
}

pub struct TurnOutcome {
    pub opencode_session_id: Option<String>,
    pub cancelled: bool,
    pub failed: bool,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn event_id(turn_id: &str, suffix: &str) -> String {
    format!("{turn_id}-{suffix}")
}

/// Run one turn to completion, streaming as it goes.
///
/// Blocking: callers put it on the blocking pool. Always emits exactly one
/// terminal event, whatever happens to the child.
pub fn run_turn(
    request: TurnRequest<'_>,
    handle: TurnHandle,
    sink: Arc<dyn EventSink>,
    log: &EventLog,
) -> TurnOutcome {
    let emit = |events: Vec<RuntimeEvent>| {
        if events.is_empty() {
            return;
        }
        let events = coalesce(events);
        log.append(&events);
        sink.emit(&events);
    };

    emit(vec![
        RuntimeEvent::TurnStarted {
            id: event_id(&request.turn_id, "started"),
            session_id: request.session_id.clone(),
            timestamp: now(),
            turn_id: request.turn_id.clone(),
            harness_id: request.harness_id.clone(),
            workspace_id: request.workspace_id.clone(),
        },
        RuntimeEvent::UserMessage {
            id: event_id(&request.turn_id, "user"),
            session_id: request.session_id.clone(),
            timestamp: now(),
            turn_id: request.turn_id.clone(),
            text: request.prompt.clone(),
        },
    ]);

    let mut builder = Command::new(&request.command);
    builder
        .args(&request.args)
        .current_dir(request.cwd)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Own process group, so cancelling can signal the harness and everything it
    // spawned rather than orphaning grandchildren that hold the pipe open.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        builder.process_group(0);
    }

    let spawned = builder.spawn();

    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => {
            emit(vec![RuntimeEvent::TurnErrored {
                id: event_id(&request.turn_id, "errored"),
                session_id: request.session_id.clone(),
                timestamp: now(),
                turn_id: request.turn_id.clone(),
                message: format!("Could not start {}: {error}", request.command),
                exit_code: None,
            }]);
            return TurnOutcome {
                opencode_session_id: None,
                cancelled: false,
                failed: true,
            };
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Drain stderr on its own thread: a full pipe would otherwise block the
    // child forever while we sit reading stdout.
    let stderr_reader = std::thread::spawn(move || {
        let mut collected = String::new();
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if collected.len() < 4_000 {
                    collected.push_str(&line);
                    collected.push('\n');
                }
            }
        }
        collected
    });

    if let Ok(mut guard) = handle.child.lock() {
        *guard = Some(child);
    }

    let mut parser = OpenCodeParser::new(request.session_id.clone(), request.turn_id.clone())
        .rooted_at(request.cwd);
    let mut pending: Vec<RuntimeEvent> = Vec::new();
    let mut last_flush = Instant::now();

    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            pending.extend(parser.parse_line(&line));
            if last_flush.elapsed() >= FLUSH_INTERVAL && !pending.is_empty() {
                emit(std::mem::take(&mut pending));
                last_flush = Instant::now();
            }
        }
    }
    emit(std::mem::take(&mut pending));

    let status = handle
        .child
        .lock()
        .ok()
        .and_then(|mut guard| guard.as_mut().map(|child| child.wait()))
        .and_then(Result::ok);

    let stderr_text = stderr_reader.join().unwrap_or_default();
    let exit_code = status.and_then(|status| status.code());
    let cancelled = handle.is_cancelled();
    let parser_error = parser.error_message().map(str::to_string);
    let observed = parser.observed_session_id().map(str::to_string);

    if cancelled {
        emit(vec![RuntimeEvent::TurnErrored {
            id: event_id(&request.turn_id, "cancelled"),
            session_id: request.session_id.clone(),
            timestamp: now(),
            turn_id: request.turn_id.clone(),
            message: "Turn stopped.".to_string(),
            exit_code,
        }]);
        return TurnOutcome {
            opencode_session_id: observed,
            cancelled: true,
            failed: false,
        };
    }

    let failed = exit_code != Some(0) || parser_error.is_some();
    if failed {
        let message = parser_error
            .or_else(|| clean_error(&stderr_text))
            .unwrap_or_else(|| match exit_code {
                Some(code) => format!("{} exited with status {code}.", request.command),
                None => format!("{} did not exit cleanly.", request.command),
            });
        emit(vec![RuntimeEvent::TurnErrored {
            id: event_id(&request.turn_id, "errored"),
            session_id: request.session_id.clone(),
            timestamp: now(),
            turn_id: request.turn_id.clone(),
            message,
            exit_code,
        }]);
    } else {
        emit(vec![RuntimeEvent::TurnCompleted {
            id: event_id(&request.turn_id, "completed"),
            session_id: request.session_id.clone(),
            timestamp: now(),
            turn_id: request.turn_id.clone(),
            opencode_session_id: observed.clone(),
        }]);
    }

    TurnOutcome {
        opencode_session_id: observed,
        cancelled: false,
        failed,
    }
}

/// Strip ANSI escapes and keep the first few meaningful lines — harness stderr
/// is often a banner followed by the actual complaint.
fn clean_error(text: &str) -> Option<String> {
    let mut cleaned = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            for escape in chars.by_ref() {
                if escape.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }
        cleaned.push(ch);
    }

    let joined = cleaned
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join("\n");
    (!joined.is_empty()).then_some(joined)
}

pub fn new_turn_handle() -> TurnHandle {
    TurnHandle::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Collector {
        events: Mutex<Vec<RuntimeEvent>>,
    }

    impl EventSink for Collector {
        fn emit(&self, events: &[RuntimeEvent]) {
            self.events.lock().unwrap().extend_from_slice(events);
        }
    }

    fn delta(block: &str, text: &str) -> RuntimeEvent {
        RuntimeEvent::TextDelta {
            id: format!("e{text}"),
            session_id: "s".into(),
            timestamp: "t".into(),
            turn_id: "turn".into(),
            block_id: block.into(),
            text: text.into(),
        }
    }

    #[test]
    fn coalesce_merges_consecutive_deltas_for_one_block() {
        let merged = coalesce(vec![delta("a", "He"), delta("a", "llo")]);
        assert_eq!(merged.len(), 1);
        match &merged[0] {
            RuntimeEvent::TextDelta { text, .. } => assert_eq!(text, "Hello"),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn coalesce_keeps_separate_blocks_apart() {
        let merged = coalesce(vec![delta("a", "one"), delta("b", "two"), delta("a", "!")]);
        assert_eq!(merged.len(), 3, "interleaved blocks must not be merged");
    }

    #[test]
    fn coalesce_never_merges_across_a_tool_call() {
        let events = vec![
            delta("a", "before"),
            RuntimeEvent::ToolCallStarted {
                id: "t".into(),
                session_id: "s".into(),
                timestamp: "t".into(),
                turn_id: "turn".into(),
                block_id: "tool-1".into(),
                name: "bash".into(),
                input: None,
            },
            delta("a", "after"),
        ];
        let merged = coalesce(events);
        assert_eq!(merged.len(), 3, "ordering carries meaning; do not reorder");
    }

    #[test]
    fn coalesce_preserves_text_exactly() {
        let merged = coalesce(vec![
            delta("a", "one "),
            delta("a", "two "),
            delta("a", "three"),
        ]);
        match &merged[0] {
            RuntimeEvent::TextDelta { text, .. } => assert_eq!(text, "one two three"),
            other => panic!("unexpected {other:?}"),
        }
    }

    /// Explicit directories rather than an env var: `cargo test` runs these in
    /// parallel, and a process-global would have them overwrite each other.
    fn temp_sessions_dir(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("artemis-stream-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    /// A stand-in for opencode: emits the same JSON line shapes.
    fn fake_harness(script: &str) -> (String, Vec<String>) {
        (
            "/bin/sh".to_string(),
            vec!["-c".to_string(), script.to_string()],
        )
    }

    #[test]
    fn streams_a_turn_from_start_to_completion() {
        let dir = temp_sessions_dir("complete");
        let sink = Arc::new(Collector::default());
        let (command, args) = fake_harness(
            r#"printf '%s\n' '{"type":"text","id":"p1","text":"Hel"}' '{"type":"text","id":"p1","text":"Hello"}'"#,
        );

        let outcome = run_turn(
            TurnRequest {
                session_id: "s1".into(),
                turn_id: "t1".into(),
                command,
                args,
                cwd: &dir,
                prompt: "hi".into(),
                harness_id: "opencode".into(),
                workspace_id: "ws".into(),
            },
            new_turn_handle(),
            sink.clone(),
            &EventLog::in_dir(dir.clone(), "s1"),
        );

        assert!(!outcome.failed);
        let events = sink.events.lock().unwrap();
        assert!(matches!(events[0], RuntimeEvent::TurnStarted { .. }));
        assert!(matches!(events[1], RuntimeEvent::UserMessage { .. }));
        assert!(events.last().unwrap().is_terminal());
        assert!(matches!(
            events.last().unwrap(),
            RuntimeEvent::TurnCompleted { .. }
        ));

        let text: String = events
            .iter()
            .filter_map(|event| match event {
                RuntimeEvent::TextDelta { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "Hello", "deltas reassemble into the original text");
    }

    #[test]
    fn a_nonzero_exit_ends_the_turn_with_an_error() {
        let dir = temp_sessions_dir("failure");
        let sink = Arc::new(Collector::default());
        let (command, args) = fake_harness("echo 'boom' >&2; exit 3");

        let outcome = run_turn(
            TurnRequest {
                session_id: "s2".into(),
                turn_id: "t1".into(),
                command,
                args,
                cwd: &dir,
                prompt: "hi".into(),
                harness_id: "opencode".into(),
                workspace_id: "ws".into(),
            },
            new_turn_handle(),
            sink.clone(),
            &EventLog::in_dir(dir.clone(), "s2"),
        );

        assert!(outcome.failed);
        let events = sink.events.lock().unwrap();
        match events.last().unwrap() {
            RuntimeEvent::TurnErrored {
                message, exit_code, ..
            } => {
                assert!(
                    message.contains("boom"),
                    "stderr should reach the user: {message}"
                );
                assert_eq!(*exit_code, Some(3));
            }
            other => panic!("expected turn.errored, got {other:?}"),
        }
    }

    #[test]
    fn a_missing_binary_ends_the_turn_rather_than_hanging() {
        let dir = temp_sessions_dir("missing");
        let sink = Arc::new(Collector::default());

        run_turn(
            TurnRequest {
                session_id: "s3".into(),
                turn_id: "t1".into(),
                command: "/nonexistent/harness".into(),
                args: vec![],
                cwd: &dir,
                prompt: "hi".into(),
                harness_id: "opencode".into(),
                workspace_id: "ws".into(),
            },
            new_turn_handle(),
            sink.clone(),
            &EventLog::in_dir(dir.clone(), "s3"),
        );

        let events = sink.events.lock().unwrap();
        assert!(events.last().unwrap().is_terminal());
    }

    #[test]
    fn cancelling_stops_the_child_and_still_terminates_the_turn() {
        let dir = temp_sessions_dir("cancel");
        let sink = Arc::new(Collector::default());
        let handle = new_turn_handle();
        let cancel_handle = handle.clone();

        // Emits one line, then would run for 30s.
        let (command, args) =
            fake_harness(r#"printf '%s\n' '{"type":"text","id":"p1","text":"working"}'; sleep 30"#);

        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            cancel_handle.cancel();
        });

        let started = Instant::now();
        let outcome = run_turn(
            TurnRequest {
                session_id: "s4".into(),
                turn_id: "t1".into(),
                command,
                args,
                cwd: &dir,
                prompt: "hi".into(),
                harness_id: "opencode".into(),
                workspace_id: "ws".into(),
            },
            handle,
            sink.clone(),
            &EventLog::in_dir(dir.clone(), "s4"),
        );

        assert!(
            started.elapsed() < Duration::from_secs(10),
            "cancel must not wait for the child"
        );
        assert!(outcome.cancelled);
        assert!(
            !outcome.failed,
            "a stop the user asked for is not a failure"
        );

        let events = sink.events.lock().unwrap();
        assert!(
            events.last().unwrap().is_terminal(),
            "a cancelled turn still ends, so the UI never waits forever"
        );
    }

    #[test]
    fn the_log_replays_what_was_streamed() {
        let dir = temp_sessions_dir("replay");
        let sink = Arc::new(Collector::default());
        let (command, args) =
            fake_harness(r#"printf '%s\n' '{"type":"text","id":"p1","text":"persisted"}'"#);

        run_turn(
            TurnRequest {
                session_id: "s5".into(),
                turn_id: "t1".into(),
                command,
                args,
                cwd: &dir,
                prompt: "hi".into(),
                harness_id: "opencode".into(),
                workspace_id: "ws".into(),
            },
            new_turn_handle(),
            sink.clone(),
            &EventLog::in_dir(dir.clone(), "s5"),
        );

        let replayed = EventLog::in_dir(dir.clone(), "s5").read();
        let streamed = sink.events.lock().unwrap();
        assert_eq!(
            replayed.len(),
            streamed.len(),
            "reopening a session must show exactly what was streamed"
        );
    }
}
