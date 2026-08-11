//! Asset inventory assembly.
//!
//! The TypeScript host seeded skills, MCP servers, and providers with plausible
//! fake rows ("GitHub / codex / ready") that were indistinguishable from real
//! findings. Here everything is discovered for real, and anything undiscoverable
//! stays empty — an empty state is honest, invented data is not.
//!
//! MCP servers are the one thing Artemis cannot find natively: the registration
//! lives in each harness's own config in its own format. Quiver already reads
//! all of them, so that row comes from `swe mcp discover --json` when the user
//! has turned the CLI on, and is empty otherwise.

use std::fs;
use std::path::{Path, PathBuf};

use crate::quiver;
use crate::scanner::{home_dir, scan_harnesses, ScanOptions};
use crate::settings;
use crate::types::{
    AssetHealth, AssetInventorySnapshot, HarnessAsset, McpServerAsset, ProviderAsset, SkillAsset,
    SkillScope,
};

/// Roots that hold agent skills, and the scope each implies.
fn skill_roots() -> Vec<(PathBuf, SkillScope)> {
    let home = home_dir();
    vec![
        (home.join(".agents/skills"), SkillScope::Shared),
        (home.join(".claude/skills"), SkillScope::Claude),
        (home.join(".codex/skills"), SkillScope::Codex),
        (home.join(".cursor/skills"), SkillScope::Cursor),
    ]
}

fn scan_skill_root(root: &Path, scope: SkillScope) -> Vec<SkillAsset> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut skills: Vec<SkillAsset> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            // A skill directory is one containing SKILL.md; anything else is a
            // container we should not advertise as installed.
            let health = if path.join("SKILL.md").is_file() {
                AssetHealth::Ready
            } else {
                AssetHealth::Unknown
            };
            Some(SkillAsset {
                id: format!("{}:{}", scope_id(scope), name),
                name,
                path: path.to_string_lossy().into_owned(),
                scope,
                health,
            })
        })
        .collect();
    skills.sort_by_key(|skill| skill.name.to_lowercase());
    skills
}

fn scope_id(scope: SkillScope) -> &'static str {
    match scope {
        SkillScope::Shared => "shared",
        SkillScope::Claude => "claude",
        SkillScope::Codex => "codex",
        SkillScope::Cursor => "cursor",
        SkillScope::Project => "project",
    }
}

pub fn scan_skills() -> Vec<SkillAsset> {
    skill_roots()
        .into_iter()
        .flat_map(|(root, scope)| scan_skill_root(&root, scope))
        .collect()
}

/// Providers Artemis knows how to look for, and the env var that authenticates
/// each. Presence of the variable is all that is checked — the key itself is
/// never read, logged, or sent anywhere.
const KNOWN_PROVIDERS: &[(&str, &str, &str)] = &[
    ("openai", "OpenAI", "OPENAI_API_KEY"),
    ("anthropic", "Anthropic", "ANTHROPIC_API_KEY"),
    ("google", "Google", "GEMINI_API_KEY"),
    ("groq", "Groq", "GROQ_API_KEY"),
    ("openrouter", "OpenRouter", "OPENROUTER_API_KEY"),
    ("xai", "xAI", "XAI_API_KEY"),
];

pub fn scan_providers() -> Vec<ProviderAsset> {
    KNOWN_PROVIDERS
        .iter()
        .map(|(id, name, env_var)| ProviderAsset {
            id: (*id).to_string(),
            name: (*name).to_string(),
            env_var: (*env_var).to_string(),
            health: match std::env::var(env_var) {
                Ok(value) if !value.trim().is_empty() => AssetHealth::Ready,
                _ => AssetHealth::NeedsSetup,
            },
        })
        .collect()
}

/// MCP servers, which only Quiver can currently reconcile across harnesses.
///
/// Artemis has no native MCP scan: the registration lives in each harness's own
/// config, in its own format, and `swe mcp discover --json` already reads all of
/// them and reports which harnesses each server appears in. That needs a
/// subprocess, so it is off unless the user turns it on, and a failure of any
/// kind means an empty list rather than an error — this is enrichment nobody
/// asked to depend on.
pub fn scan_mcp_servers() -> Vec<McpServerAsset> {
    if !settings::read().quiver_cli_enabled.unwrap_or(false) {
        return Vec::new();
    }
    quiver::mcp_servers_via("swe", 20)
}

pub fn harnesses(include_versions: bool, include_workspace_mentions: bool) -> Vec<HarnessAsset> {
    let current = settings::read();
    let scanned = scan_harnesses(&ScanOptions {
        workspace_root: settings::scan_root(&current),
        include_versions,
        include_workspace_mentions,
    });
    let mut harnesses = settings::apply_to_harnesses(scanned, &current);
    // Layered after the scan and after settings, so neither the probe's ground
    // truth nor an explicit user override can be displaced by a curated file.
    quiver::enrich_harnesses(&quiver::config_root(), &mut harnesses);
    harnesses
}

pub fn snapshot() -> AssetInventorySnapshot {
    AssetInventorySnapshot {
        captured_at: chrono::Utc::now().to_rfc3339(),
        harnesses: harnesses(true, true),
        skills: scan_skills(),
        mcp_servers: scan_mcp_servers(),
        providers: scan_providers(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Times a real scan against the machine it runs on. Ignored by default —
    /// it touches the filesystem and spawns `--version` probes, so the number
    /// is environment-specific and meaningless in CI.
    ///
    /// Run with:
    ///   cargo test -- --ignored --nocapture inventory_scan_timing
    #[test]
    #[ignore]
    fn inventory_scan_timing() {
        let started = std::time::Instant::now();
        let snapshot = snapshot();
        let elapsed = started.elapsed();

        println!(
            "snapshot in {:?} — {} harnesses ({} ready), {} skills, {} providers",
            elapsed,
            snapshot.harnesses.len(),
            snapshot
                .harnesses
                .iter()
                .filter(|h| h.health == AssetHealth::Ready)
                .count(),
            snapshot.skills.len(),
            snapshot.providers.len()
        );
    }
}
