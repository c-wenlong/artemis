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
    /// The harness's own id for the conversation, when one is known. This is
    /// what lets a past session be picked up again rather than merely listed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_id: Option<String>,
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

// ------------------------------------------------------------------- chat

/// A file a tool call changed, as the harness reported it.
///
/// `path` is the workspace-relative one: the absolute path opencode also sends
/// is machine-specific and too long to render.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    /// The unified diff for this file, when the harness sent one. It is what
    /// the transcript renders and what an undo reverse-applies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
}

/// Mirrors the `RuntimeEvent` union in `packages/core/src/chat/types.ts`.
///
/// Internally tagged on `type`, whose values carry dots (`turn.started`), so
/// every variant names its tag explicitly. Field casing is per-variant because
/// the union has no common struct.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RuntimeEvent {
    #[serde(rename = "turn.started", rename_all = "camelCase")]
    TurnStarted {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        harness_id: String,
        workspace_id: String,
    },
    #[serde(rename = "user.message", rename_all = "camelCase")]
    UserMessage {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        text: String,
    },
    #[serde(rename = "text.delta", rename_all = "camelCase")]
    TextDelta {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        block_id: String,
        text: String,
    },
    #[serde(rename = "reasoning.delta", rename_all = "camelCase")]
    ReasoningDelta {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        block_id: String,
        text: String,
    },
    #[serde(rename = "tool_call.started", rename_all = "camelCase")]
    ToolCallStarted {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        block_id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
    #[serde(rename = "tool_call.completed", rename_all = "camelCase")]
    ToolCallCompleted {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        block_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        /// What the call was given. Present here as well as on the start event
        /// because `opencode run --format json` reports each tool exactly once,
        /// already finished — there is no start frame to have carried it.
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        /// Files the call changed, when the harness reports them. opencode
        /// computes the per-file line counts itself, so they are carried
        /// through rather than re-derived from a patch.
        #[serde(skip_serializing_if = "Option::is_none")]
        file_changes: Option<Vec<FileChange>>,
    },
    #[serde(rename = "tool_call.errored", rename_all = "camelCase")]
    ToolCallErrored {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        block_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        message: String,
    },
    #[serde(rename = "turn.completed", rename_all = "camelCase")]
    TurnCompleted {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        opencode_session_id: Option<String>,
    },
    #[serde(rename = "turn.errored", rename_all = "camelCase")]
    TurnErrored {
        id: String,
        session_id: String,
        timestamp: String,
        turn_id: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
}

impl RuntimeEvent {
    pub fn turn_id(&self) -> &str {
        match self {
            RuntimeEvent::TurnStarted { turn_id, .. }
            | RuntimeEvent::UserMessage { turn_id, .. }
            | RuntimeEvent::TextDelta { turn_id, .. }
            | RuntimeEvent::ReasoningDelta { turn_id, .. }
            | RuntimeEvent::ToolCallStarted { turn_id, .. }
            | RuntimeEvent::ToolCallCompleted { turn_id, .. }
            | RuntimeEvent::ToolCallErrored { turn_id, .. }
            | RuntimeEvent::TurnCompleted { turn_id, .. }
            | RuntimeEvent::TurnErrored { turn_id, .. } => turn_id,
        }
    }

    pub fn session_id(&self) -> &str {
        match self {
            RuntimeEvent::TurnStarted { session_id, .. }
            | RuntimeEvent::UserMessage { session_id, .. }
            | RuntimeEvent::TextDelta { session_id, .. }
            | RuntimeEvent::ReasoningDelta { session_id, .. }
            | RuntimeEvent::ToolCallStarted { session_id, .. }
            | RuntimeEvent::ToolCallCompleted { session_id, .. }
            | RuntimeEvent::ToolCallErrored { session_id, .. }
            | RuntimeEvent::TurnCompleted { session_id, .. }
            | RuntimeEvent::TurnErrored { session_id, .. } => session_id,
        }
    }

    /// Re-home a copied event. Used by forking, where an event that still names
    /// the source session would replay into the wrong conversation.
    pub fn set_session_id(&mut self, value: &str) {
        let slot = match self {
            RuntimeEvent::TurnStarted { session_id, .. }
            | RuntimeEvent::UserMessage { session_id, .. }
            | RuntimeEvent::TextDelta { session_id, .. }
            | RuntimeEvent::ReasoningDelta { session_id, .. }
            | RuntimeEvent::ToolCallStarted { session_id, .. }
            | RuntimeEvent::ToolCallCompleted { session_id, .. }
            | RuntimeEvent::ToolCallErrored { session_id, .. }
            | RuntimeEvent::TurnCompleted { session_id, .. }
            | RuntimeEvent::TurnErrored { session_id, .. } => session_id,
        };
        *slot = value.to_string();
    }

    /// True for the events that end a turn — the signal a consumer waits on.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            RuntimeEvent::TurnCompleted { .. } | RuntimeEvent::TurnErrored { .. }
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatSessionStatus {
    Idle,
    Running,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub created_at: String,
    pub harness_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness_kind: Option<HarnessKind>,
    pub id: String,
    pub last_event_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opencode_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_path: Option<String>,
    pub status: ChatSessionStatus,
    pub title: String,
    pub workspace_id: String,
    pub workspace_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatSessionRequest {
    pub harness_id: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub opencode_session_id: Option<String>,
    #[serde(default)]
    pub start_path: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub workspace_id: String,
    pub workspace_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChatMessageRequest {
    pub prompt: String,
    #[serde(default)]
    pub start_path: Option<String>,
}

// --------------------------------------------------------------- settings

/// How much of a turn the transcript renders.
///
/// `Full` shows every tool call; `Output` shows the answer and folds the
/// mechanics behind the turn header. Which is right depends on whether you are
/// debugging the agent or reading its conclusion, so it is a setting rather
/// than a default — and it doubles as a lever over how much of a long tool run
/// stays in view.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptVerbosity {
    /// Everything. The default, because a settings file written before this
    /// existed must not silently start hiding output.
    #[default]
    Full,
    Output,
}

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
    /// Chosen app-icon variant. Applies to the running app's dock icon; the
    /// bundled icon is fixed at build time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_icon_id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_verbosity"
    )]
    pub transcript_verbosity: Option<TranscriptVerbosity>,
    /// Let Artemis shell out to Quiver's `swe` CLI for MCP reconciliation.
    ///
    /// Off unless chosen. Reading Quiver's JSON files costs nothing and is
    /// always on; running its Python is a different bargain, and one the user
    /// should make deliberately.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quiver_cli_enabled: Option<bool>,
}

/// Read the verbosity, treating anything unrecognised as unset.
///
/// `settings::read` discards the whole file on a parse error, so a strict union
/// here would let one hand-edited typo take the model and the icon down with
/// it. Losing one field is the proportionate failure.
fn lenient_verbosity<'de, D>(deserializer: D) -> Result<Option<TranscriptVerbosity>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<String>::deserialize(deserializer)?;
    Ok(match raw.as_deref() {
        Some("full") => Some(TranscriptVerbosity::Full),
        Some("output") => Some(TranscriptVerbosity::Output),
        _ => None,
    })
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
            app_icon_id: clean(self.app_icon_id),
            // Neither an enum nor a flag has anything to trim.
            transcript_verbosity: self.transcript_verbosity,
            quiver_cli_enabled: self.quiver_cli_enabled,
        }
    }
}
