import type {
  AgentSessionSummary,
  AssetInventorySnapshot,
  ChangedFile,
  ProjectRef,
  ReviewSnapshot,
  WorkspaceSummary
} from "@artemis/core";

const now = new Date("2026-07-08T16:30:00.000Z").toISOString();

export const seedInventory: AssetInventorySnapshot = {
  capturedAt: now,
  harnesses: [
    {
      id: "codex",
      kind: "codex",
      label: "Codex CLI",
      command: "codex",
      version: "detected",
      aliases: ["cx"],
      health: "ready",
      source: "seed",
      lastUsedAt: "2026-07-08T15:52:00.000Z"
    },
    {
      id: "claude",
      kind: "claude",
      label: "Claude Code",
      command: "claude",
      version: "detected",
      aliases: ["cc"],
      health: "ready",
      source: "seed",
      lastUsedAt: "2026-07-08T15:30:00.000Z"
    },
    {
      id: "gemini",
      kind: "gemini",
      label: "Gemini CLI",
      command: "gemini",
      aliases: ["gg"],
      health: "needs-setup",
      source: "seed"
    }
  ],
  skills: [
    {
      id: "implement",
      name: "implement",
      path: "~/.agents/skills/mp-implement",
      scope: "shared",
      health: "ready"
    },
    {
      id: "code-review",
      name: "implementation-reviewer",
      path: "~/.claude/skills/implementation-reviewer",
      scope: "claude",
      health: "ready"
    },
    {
      id: "pane-orchestrator",
      name: "pane-orchestrator",
      path: ".codex/skills/pane-orchestrator",
      scope: "project",
      health: "unknown"
    }
  ],
  mcpServers: [
    {
      id: "github",
      name: "GitHub",
      ownerTool: "codex",
      transport: "stdio",
      health: "ready"
    },
    {
      id: "linear",
      name: "Linear",
      ownerTool: "claude",
      transport: "stdio",
      health: "missing"
    }
  ],
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      envVar: "OPENAI_API_KEY",
      health: "ready"
    },
    {
      id: "anthropic",
      name: "Anthropic",
      envVar: "ANTHROPIC_API_KEY",
      health: "needs-setup"
    }
  ]
};

export const seedProjects: ProjectRef[] = [
  {
    id: "ai-engineering",
    name: "AI Engineering",
    rootPath: "/Users/example/Desktop/Personal/Internal/Projects/ai-engineering",
    mainBranch: "main"
  }
];

export const seedWorkspaces: WorkspaceSummary[] = [
  {
    id: "ws-current-checkout",
    projectId: "ai-engineering",
    name: "Current checkout",
    branch: "main",
    worktreePath: "/Users/example/Desktop/Personal/Internal/Projects/ai-engineering",
    status: "ready",
    activeSessionIds: [],
    changedFileCount: 0,
    lastActivityAt: now
  }
];

export const seedSessions: AgentSessionSummary[] = [];

export const seedChangedFiles: ChangedFile[] = [
  {
    path: "apps/desktop/src/App.tsx",
    kind: "modified",
    additions: 188,
    deletions: 12
  },
  {
    path: "packages/core/src/catalog/types.ts",
    kind: "added",
    additions: 59,
    deletions: 0
  },
  {
    path: "packages/host-service/src/index.ts",
    kind: "added",
    additions: 48,
    deletions: 0
  }
];

export function reviewSnapshotFor(workspaceId: string): ReviewSnapshot {
  return {
    workspaceId,
    baseBranch: "main",
    files: seedChangedFiles,
    artifactPaths: ["orchestrators/artemis/apps/desktop/dist/index.html"]
  };
}
