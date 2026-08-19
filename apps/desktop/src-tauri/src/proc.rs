//! Bounded subprocess execution.
//!
//! Every external command Artemis runs goes through here so that a hung binary
//! degrades into a timeout rather than a wedged UI. Output is drained on
//! dedicated threads: polling `try_wait` while a child fills its stdout pipe
//! deadlocks once the pipe buffer is full, which is reachable for agent output.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub struct Captured {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

impl Captured {
    pub fn ok(&self) -> bool {
        !self.timed_out && self.exit_code == Some(0)
    }
}

pub struct RunOptions<'a> {
    pub cwd: Option<&'a Path>,
    pub timeout: Duration,
    /// Extra environment on top of the inherited one.
    pub env: &'a [(&'a str, String)],
}

impl<'a> Default for RunOptions<'a> {
    fn default() -> Self {
        RunOptions {
            cwd: None,
            timeout: Duration::from_secs(5),
            env: &[],
        }
    }
}

pub fn run(command: &str, args: &[&str], options: RunOptions<'_>) -> Option<Captured> {
    let mut builder = Command::new(command);
    builder
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cwd) = options.cwd {
        builder.current_dir(cwd);
    }
    for (key, value) in options.env {
        builder.env(key, value);
    }

    let mut child = builder.spawn().ok()?;

    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_string(&mut buffer);
        }
        buffer
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_string(&mut buffer);
        }
        buffer
    });

    let deadline = Instant::now() + options.timeout;
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    break child.wait().ok();
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break None,
        }
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();

    Some(Captured {
        stdout,
        stderr,
        exit_code: status.and_then(|status| status.code()),
        timed_out,
    })
}

/// First line of stdout, trimmed and capped: the shape `--version` probes want.
pub fn first_line(command: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let captured = run(
        command,
        args,
        RunOptions {
            timeout,
            ..Default::default()
        },
    )?;
    if !captured.ok() {
        return None;
    }
    captured
        .stdout
        .lines()
        .next()
        .map(|line| line.trim().chars().take(80).collect::<String>())
        .filter(|line| !line.is_empty())
}
