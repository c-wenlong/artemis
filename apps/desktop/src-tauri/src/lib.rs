//! Artemis local host.
//!
//! Replaces the Vite dev-server middleware that previously served
//! `/api/artemis/*`. Each former endpoint is now a Tauri command; the
//! TypeScript host survives only as a browser-mode reference implementation
//! (`pnpm dev:web`) and is not on the app's runtime path.

mod catalog;
mod git;
mod inventory;
mod launcher;
mod proc;
mod scanner;
mod settings;
mod workspace;

/// Public so `tests/parser.rs` can drive the opencode parser directly.
pub mod chat;
/// Public so `tests/contract.rs` can assert the serialized wire shape against
/// what `@artemis/core` declares.
pub mod types;

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use chat::stream::EventSink;
use chat::ChatStore;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(ChatStore::default()))
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            list_projects,
            list_workspaces,
            list_sessions,
            get_review_snapshot,
            get_runtime_settings,
            update_runtime_settings,
            launch_agent,
            create_chat_session,
            send_chat_message,
            cancel_chat_turn,
            replay_chat_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Artemis");
}
