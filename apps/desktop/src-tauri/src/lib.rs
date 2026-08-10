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

/// Public so `tests/contract.rs` can assert the serialized wire shape against
/// what `@artemis/core` declares.
pub mod types;

use types::{
    AgentLaunchRequest, AgentLaunchResult, AgentSessionSummary, AssetInventorySnapshot, ProjectRef,
    ReviewSnapshot, RuntimeSettings, WorkspaceSummary,
};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            list_projects,
            list_workspaces,
            list_sessions,
            get_review_snapshot,
            get_runtime_settings,
            update_runtime_settings,
            launch_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Artemis");
}
