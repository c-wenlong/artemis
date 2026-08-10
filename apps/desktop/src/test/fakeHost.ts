import type {
  AgentLaunchRequest,
  AgentLaunchResult,
  AgentSessionSummary,
  AssetInventorySnapshot,
  ChatSession,
  ChatTurnResult,
  CreateChatSessionRequest,
  ProjectRef,
  ReviewSnapshot,
  RuntimeSettings,
  SendChatMessageRequest,
  WorkspaceSummary
} from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";

export const fakeProjects: ProjectRef[] = [
  {
    id: "artemis",
    name: "artemis",
    rootPath: "/work/artemis",
    mainBranch: "main"
  },
  {
    id: "quiver",
    name: "quiver",
    rootPath: "/work/quiver",
    mainBranch: "main"
  }
];

export const fakeWorkspaces: WorkspaceSummary[] = [
  {
    id: "ws-artemis",
    projectId: "artemis",
    name: "artemis",
    branch: "m2-design-system",
    worktreePath: "/work/artemis",
    status: "ready",
    activeSessionIds: [],
    changedFileCount: 4,
    lastActivityAt: "2026-08-10T12:00:00.000Z"
  },
  {
    id: "ws-quiver",
    projectId: "quiver",
    name: "quiver",
    branch: "not a git repository",
    worktreePath: "/work/quiver",
    status: "needs-attention",
    activeSessionIds: [],
    changedFileCount: 0,
    lastActivityAt: "2026-08-10T11:00:00.000Z"
  }
];

export const fakeInventory: AssetInventorySnapshot = {
  capturedAt: "2026-08-10T12:00:00.000Z",
  harnesses: [
    {
      id: "opencode",
      kind: "opencode",
      label: "OpenCode",
      command: "opencode",
      version: "1.17.11",
      aliases: ["oc"],
      health: "ready",
      source: "path",
      executablePath: "/usr/local/bin/opencode"
    },
    {
      id: "claude",
      kind: "claude",
      label: "Claude Code",
      command: "claude",
      version: "2.1.220",
      aliases: ["cc"],
      health: "ready",
      source: "path",
      executablePath: "/opt/homebrew/bin/claude"
    },
    {
      id: "aider",
      kind: "custom",
      label: "Aider",
      command: "aider",
      aliases: [],
      health: "missing",
      source: "quiver-catalog"
    }
  ],
  skills: [
    {
      id: "shared:implement",
      name: "implement",
      path: "/home/user/.agents/skills/implement",
      scope: "shared",
      health: "ready"
    }
  ],
  mcpServers: [],
  providers: [
    { id: "anthropic", name: "Anthropic", envVar: "ANTHROPIC_API_KEY", health: "ready" }
  ]
};

export const fakeReview: ReviewSnapshot = {
  workspaceId: "ws-artemis",
  baseBranch: "main",
  files: [
    { path: "src/tokens.css", kind: "added", additions: 120, deletions: 0 },
    { path: "src/App.tsx", kind: "modified", additions: 40, deletions: 96 }
  ],
  artifactPaths: []
};

export const fakeSessions: AgentSessionSummary[] = [];

export interface FakeHostOptions {
  settings?: RuntimeSettings;
  workspaces?: WorkspaceSummary[];
  review?: ReviewSnapshot;
}

/**
 * In-memory host for component tests. Mirrors `ArtemisHostClient` exactly so a
 * contract change surfaces here rather than only at runtime.
 */
export function createFakeHost(options: FakeHostOptions = {}): ArtemisHostClient & {
  savedSettings: RuntimeSettings[];
  launches: AgentLaunchRequest[];
} {
  let settings: RuntimeSettings = options.settings ?? {
    opencodeDefaultModel: "anthropic/claude-opus-5"
  };
  const savedSettings: RuntimeSettings[] = [];
  const launches: AgentLaunchRequest[] = [];
  const workspaces = options.workspaces ?? fakeWorkspaces;

  return {
    savedSettings,
    launches,

    getSnapshot: async (): Promise<AssetInventorySnapshot> => fakeInventory,
    listProjects: async (): Promise<ProjectRef[]> => fakeProjects,
    listWorkspaces: async (projectId?: string): Promise<WorkspaceSummary[]> =>
      projectId
        ? workspaces.filter((workspace) => workspace.projectId === projectId)
        : workspaces,
    listSessions: async (): Promise<AgentSessionSummary[]> => fakeSessions,
    getReviewSnapshot: async (workspaceId: string): Promise<ReviewSnapshot> => ({
      ...(options.review ?? fakeReview),
      workspaceId
    }),
    getRuntimeSettings: async (): Promise<RuntimeSettings> => settings,
    updateRuntimeSettings: async (next: RuntimeSettings): Promise<RuntimeSettings> => {
      settings = next;
      savedSettings.push(next);
      return next;
    },
    launchAgent: async (request: AgentLaunchRequest): Promise<AgentLaunchResult> => {
      launches.push(request);
      return {
        args: [],
        command: request.harnessId,
        completedAt: "2026-08-10T12:00:01.000Z",
        cwd: request.workspacePath,
        ok: true,
        startedAt: "2026-08-10T12:00:00.000Z",
        stderr: "",
        stdout: "done"
      };
    },
    createChatSession: async (request: CreateChatSessionRequest): Promise<ChatSession> => ({
      createdAt: "2026-08-10T12:00:00.000Z",
      harnessId: request.harnessId,
      id: "chat-1",
      lastEventAt: "2026-08-10T12:00:00.000Z",
      status: "idle",
      title: "Test chat",
      workspaceId: request.workspaceId,
      workspacePath: request.workspacePath
    }),
    sendChatMessage: async (
      sessionId: string,
      request: SendChatMessageRequest
    ): Promise<ChatTurnResult> => ({
      events: [],
      messages: [
        {
          blocks: [
            { id: "b1", status: "completed", text: request.prompt, type: "text" }
          ],
          createdAt: "2026-08-10T12:00:00.000Z",
          id: "m1",
          role: "user",
          sessionId,
          turnId: "t1"
        }
      ],
      session: {
        createdAt: "2026-08-10T12:00:00.000Z",
        harnessId: "opencode",
        id: sessionId,
        lastEventAt: "2026-08-10T12:00:00.000Z",
        status: "idle",
        title: "Test chat",
        workspaceId: "ws-artemis",
        workspacePath: "/work/artemis"
      }
    })
  };
}
