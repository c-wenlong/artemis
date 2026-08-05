export type AssetHealth = "ready" | "missing" | "needs-setup" | "unknown";

export type HarnessKind =
  | "pi"
  | "amp"
  | "claude"
  | "codex"
  | "gemini"
  | "cursor"
  | "opencode"
  | "copilot"
  | "droid"
  | "local"
  | "custom";

export type HarnessDiscoverySource =
  | "path"
  | "settings"
  | "workspace-config"
  | "quiver-catalog"
  | "seed";

export interface HarnessAsset {
  id: string;
  kind: HarnessKind;
  label: string;
  command: string;
  version?: string;
  aliases: string[];
  health: AssetHealth;
  source: HarnessDiscoverySource;
  executablePath?: string;
  description?: string;
  workspaceMentions?: string[];
  lastUsedAt?: string;
}

export interface SkillAsset {
  id: string;
  name: string;
  path: string;
  scope: "shared" | "claude" | "codex" | "cursor" | "project";
  health: AssetHealth;
}

export interface McpServerAsset {
  id: string;
  name: string;
  ownerTool: string;
  transport: "stdio" | "http" | "sse";
  health: AssetHealth;
}

export interface ProviderAsset {
  id: string;
  name: string;
  envVar: string;
  health: AssetHealth;
}

export interface AssetInventorySnapshot {
  capturedAt: string;
  harnesses: HarnessAsset[];
  skills: SkillAsset[];
  mcpServers: McpServerAsset[];
  providers: ProviderAsset[];
}

export interface AssetCatalog {
  getSnapshot(): Promise<AssetInventorySnapshot>;
}
