//! Quiver, read as files.
//!
//! Quiver (`orchestrators/quiver`, the `swe` CLI) keeps its state as plain JSON
//! under `~/.config/swe/`. That makes it an enrichment source Artemis can read
//! directly — no Python, no subprocess, no version coupling — and this module
//! is the only place that knows those shapes. See `docs/QUIVER_SCHEMA.md`.
//!
//! The rules this module exists to keep, from `docs/QUIVER_INTEGRATION.md`:
//!
//! - **Artemis works fully with Quiver absent.** Every function here returns
//!   empty rather than failing, and every caller treats empty as normal.
//! - **Never write to `~/.config/swe/`.** Two writers in two languages with no
//!   locking protocol is a corruption bug waiting to happen. Read-only, always.
//! - **Every field is optional.** A renamed field costs that field. A malformed
//!   row is dropped, not propagated. A corrupt file degrades to nothing.
//! - **The native scan is ground truth.** Quiver's registry is curated by hand
//!   and can name a binary that has since been uninstalled; only the scan knows
//!   what is actually on disk.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::scanner::home_dir;
use crate::types::{
    AgentSessionStatus, AgentSessionSummary, AssetHealth, HarnessAsset, HarnessDiscoverySource,
    HarnessKind, McpServerAsset, McpTransport,
};

/// Where Quiver keeps its state.
pub fn config_root() -> PathBuf {
    home_dir().join(".config/swe")
}

/// One row of `tools.json`, which is an object keyed by tool id.
///
/// Everything is optional: this is a hand-editable file, and a row missing a
/// description is still worth its aliases.
#[derive(Debug, Clone, Deserialize)]
pub struct ToolEntry {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// One row of `session_cache.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct QuiverSession {
    #[serde(default)]
    pub timestamp: Option<f64>,
    /// Display name of the harness, e.g. "OpenCode".
    #[serde(default)]
    pub agent: Option<String>,
    /// Registry id of the harness, e.g. "opencode".
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub title: String,
    /// The harness's own id for the conversation. Without it a row is history
    /// that cannot be resumed, which is not what this file is read for.
    #[serde(default)]
    pub session_id: Option<String>,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let raw = std::fs::read_to_string(path).ok()?;
    // A parse failure is a Quiver that has changed shape or a file mid-write.
    // Either way the answer is "no data", not an error the user has to action.
    serde_json::from_str(&raw).ok()
}

/// The curated harness registry, keyed by tool id. Empty when absent.
///
/// Deserialized row-by-row rather than as one map, so a single malformed entry
/// costs that entry instead of the file.
pub fn registry(root: &Path) -> HashMap<String, ToolEntry> {
    let Some(raw) = read_json::<HashMap<String, serde_json::Value>>(&root.join("tools.json"))
    else {
        return HashMap::new();
    };

    raw.into_iter()
        .filter_map(|(id, value)| {
            serde_json::from_value::<ToolEntry>(value)
                .ok()
                .map(|entry| (id, entry))
        })
        .collect()
}

/// Parsed session history, newest first. Empty when absent.
///
/// Rows without a resume id are dropped: this file is read so a past
/// conversation can be picked up again, and a row that cannot be resumed is
/// history Artemis has no use for.
pub fn sessions(root: &Path) -> Vec<QuiverSession> {
    let path = root.join("session_cache.json");

    // Current Quiver writes `{ cached_at, sessions: [...] }`; older versions
    // wrote a bare array. Tolerating both costs a few lines and avoids a
    // silently empty history on a machine running either.
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Cache {
        Wrapped { sessions: Vec<serde_json::Value> },
        Bare(Vec<serde_json::Value>),
    }

    let Some(cache) = read_json::<Cache>(&path) else {
        return Vec::new();
    };
    let rows = match cache {
        Cache::Wrapped { sessions } => sessions,
        Cache::Bare(sessions) => sessions,
    };

    let mut parsed: Vec<QuiverSession> = rows
        .into_iter()
        .filter_map(|row| serde_json::from_value::<QuiverSession>(row).ok())
        .filter(|session| session.session_id.is_some())
        .collect();

    // Newest first. Rows without a timestamp sort last rather than being
    // dropped — they are still resumable.
    parsed.sort_by(|a, b| {
        b.timestamp
            .unwrap_or(f64::MIN)
            .partial_cmp(&a.timestamp.unwrap_or(f64::MIN))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    parsed
}

/// History recorded against one directory.
pub fn sessions_at(root: &Path, workspace_path: &str) -> Vec<QuiverSession> {
    let wanted = workspace_path.trim_end_matches('/');
    sessions(root)
        .into_iter()
        .filter(|session| {
            session
                .path
                .as_deref()
                .map(|path| path.trim_end_matches('/') == wanted)
                .unwrap_or(false)
        })
        .collect()
}

/// Layer the registry onto a native scan.
///
/// Additive only. The scan decides whether a harness exists, where it is, and
/// what version actually answered `--version`; Quiver supplies the things a
/// scan cannot know — aliases, a human description, a curated version for a
/// harness that reports none. A row Quiver has nothing to say about keeps its
/// original provenance, so `QuiverCatalog` means Quiver really did contribute.
pub fn enrich_harnesses(root: &Path, harnesses: &mut [HarnessAsset]) {
    let registry = registry(root);
    if registry.is_empty() {
        return;
    }

    for harness in harnesses.iter_mut() {
        // Match on id, then on the command the scan found — Quiver keys by its
        // own tool name, which is usually but not always the binary name.
        let Some(entry) = registry.get(&harness.id).or_else(|| {
            registry
                .values()
                .find(|e| e.command.as_deref() == Some(&harness.command))
        }) else {
            continue;
        };

        let mut contributed = false;

        if harness.aliases.is_empty() && !entry.aliases.is_empty() {
            harness.aliases = entry.aliases.clone();
            contributed = true;
        }
        if harness.description.is_none() && entry.description.is_some() {
            harness.description = entry.description.clone();
            contributed = true;
        }
        // Only when the scan could not probe one. A version someone typed into
        // a registry months ago must not displace one the binary just reported.
        if harness.version.is_none() && entry.version.is_some() {
            harness.version = entry.version.clone();
            contributed = true;
        }

        if contributed {
            harness.source = HarnessDiscoverySource::QuiverCatalog;
        }
    }
}

/// Whether there is anything here worth reading.
///
/// True if any single file exists — a half-installed Quiver still has a history
/// or a registry, and refusing both because the third is missing would be
/// throwing away data that is right there.
pub fn is_present(root: &Path) -> bool {
    ["tools.json", "session_cache.json", "providers.json"]
        .iter()
        .any(|name| root.join(name).is_file())
}

/// Map a Quiver tool name onto the kinds Artemis renders differently.
///
/// An unknown name is `Custom`, not a dropped row: a harness Artemis has no
/// special rendering for is still history worth listing.
fn harness_kind(tool_name: Option<&str>) -> HarnessKind {
    match tool_name.unwrap_or("").to_lowercase().as_str() {
        "opencode" => HarnessKind::Opencode,
        "claude" => HarnessKind::Claude,
        "codex" => HarnessKind::Codex,
        "gemini" => HarnessKind::Gemini,
        "cursor" | "cursor-agent" => HarnessKind::Cursor,
        "copilot" => HarnessKind::Copilot,
        "droid" => HarnessKind::Droid,
        "amp" => HarnessKind::Amp,
        "pi" => HarnessKind::Pi,
        _ => HarnessKind::Custom,
    }
}

fn rfc3339(timestamp: Option<f64>) -> String {
    // Quiver writes milliseconds since the epoch as a float.
    let millis = timestamp.unwrap_or(0.0) as i64;
    chrono::DateTime::from_timestamp_millis(millis)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339()
}

/// Quiver's history as Artemis's own type.
///
/// `workspace_path` scopes it to one directory; `None` imports everything.
/// Every row is `Complete`: these are conversations that already finished
/// somewhere else, and showing one as running would be a claim about a process
/// Artemis does not own.
pub fn session_summaries(
    root: &Path,
    workspace_id: &str,
    workspace_path: Option<&str>,
) -> Vec<AgentSessionSummary> {
    let rows = match workspace_path {
        Some(path) => sessions_at(root, path),
        None => sessions(root),
    };

    rows.into_iter()
        .map(|session| AgentSessionSummary {
            id: format!("quiver:{}", session.session_id.clone().unwrap_or_default()),
            workspace_id: workspace_id.to_string(),
            harness: harness_kind(session.tool_name.as_deref()),
            title: if session.title.trim().is_empty() {
                session
                    .agent
                    .clone()
                    .unwrap_or_else(|| "Untitled session".to_string())
            } else {
                session.title.clone()
            },
            status: AgentSessionStatus::Complete,
            started_at: rfc3339(session.timestamp),
            last_event_at: rfc3339(session.timestamp),
            attention_reason: None,
            // Imported history has no captured output; inventing a preview
            // would be indistinguishable from a real one.
            terminal_preview: String::new(),
            resume_id: session.session_id,
        })
        .collect()
}

// ------------------------------------------------------------- the CLI source

/// Turn `swe mcp discover --json` output into MCP assets.
///
/// The value here is the `tools` array: which harnesses each server is
/// registered in, which is the cross-tool reconciliation nothing else in
/// Artemis can compute. A row without a name is dropped rather than shown
/// nameless.
pub fn parse_mcp_discovery(stdout: &str) -> Vec<McpServerAsset> {
    #[derive(Deserialize)]
    struct Row {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        tools: Vec<String>,
    }

    let Ok(rows) = serde_json::from_str::<Vec<Row>>(stdout) else {
        return Vec::new();
    };

    rows.into_iter()
        .filter_map(|row| {
            let name = row.name?;
            Some(McpServerAsset {
                id: format!("quiver:{name}"),
                // Every harness the server is registered in, which is the
                // reconciliation. One field, because that is what the type has.
                owner_tool: row.tools.join(", "),
                health: if row.tools.is_empty() {
                    // Configured somewhere Quiver could see, but registered in
                    // nothing — worth showing, not worth calling ready.
                    AssetHealth::Unknown
                } else {
                    AssetHealth::Ready
                },
                name,
                transport: McpTransport::Stdio,
            })
        })
        .collect()
}

/// Run a discovery command and parse it. Opt-in, timed out, failure is no data.
///
/// Never surfaces an error: this is an enrichment nobody asked to depend on, so
/// a missing CLI, a non-zero exit, a timeout and unparseable output all mean
/// the same thing — Artemis shows what it found natively.
pub fn mcp_servers_via(command: &str, timeout_secs: u64) -> Vec<McpServerAsset> {
    let captured = crate::proc::run(
        command,
        &["mcp", "discover", "--json"],
        crate::proc::RunOptions {
            timeout: std::time::Duration::from_secs(timeout_secs),
            ..Default::default()
        },
    );

    match captured {
        Some(output) if output.exit_code == Some(0) && !output.timed_out => {
            parse_mcp_discovery(&output.stdout)
        }
        _ => Vec::new(),
    }
}
