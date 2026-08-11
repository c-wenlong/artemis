//! A stand-in for a coding agent, for the streaming tests.
//!
//! These tests used `/bin/sh -c` with a `printf` script, which is not a shell
//! that exists on Windows — so all three of them failed there, on a code path
//! that was fine. CI caught it the first time it was ever allowed to run.
//!
//! A compiled helper is the portable version: cargo builds it for whatever
//! target the tests run on, and `env!("CARGO_BIN_EXE_fake_harness")` gives the
//! tests its path. No shell, no quoting rules, no `sleep` binary.
//!
//! ```text
//! fake_harness --line '{"type":"text",…}' --line '…' --stderr boom --exit 3 --sleep-ms 30000
//! ```
//!
//! Order matters: every `--line` is written to stdout in order and flushed as
//! it goes, because a test that cancels mid-turn needs the earlier lines to
//! have actually arrived.

use std::io::Write;

fn main() {
    let mut args = std::env::args().skip(1);
    let mut code = 0;
    let mut sleep_ms = 0u64;
    let stdout = std::io::stdout();

    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--line" => {
                let line = args.next().unwrap_or_default();
                let mut handle = stdout.lock();
                let _ = writeln!(handle, "{line}");
                // Flushed per line: the cancellation test asserts that what was
                // emitted before the stop actually reached the reader.
                let _ = handle.flush();
            }
            "--stderr" => {
                let message = args.next().unwrap_or_default();
                eprintln!("{message}");
            }
            // A chatty process, for the scrollback bound. The shell version of
            // this was `for i in $(seq 1 4000)`, which cmd.exe cannot run.
            "--count-to" => {
                let last: u32 = args.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                let mut handle = stdout.lock();
                for number in 1..=last {
                    let _ = writeln!(handle, "line-{number}");
                }
                let _ = handle.flush();
            }
            "--exit" => code = args.next().and_then(|v| v.parse().ok()).unwrap_or(0),
            "--sleep-ms" => sleep_ms = args.next().and_then(|v| v.parse().ok()).unwrap_or(0),
            other => {
                eprintln!("fake_harness: unknown flag {other}");
                std::process::exit(2);
            }
        }
    }

    if sleep_ms > 0 {
        std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
    }
    std::process::exit(code);
}
