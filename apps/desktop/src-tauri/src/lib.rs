//! Artemis local host.
//!
//! Replaces the Vite dev-server middleware that previously served
//! `/api/artemis/*`. Each former endpoint is now a Tauri command; the
//! TypeScript host survives only as a browser-mode reference implementation
//! (`pnpm dev:web`) and is not on the app's runtime path.

/// Public so `tests/appicon.rs` can check the catalog against the shipped files.
pub mod appicon;
mod catalog;
mod inventory;

/// Public so `tests/worktrees.rs` can exercise the worktree lifecycle against
/// real repositories.
pub mod git;
mod launcher;
/// Public so `tests/peek.rs` can resolve citations against a real directory.
pub mod paths;
pub mod peek;
mod proc;
mod scanner;
mod settings;

/// Public so `tests/persistence.rs` can exercise migrations and recovery.
pub mod db;
/// Public so `tests/pty.rs` can drive terminal sessions against a real shell.
pub mod pty;
/// Public so `tests/record_demo_log.rs` can resolve a real workspace.
pub mod workspace;

/// Public so `tests/parser.rs` can drive the opencode parser directly.
pub mod chat;
/// Public so `tests/contract.rs` can assert the serialized wire shape against
/// what `@artemis/core` declares.
pub mod types;

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::path::BaseDirectory;
use tauri::{Manager, State};

use chat::stream::EventSink;
use chat::ChatStore;
use db::Db;
use pty::{PtyStore, TerminalSession, TerminalSink, TerminalSpec};
use types::{
    AgentLaunchRequest, AgentLaunchResult, AgentSessionSummary, AssetInventorySnapshot,
    ChatSession, CreateChatSessionRequest, ProjectRef, ReviewSnapshot, RuntimeEvent,
    RuntimeSettings, SendChatMessageRequest, WorkspaceSummary,
};

/// Bridges the run loop to the webview. Events arrive as batches because the
/// stream coalesces before emitting — one IPC message per flush, not per token.
struct ChannelSink(Channel<Vec<RuntimeEvent>>);

impl EventSink for ChannelSink {
    fn emit(&self, events: &[RuntimeEvent]) {
        // A closed channel means the window went away mid-turn; the run loop
        // should finish and record to the log regardless.
        let _ = self.0.send(events.to_vec());
    }
}

/// Terminal output reaches the webview as plain chunks; xterm.js parses the
/// escape sequences, so nothing here needs to understand them.
struct TerminalChannelSink(Channel<String>);

impl TerminalSink for TerminalChannelSink {
    fn emit(&self, _terminal_id: &str, chunk: &str) {
        let _ = self.0.send(chunk.to_string());
    }
}

// Scanning touches the filesystem and spawns `--version` probes, so it runs on
// the blocking pool rather than the async runtime's worker threads.
#[tauri::command]
async fn get_snapshot() -> Result<AssetInventorySnapshot, String> {
    tauri::async_runtime::spawn_blocking(inventory::snapshot)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_projects() -> Result<Vec<ProjectRef>, String> {
    tauri::async_runtime::spawn_blocking(workspace::list_projects)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_workspaces(project_id: Option<String>) -> Result<Vec<WorkspaceSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::list_workspaces(project_id.as_deref()))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_sessions(workspace_id: Option<String>) -> Result<Vec<AgentSessionSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::list_sessions(workspace_id.as_deref()))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_review_snapshot(workspace_id: String) -> Result<ReviewSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::review_snapshot(&workspace_id))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_runtime_settings() -> Result<RuntimeSettings, String> {
    Ok(settings::read())
}

#[tauri::command]
async fn update_runtime_settings(settings: RuntimeSettings) -> Result<RuntimeSettings, String> {
    settings::write(settings)
}

#[tauri::command]
async fn launch_agent(request: AgentLaunchRequest) -> Result<AgentLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || launcher::launch(request))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_workspace(project_id: String, branch: String) -> Result<WorkspaceSummary, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::create_workspace(&project_id, &branch))
        .await
        .map_err(|error| error.to_string())?
}

/// `force` discards uncommitted work; without it a dirty worktree is refused.
#[tauri::command]
async fn delete_workspace(workspace_id: String, force: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || workspace::delete_workspace(&workspace_id, force))
        .await
        .map_err(|error| error.to_string())?
}

/// Read a variant's artwork, preferring the bundled resource and falling back
/// to the source tree so `tauri dev` works before anything is packaged.
fn read_icon_bytes(app: &tauri::AppHandle, id: &str) -> Result<Vec<u8>, String> {
    let relative = format!("icons/variants/{id}.png");
    if let Ok(path) = app.path().resolve(&relative, BaseDirectory::Resource) {
        if let Ok(bytes) = std::fs::read(&path) {
            return Ok(bytes);
        }
    }
    let fallback = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(&relative);
    std::fs::read(&fallback).map_err(|error| format!("read {fallback:?}: {error}"))
}

#[tauri::command]
async fn list_app_icons() -> Result<Vec<appicon::AppIcon>, String> {
    Ok(appicon::catalog())
}

/// Apply a variant to the running app and remember it.
///
/// This changes the dock icon of the running process. The bundled icon — what
/// Finder shows, and what the dock shows before launch — is baked at build time
/// and is not something the app can rewrite.
#[tauri::command]
async fn set_app_icon(app: tauri::AppHandle, icon_id: String) -> Result<(), String> {
    if !appicon::is_known(&icon_id) {
        return Err(format!("Unknown icon: {icon_id}"));
    }
    let bytes = read_icon_bytes(&app, &icon_id)?;

    // AppKit insists on the main thread.
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(appicon::apply_to_running_app(&bytes));
    })
    .map_err(|error| error.to_string())?;
    rx.recv().map_err(|error| error.to_string())??;

    let mut current = settings::read();
    current.app_icon_id = Some(icon_id);
    settings::write(current).map(|_| ())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchPresetPayload {
    harness_id: String,
    model: Option<String>,
}

#[tauri::command]
async fn get_launch_preset(
    db: State<'_, Arc<Db>>,
    workspace_id: String,
) -> Result<Option<LaunchPresetPayload>, String> {
    Ok(db.preset(&workspace_id)?.map(|preset| LaunchPresetPayload {
        harness_id: preset.harness_id,
        model: preset.model,
    }))
}

#[tauri::command]
async fn save_launch_preset(
    db: State<'_, Arc<Db>>,
    workspace_id: String,
    harness_id: String,
    model: Option<String>,
) -> Result<(), String> {
    db.save_preset(&workspace_id, &harness_id, model.as_deref())
}

#[tauri::command]
async fn create_chat_session(
    store: State<'_, Arc<ChatStore>>,
    request: CreateChatSessionRequest,
) -> Result<ChatSession, String> {
    Ok(store.create_session(request))
}

/// Runs a turn, streaming batches of events into `channel` until a terminal
/// event. Resolves when the turn ends; the UI drives off the channel, not the
/// return value.
#[tauri::command]
async fn send_chat_message(
    store: State<'_, Arc<ChatStore>>,
    session_id: String,
    request: SendChatMessageRequest,
    channel: Channel<Vec<RuntimeEvent>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    let sink: Arc<dyn EventSink> = Arc::new(ChannelSink(channel));
    tauri::async_runtime::spawn_blocking(move || store.send_message(&session_id, request, sink))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn cancel_chat_turn(
    store: State<'_, Arc<ChatStore>>,
    session_id: String,
) -> Result<(), String> {
    store.cancel(&session_id);
    Ok(())
}

/// Replays a session's recorded events so reopening shows the turn that ran.
#[tauri::command]
async fn replay_chat_session(session_id: String) -> Result<Vec<RuntimeEvent>, String> {
    tauri::async_runtime::spawn_blocking(move || ChatStore::replay(&session_id))
        .await
        .map_err(|error| error.to_string())
}

/// Branches a conversation: a new session carrying every turn up to this one.
#[tauri::command]
async fn fork_chat_session(
    store: State<'_, Arc<ChatStore>>,
    session_id: String,
    through_turn_id: String,
) -> Result<ChatSession, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .fork_session(&session_id, &through_turn_id)
            .ok_or_else(|| format!("Nothing to fork at turn {through_turn_id}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Undo one file's worth of an agent's edit by reverse-applying its patch.
///
/// Refuses rather than forces: if the file has moved on since, the patch no
/// longer describes it, and applying it anyway would corrupt what came after.
#[tauri::command]
async fn revert_file_change(
    workspace_path: String,
    relative_path: String,
    patch: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::revert_patch(
            std::path::Path::new(&workspace_path),
            &relative_path,
            &patch,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Read the lines a citation points at, so a claim can be checked in place.
#[tauri::command]
async fn peek_file(
    workspace_path: String,
    relative_path: String,
    line: Option<u32>,
    radius: Option<u32>,
) -> Result<peek::FileWindow, String> {
    tauri::async_runtime::spawn_blocking(move || {
        peek::read_window(
            std::path::Path::new(&workspace_path),
            &relative_path,
            line,
            radius.unwrap_or(6),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_terminal(
    store: State<'_, Arc<PtyStore>>,
    spec: TerminalSpec,
) -> Result<TerminalSession, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.open(spec))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_terminals(store: State<'_, Arc<PtyStore>>) -> Result<Vec<TerminalSession>, String> {
    Ok(store.list())
}

/// Attaches a listener and returns everything buffered so far.
///
/// The replay comes back as the return value rather than through the channel:
/// the webview writes it to xterm in one call, where feeding a hundred
/// kilobytes through the live path chunk by chunk makes a reconnect crawl.
#[tauri::command]
async fn subscribe_terminal(
    store: State<'_, Arc<PtyStore>>,
    terminal_id: String,
    channel: Channel<String>,
) -> Result<String, String> {
    let sink: Arc<dyn TerminalSink> = Arc::new(TerminalChannelSink(channel));
    Ok(store.subscribe(&terminal_id, sink))
}

#[tauri::command]
async fn unsubscribe_terminal(
    store: State<'_, Arc<PtyStore>>,
    terminal_id: String,
) -> Result<(), String> {
    store.unsubscribe(&terminal_id);
    Ok(())
}

#[tauri::command]
async fn write_terminal(
    store: State<'_, Arc<PtyStore>>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    store.write(&terminal_id, &data)
}

#[tauri::command]
async fn resize_terminal(
    store: State<'_, Arc<PtyStore>>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    store.resize(&terminal_id, cols, rows)
}

#[tauri::command]
async fn close_terminal(
    store: State<'_, Arc<PtyStore>>,
    terminal_id: String,
) -> Result<(), String> {
    store.close(&terminal_id);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A database that cannot be opened is not a reason to refuse to start —
    // fall back to memory so the app runs, losing only what would have been
    // remembered across restarts.
    let db = Arc::new(
        Db::open(&db::default_path())
            .or_else(|error| {
                eprintln!("artemis: falling back to an in-memory database: {error}");
                Db::in_memory()
            })
            .expect("in-memory database"),
    );

    // Anything still marked running was interrupted by a crash: nothing is
    // running after the process dies.
    match db.recover_interrupted_sessions() {
        Ok(0) => {}
        Ok(count) => eprintln!("artemis: marked {count} interrupted session(s) as stopped"),
        Err(error) => eprintln!("artemis: could not recover sessions: {error}"),
    }

    tauri::Builder::default()
        .manage(db.clone())
        .manage(Arc::new(ChatStore::new(db)))
        .manage(Arc::new(PtyStore::default()))
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            list_projects,
            list_workspaces,
            list_sessions,
            get_review_snapshot,
            get_runtime_settings,
            update_runtime_settings,
            launch_agent,
            create_workspace,
            delete_workspace,
            create_chat_session,
            send_chat_message,
            cancel_chat_turn,
            replay_chat_session,
            fork_chat_session,
            revert_file_change,
            peek_file,
            open_terminal,
            list_terminals,
            subscribe_terminal,
            unsubscribe_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            get_launch_preset,
            save_launch_preset,
            list_app_icons,
            set_app_icon,
        ])
        .setup(|app| {
            // Restore the remembered icon. Only the running app's icon can be
            // changed, so this has to happen on every launch.
            let stored = settings::read().app_icon_id;
            let id = appicon::resolve_id(stored.as_deref()).to_string();
            if id != appicon::DEFAULT_ICON_ID {
                if let Ok(bytes) = read_icon_bytes(app.handle(), &id) {
                    let _ = appicon::apply_to_running_app(&bytes);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(store) = window.try_state::<Arc<PtyStore>>() {
                    store.close_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Artemis");
}
