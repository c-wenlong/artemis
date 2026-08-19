//! Terminal sessions backed by real PTYs.
//!
//! The PTY belongs to the host process, not to the window. That is the whole
//! design: a webview reload drops the subscriber, not the terminal, so a long
//! agent run survives it. Reconnecting replays the scrollback and then resumes
//! live output.
//!
//! Everything Tauri-specific stays behind `TerminalSink`, so the store is
//! testable against `/bin/sh`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};

/// The platform's own shell, for a terminal opened without naming a program.
///
/// The webview used to choose this, and chose `/bin/zsh`: a path that does not
/// exist on Windows, so the terminal dock could not open a plain shell there at
/// all. The host is where the answer belongs: it is the half that knows what
/// operating system this is.
///
/// An empty command means "a shell". Anything else is a program the caller
/// actually asked for and is passed through untouched.
pub fn default_shell_if_empty(command: &str) -> String {
    if !command.trim().is_empty() {
        return command.to_string();
    }
    if cfg!(windows) {
        // ComSpec is what Windows itself uses to find the command processor.
        std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

/// Where a terminal's output goes. A Tauri channel in the app, a vector in tests.
pub trait TerminalSink: Send + Sync + 'static {
    fn emit(&self, terminal_id: &str, chunk: &str);
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub title: String,
    pub command: String,
    pub cwd: String,
    pub is_running: bool,
    pub started_at: String,
}

struct Terminal {
    id: String,
    title: String,
    command: String,
    cwd: String,
    started_at: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    running: Arc<AtomicBool>,
    scrollback: Arc<Mutex<String>>,
    sink: Arc<Mutex<Option<Arc<dyn TerminalSink>>>>,
}

#[derive(Default)]
pub struct PtyStore {
    terminals: Mutex<HashMap<String, Terminal>>,
    counter: Mutex<u64>,
}

impl PtyStore {
    /// Retained output per terminal. Enough to redraw a full screen and scroll
    /// back through a build, bounded so a runaway process cannot exhaust memory.
    pub const MAX_SCROLLBACK_BYTES: usize = 256 * 1024;

    fn next_id(&self) -> String {
        let mut counter = self.counter.lock().expect("counter lock");
        *counter += 1;
        format!(
            "term-{}-{}",
            *counter,
            chrono::Utc::now().timestamp_millis()
        )
    }

    pub fn open(&self, spec: TerminalSpec) -> Result<TerminalSession, String> {
        let system = NativePtySystem::default();
        let pair = system
            .openpty(PtySize {
                rows: spec.rows.max(1),
                cols: spec.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Could not open a terminal: {error}"))?;

        let mut builder = CommandBuilder::new(default_shell_if_empty(&spec.command));
        for arg in &spec.args {
            builder.arg(arg);
        }
        builder.cwd(&spec.cwd);
        // Programs read TERM to decide what escape sequences to emit; without
        // it many fall back to something unusable.
        builder.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(builder)
            .map_err(|error| format!("Could not start {}: {error}", spec.command))?;

        // portable-pty asks for the slave to be released once the child holds
        // it; while it is alive the master may never see EOF. It was previously
        // dropped at the end of this function, which is late enough to be
        // accidental rather than intended.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Could not read the terminal: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("Could not write to the terminal: {error}"))?;

        let id = self.next_id();
        let scrollback = Arc::new(Mutex::new(String::new()));
        let sink: Arc<Mutex<Option<Arc<dyn TerminalSink>>>> = Arc::new(Mutex::new(None));
        let running = Arc::new(AtomicBool::new(true));

        // One reader thread per terminal, running whether or not anyone is
        // subscribed: output has to keep accumulating across a reload.
        {
            let id = id.clone();
            let scrollback = scrollback.clone();
            let sink = sink.clone();
            let running = running.clone();
            let mut reader = reader;

            std::thread::spawn(move || {
                let mut buffer = [0u8; 8192];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            // Lossy on purpose: a read can land mid-sequence,
                            // and dropping the terminal over one byte is worse
                            // than a replacement character.
                            let chunk = String::from_utf8_lossy(&buffer[..count]).into_owned();

                            if let Ok(mut retained) = scrollback.lock() {
                                retained.push_str(&chunk);
                                if retained.len() > PtyStore::MAX_SCROLLBACK_BYTES {
                                    // Keep the tail: that is what a terminal shows.
                                    let overflow = retained.len() - PtyStore::MAX_SCROLLBACK_BYTES;
                                    let mut cut = overflow;
                                    while cut < retained.len() && !retained.is_char_boundary(cut) {
                                        cut += 1;
                                    }
                                    retained.drain(..cut);
                                }
                            }

                            let listener = sink.lock().ok().and_then(|guard| guard.clone());
                            if let Some(listener) = listener {
                                listener.emit(&id, &chunk);
                            }
                        }
                    }
                }
                running.store(false, Ordering::SeqCst);
            });
        }

        let session = TerminalSession {
            id: id.clone(),
            title: spec.title.clone(),
            command: spec.command.clone(),
            cwd: spec.cwd.to_string_lossy().into_owned(),
            is_running: true,
            started_at: chrono::Utc::now().to_rfc3339(),
        };

        self.terminals.lock().expect("terminals lock").insert(
            id.clone(),
            Terminal {
                id,
                title: spec.title,
                command: spec.command,
                cwd: session.cwd.clone(),
                started_at: session.started_at.clone(),
                master: pair.master,
                writer,
                child,
                running,
                scrollback,
                sink,
            },
        );

        Ok(session)
    }

    pub fn list(&self) -> Vec<TerminalSession> {
        let mut terminals = self.terminals.lock().expect("terminals lock");
        terminals
            .values_mut()
            .map(|terminal| {
                // `try_wait` is what notices a shell that exited on its own.
                let exited = terminal.child.try_wait().ok().flatten().is_some();
                if exited {
                    terminal.running.store(false, Ordering::SeqCst);
                }
                TerminalSession {
                    id: terminal.id.clone(),
                    title: terminal.title.clone(),
                    command: terminal.command.clone(),
                    cwd: terminal.cwd.clone(),
                    is_running: terminal.running.load(Ordering::SeqCst),
                    started_at: terminal.started_at.clone(),
                }
            })
            .collect()
    }

    /// Attach a listener and return everything already buffered.
    ///
    /// The replay comes back from this call rather than through the sink so the
    /// caller can write it to the terminal emulator in one go: feeding a
    /// hundred kilobytes through the live path one chunk at a time makes a
    /// reconnect visibly crawl.
    pub fn subscribe(&self, terminal_id: &str, sink: Arc<dyn TerminalSink>) -> String {
        let terminals = self.terminals.lock().expect("terminals lock");
        let Some(terminal) = terminals.get(terminal_id) else {
            return String::new();
        };
        if let Ok(mut slot) = terminal.sink.lock() {
            *slot = Some(sink);
        }
        terminal
            .scrollback
            .lock()
            .map(|retained| retained.clone())
            .unwrap_or_default()
    }

    /// Detach the listener. The process keeps running and its output keeps
    /// accumulating: this is what a window reload looks like from here.
    pub fn unsubscribe(&self, terminal_id: &str) {
        let terminals = self.terminals.lock().expect("terminals lock");
        if let Some(terminal) = terminals.get(terminal_id) {
            if let Ok(mut slot) = terminal.sink.lock() {
                *slot = None;
            }
        }
    }

    pub fn scrollback(&self, terminal_id: &str) -> String {
        let terminals = self.terminals.lock().expect("terminals lock");
        terminals
            .get(terminal_id)
            .and_then(|terminal| terminal.scrollback.lock().ok().map(|s| s.clone()))
            .unwrap_or_default()
    }

    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let mut terminals = self.terminals.lock().expect("terminals lock");
        let terminal = terminals
            .get_mut(terminal_id)
            .ok_or_else(|| format!("Unknown terminal: {terminal_id}"))?;
        terminal
            .writer
            .write_all(data.as_bytes())
            .and_then(|_| terminal.writer.flush())
            .map_err(|error| format!("Could not write to the terminal: {error}"))
    }

    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let terminals = self.terminals.lock().expect("terminals lock");
        let terminal = terminals
            .get(terminal_id)
            .ok_or_else(|| format!("Unknown terminal: {terminal_id}"))?;
        terminal
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Could not resize the terminal: {error}"))
    }

    pub fn close(&self, terminal_id: &str) {
        let mut terminals = self.terminals.lock().expect("terminals lock");
        if let Some(mut terminal) = terminals.remove(terminal_id) {
            let _ = terminal.child.kill();
            let _ = terminal.child.wait();
            terminal.running.store(false, Ordering::SeqCst);
        }
    }

    /// Close everything. Called on shutdown so no PTY outlives the app.
    pub fn close_all(&self) {
        let ids: Vec<String> = self
            .terminals
            .lock()
            .map(|terminals| terminals.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.close(&id);
        }
    }
}
