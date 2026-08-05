import type { HarnessKind } from "@artemis/core";

export interface KnownHarnessDefinition {
  id: string;
  kind: HarnessKind;
  label: string;
  command: string;
  description: string;
  aliases: string[];
  versionArgs: string[];
}

// Seeded from Quiver's default + extended harness catalog, then trimmed to the
// coding-agent harnesses Artemis should care about first.
export const knownHarnesses: KnownHarnessDefinition[] = [
  {
    id: "pi",
    kind: "pi",
    label: "Pi Coding Agent",
    command: "pi",
    description: "Local Pi coding agent",
    aliases: ["local-pi"],
    versionArgs: ["--version"]
  },
  {
    id: "claude",
    kind: "claude",
    label: "Claude Code",
    command: "claude",
    description: "Claude Code by Anthropic",
    aliases: ["cc"],
    versionArgs: ["--version"]
  },
  {
    id: "codex",
    kind: "codex",
    label: "Codex CLI",
    command: "codex",
    description: "OpenAI Codex CLI",
    aliases: ["cx"],
    versionArgs: ["--version"]
  },
  {
    id: "gemini",
    kind: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    description: "Gemini CLI by Google",
    aliases: ["gg"],
    versionArgs: ["--version"]
  },
  {
    id: "cursor",
    kind: "cursor",
    label: "Cursor Agent",
    command: "cursor-agent",
    description: "Cursor CLI coding agent",
    aliases: ["cs", "cursor", "agent"],
    versionArgs: ["--version"]
  },
  {
    id: "opencode",
    kind: "opencode",
    label: "OpenCode",
    command: "opencode",
    description: "Open source AI coding agent",
    aliases: ["oc"],
    versionArgs: ["--version"]
  },
  {
    id: "copilot",
    kind: "copilot",
    label: "GitHub Copilot CLI",
    command: "copilot",
    description: "GitHub Copilot CLI",
    aliases: ["cp"],
    versionArgs: ["--version"]
  },
  {
    id: "amp",
    kind: "amp",
    label: "Amp",
    command: "amp",
    description: "Amp agentic coding assistant",
    aliases: ["ap"],
    versionArgs: ["--version"]
  },
  {
    id: "droid",
    kind: "droid",
    label: "Factory Droid",
    command: "droid",
    description: "Factory Droids autonomous coding agent",
    aliases: ["df"],
    versionArgs: ["--version"]
  },
  {
    id: "aider",
    kind: "custom",
    label: "Aider",
    command: "aider",
    description: "Aider pair-programming CLI",
    aliases: [],
    versionArgs: ["--version"]
  },
  {
    id: "swe",
    kind: "local",
    label: "Quiver",
    command: "swe",
    description: "Quiver harness/session manager",
    aliases: ["quiver"],
    versionArgs: ["--version"]
  },
  {
    id: "runpane",
    kind: "custom",
    label: "RunPane",
    command: "runpane",
    description: "Pane local orchestration CLI",
    aliases: ["pane"],
    versionArgs: ["version"]
  }
];

export function harnessByToken(token: string): KnownHarnessDefinition | null {
  const normalized = token.toLowerCase();
  return (
    knownHarnesses.find(
      (harness) =>
        harness.id === normalized ||
        harness.command === normalized ||
        harness.aliases.includes(normalized)
    ) ?? null
  );
}
