//! Rust mirror of `@artemis/core`.
//!
//! `@artemis/core` stays the contract; these structs must serialize to exactly
//! the JSON its TypeScript types describe. `tests/contract.rs` pins the wire
//! shape so a rename on either side fails the build rather than the UI.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------- catalog

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetHealth {
    Ready,
    Missing,
    NeedsSetup,
    Unknown,
}

impl AssetHealth {
    /// Sort weight used by the inventory: ready first, missing last.
    pub fn rank(self) -> u8 {
        match self {
            AssetHealth::Ready => 0,
            AssetHealth::NeedsSetup => 1,
            AssetHealth::Unknown => 2,
            AssetHealth::Missing => 3,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HarnessKind {
    Pi,
    Amp,
    Claude,
    Codex,
    Gemini,
    Cursor,
    Opencode,
    Copilot,
    Droid,
    Local,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HarnessDiscoverySource {
    Path,
    Settings,
    WorkspaceConfig,
    QuiverCatalog,
    Seed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAsset {
    pub id: String,
    pub kind: HarnessKind,
    pub label: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub aliases: Vec<String>,
    pub health: AssetHealth,
    pub source: HarnessDiscoverySource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_mentions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillScope {
    Shared,
    Claude,
    Codex,
    Cursor,
    Project,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAsset {
    pub id: String,
    pub name: String,
    pub path: String,
    pub scope: SkillScope,
    pub health: AssetHealth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    Stdio,
    Http,
    Sse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerAsset {
    pub id: String,
    pub name: String,
    pub owner_tool: String,
    pub transport: McpTransport,
    pub health: AssetHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAsset {
    pub id: String,
    pub name: String,
    pub env_var: String,
    pub health: AssetHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInventorySnapshot {
    pub captured_at: String,
    pub harnesses: Vec<HarnessAsset>,
    pub skills: Vec<SkillAsset>,
    pub mcp_servers: Vec<McpServerAsset>,
    pub providers: Vec<ProviderAsset>,
}

// -------------------------------------------------------------- workspace

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceStatus {
    Ready,
    Creating,
    Running,
    NeedsAttention,
    Error,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub main_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub branch: String,
    pub worktree_path: String,
    pub status: WorkspaceStatus,
    pub active_session_ids: Vec<String>,
    pub changed_file_count: u32,
    pub last_activity_at: String,
}

// ---------------------------------------------------------------- session

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentSessionStatus {
    Queued,
    Running,
    Waiting,
    Complete,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub id: String,
    pub workspace_id: String,
    pub harness: HarnessKind,
    pub title: String,
    pub status: AgentSessionStatus,
    pub started_at: String,
    pub last_event_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attention_reason: Option<String>,
    pub terminal_preview: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchRequest {
    pub harness_id: String,
    pub prompt: String,
    #[serde(default)]
    pub start_path: Option<String>,
    #[allow(dead_code)]
    pub workspace_id: String,
    pub workspace_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchResult {
    pub args: Vec<String>,
    pub command: String,
    pub completed_at: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub ok: bool,
    pub started_at: String,
    pub stderr: String,
    pub stdout: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timed_out: Option<bool>,
}

// ----------------------------------------------------------------- review

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub kind: ChangeKind,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSnapshot {
    pub workspace_id: String,
    pub base_branch: String,
    pub files: Vec<ChangedFile>,
    pub artifact_paths: Vec<String>,
}

// --------------------------------------------------------------- settings

/// Persisted to `~/.artemis/settings.json`.
///
/// `scan_root` is new in the Rust host: the TypeScript host derived the scan
/// root from the app's own location, which meant an unbounded walk of whatever
/// happened to sit above it. Making it explicit is what keeps the inventory
/// scan bounded.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opencode_default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opencode_executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scan_root: Option<String>,
}

impl RuntimeSettings {
    /// Trim, and drop anything that trimmed to nothing. Mirrors
    /// `sanitizeRuntimeSettings` in the TypeScript host.
    pub fn sanitized(self) -> Self {
        fn clean(value: Option<String>) -> Option<String> {
            value
                .map(|raw| raw.trim().to_string())
                .filter(|trimmed| !trimmed.is_empty())
        }
        RuntimeSettings {
            opencode_default_model: clean(self.opencode_default_model),
            opencode_executable_path: clean(self.opencode_executable_path),
            scan_root: clean(self.scan_root),
        }
    }
}
