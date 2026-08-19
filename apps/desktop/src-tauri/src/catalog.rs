//! Known harness definitions.
//!
//! Seeded from Quiver's default + extended harness catalog, trimmed to the
//! coding-agent harnesses Artemis should care about first. See
//! `docs/QUIVER_INTEGRATION.md`: the long-term plan is to layer Quiver's
//! registry over this table rather than replace it.

use crate::types::HarnessKind;

pub struct KnownHarness {
    pub id: &'static str,
    pub kind: HarnessKind,
    pub label: &'static str,
    pub command: &'static str,
    pub description: &'static str,
    pub aliases: &'static [&'static str],
    pub version_args: &'static [&'static str],
}

pub const KNOWN_HARNESSES: &[KnownHarness] = &[
    KnownHarness {
        id: "pi",
        kind: HarnessKind::Pi,
        label: "Pi Coding Agent",
        command: "pi",
        description: "Local Pi coding agent",
        aliases: &["local-pi"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "claude",
        kind: HarnessKind::Claude,
        label: "Claude Code",
        command: "claude",
        description: "Claude Code by Anthropic",
        aliases: &["cc"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "codex",
        kind: HarnessKind::Codex,
        label: "Codex CLI",
        command: "codex",
        description: "OpenAI Codex CLI",
        aliases: &["cx"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "gemini",
        kind: HarnessKind::Gemini,
        label: "Gemini CLI",
        command: "gemini",
        description: "Gemini CLI by Google",
        aliases: &["gg"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "cursor",
        kind: HarnessKind::Cursor,
        label: "Cursor Agent",
        command: "cursor-agent",
        description: "Cursor CLI coding agent",
        aliases: &["cs", "cursor", "agent"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "opencode",
        kind: HarnessKind::Opencode,
        label: "OpenCode",
        command: "opencode",
        description: "Open source AI coding agent",
        aliases: &["oc"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "copilot",
        kind: HarnessKind::Copilot,
        label: "GitHub Copilot CLI",
        command: "copilot",
        description: "GitHub Copilot CLI",
        aliases: &["cp"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "amp",
        kind: HarnessKind::Amp,
        label: "Amp",
        command: "amp",
        description: "Amp agentic coding assistant",
        aliases: &["ap"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "droid",
        kind: HarnessKind::Droid,
        label: "Factory Droid",
        command: "droid",
        description: "Factory Droids autonomous coding agent",
        aliases: &["df"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "aider",
        kind: HarnessKind::Custom,
        label: "Aider",
        command: "aider",
        description: "Aider pair-programming CLI",
        aliases: &[],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "swe",
        kind: HarnessKind::Local,
        label: "Quiver",
        command: "swe",
        description: "Quiver harness/session manager",
        aliases: &["quiver"],
        version_args: &["--version"],
    },
    KnownHarness {
        id: "runpane",
        kind: HarnessKind::Custom,
        label: "RunPane",
        command: "runpane",
        description: "Pane local orchestration CLI",
        aliases: &["pane"],
        version_args: &["version"],
    },
];

pub fn harness_by_token(token: &str) -> Option<&'static KnownHarness> {
    let normalized = token.to_lowercase();
    KNOWN_HARNESSES.iter().find(|harness| {
        harness.id == normalized
            || harness.command == normalized
            || harness.aliases.contains(&normalized.as_str())
    })
}
