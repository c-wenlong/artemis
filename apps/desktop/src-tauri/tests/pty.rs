//! Terminal sessions, against a real shell.
//!
//! A PTY is not a pipe: it echoes, it has a window size, it delivers signals.
//! Testing this against a mock would only prove the mock behaves like the mock,
//! so these drive `/bin/sh` and read what actually comes back.
//!
//! The exit criterion for M6 is that a terminal survives a UI reload. That
//! works because the PTY lives in the host process and the webview is only a
//! subscriber — so the tests that matter are the ones where a subscriber goes
//! away and comes back.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use artemis_host::pty::{PtyStore, TerminalSink, TerminalSpec};

#[derive(Default)]
struct Collector {
    chunks: Mutex<Vec<String>>,
}

impl Collector {
    fn text(&self) -> String {
        self.chunks.lock().unwrap().concat()
    }
}

impl TerminalSink for Collector {
    fn emit(&self, _terminal_id: &str, chunk: &str) {
        self.chunks.lock().unwrap().push(chunk.to_string());
    }
}

fn spec() -> TerminalSpec {
    TerminalSpec {
        command: "/bin/sh".into(),
        args: vec![],
        cwd: std::env::temp_dir(),
        cols: 80,
        rows: 24,
        title: "shell".into(),
    }
}

/// Polls rather than sleeping a fixed amount: a shell's first prompt arrives
/// when it arrives.
fn wait_for(deadline: Duration, mut done: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < deadline {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    done()
}

#[test]
fn opens_a_terminal_and_reports_it() {
    let store = PtyStore::default();
    let terminal = store.open(spec()).expect("terminal opens");

    assert!(!terminal.id.is_empty());
    assert_eq!(store.list().len(), 1);
    assert!(store.list()[0].is_running);

    store.close(&terminal.id);
}

#[test]
fn runs_a_command_and_streams_its_output() {
    let store = PtyStore::default();
    let sink = Arc::new(Collector::default());
    let terminal = store.open(spec()).unwrap();
    store.subscribe(&terminal.id, sink.clone());

    store
        .write(&terminal.id, "echo artemis-was-here\n")
        .unwrap();

    assert!(
        wait_for(Duration::from_secs(5), || sink
            .text()
            .contains("artemis-was-here")),
        "expected the command output, got: {:?}",
        sink.text()
    );

    store.close(&terminal.id);
}

/// The webview reloading drops its channel. The PTY belongs to the host, so the
/// process must keep running and its output must keep accumulating.
#[test]
fn output_survives_a_subscriber_going_away() {
    let store = PtyStore::default();
    let first = Arc::new(Collector::default());
    let terminal = store.open(spec()).unwrap();
    store.subscribe(&terminal.id, first.clone());

    store.write(&terminal.id, "echo before-reload\n").unwrap();
    assert!(wait_for(Duration::from_secs(5), || first
        .text()
        .contains("before-reload")));

    // The UI goes away.
    store.unsubscribe(&terminal.id);
    store.write(&terminal.id, "echo during-reload\n").unwrap();
    std::thread::sleep(Duration::from_millis(300));

    // …and comes back.
    let second = Arc::new(Collector::default());
    let replayed = store.subscribe(&terminal.id, second.clone());

    assert!(
        replayed.contains("before-reload"),
        "the scrollback should carry what happened before the reload: {replayed:?}"
    );
    assert!(
        wait_for(Duration::from_secs(5), || replayed
            .contains("during-reload")
            || second.text().contains("during-reload")),
        "and what happened while nobody was listening"
    );
    assert!(store.list()[0].is_running, "the process is still alive");

    store.close(&terminal.id);
}

#[test]
fn scrollback_is_bounded_so_a_chatty_process_cannot_grow_forever() {
    let store = PtyStore::default();
    let terminal = store.open(spec()).unwrap();

    // Far more than the retained window.
    store
        .write(
            &terminal.id,
            "for i in $(seq 1 4000); do echo line-$i; done\n",
        )
        .unwrap();

    let bounded = wait_for(Duration::from_secs(20), || {
        let scrollback = store.scrollback(&terminal.id);
        scrollback.contains("line-4000")
    });
    assert!(bounded, "the run should finish");

    let scrollback = store.scrollback(&terminal.id);
    assert!(
        scrollback.len() <= PtyStore::MAX_SCROLLBACK_BYTES,
        "scrollback grew to {} bytes",
        scrollback.len()
    );
    // The tail is what a terminal shows, so that is what must be kept.
    assert!(scrollback.contains("line-4000"));
    assert!(
        !scrollback.contains("line-1\n"),
        "the oldest output should have been dropped"
    );

    store.close(&terminal.id);
}

/// A PTY has a window size, and programs read it. If resize did nothing,
/// anything full-screen would render at the wrong dimensions.
#[test]
fn resizing_changes_the_size_the_program_sees() {
    let store = PtyStore::default();
    let sink = Arc::new(Collector::default());
    let terminal = store.open(spec()).unwrap();
    store.subscribe(&terminal.id, sink.clone());

    store.resize(&terminal.id, 100, 40).unwrap();
    store.write(&terminal.id, "stty size\n").unwrap();

    assert!(
        wait_for(Duration::from_secs(5), || sink.text().contains("40 100")),
        "expected `40 100` from stty, got: {:?}",
        sink.text()
    );

    store.close(&terminal.id);
}

#[test]
fn closing_ends_the_process() {
    let store = PtyStore::default();
    let terminal = store.open(spec()).unwrap();
    store.close(&terminal.id);

    assert!(
        wait_for(Duration::from_secs(5), || store.list().is_empty()),
        "a closed terminal should not be listed"
    );
}

#[test]
fn notices_when_the_shell_exits_on_its_own() {
    let store = PtyStore::default();
    let terminal = store.open(spec()).unwrap();

    store.write(&terminal.id, "exit\n").unwrap();

    assert!(
        wait_for(Duration::from_secs(5), || store
            .list()
            .first()
            .map(|session| !session.is_running)
            .unwrap_or(true)),
        "the session should stop reporting itself as running"
    );

    store.close(&terminal.id);
}

#[test]
fn operations_on_an_unknown_terminal_are_errors_not_panics() {
    let store = PtyStore::default();
    assert!(store.write("nope", "hi").is_err());
    assert!(store.resize("nope", 80, 24).is_err());
    assert!(store.scrollback("nope").is_empty());
    store.close("nope"); // must not panic
}

#[test]
fn refuses_a_command_that_does_not_exist() {
    let store = PtyStore::default();
    let result = store.open(TerminalSpec {
        command: "/nonexistent/shell".into(),
        ..spec()
    });
    assert!(result.is_err(), "opening should fail rather than hang");
    assert!(store.list().is_empty());
}

#[test]
fn several_terminals_stay_independent() {
    let store = PtyStore::default();
    let one = Arc::new(Collector::default());
    let two = Arc::new(Collector::default());

    let first = store.open(spec()).unwrap();
    let second = store.open(spec()).unwrap();
    store.subscribe(&first.id, one.clone());
    store.subscribe(&second.id, two.clone());

    store.write(&first.id, "echo first-only\n").unwrap();

    assert!(wait_for(Duration::from_secs(5), || one
        .text()
        .contains("first-only")));
    assert!(
        !two.text().contains("first-only"),
        "output must not leak between terminals"
    );
    assert_eq!(store.list().len(), 2);

    store.close(&first.id);
    store.close(&second.id);
}
