import type {
  AgentLaunchRequest,
  AppIcon,
  AgentLaunchResult,
  AgentSessionSummary,
  AssetInventorySnapshot,
  ChatEventListener,
  ChatSession,
  Comparison,
  FileWindow,
  CreateChatSessionRequest,
  LaunchPreset,
  RuntimeEvent,
  ProjectRef,
  ReviewSnapshot,
  RuntimeSettings,
  SendChatMessageRequest,
  TerminalSession,
  TerminalSpec,
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
      executablePath: "/usr/local/bin/opencode",
      supportsStreaming: true
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
      executablePath: "/opt/homebrew/bin/claude",
      supportsStreaming: true
    },
    {
      // Installed and perfectly usable, but Artemis has no adapter for its
      // output — the realistic dock case, and the common one.
      id: "amp",
      kind: "amp",
      label: "Amp",
      command: "amp",
      version: "0.0.1",
      aliases: [],
      health: "ready",
      source: "path",
      executablePath: "/usr/local/bin/amp",
      supportsStreaming: false
    },
    {
      id: "aider",
      kind: "custom",
      label: "Aider",
      command: "aider",
      aliases: [],
      health: "missing",
      source: "quiver-catalog",
      // No adapter: Artemis cannot parse it, so it belongs in the dock.
      supportsStreaming: false
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
  /** Message the host refuses to start a comparison with. */
  comparisonError?: string;
  /** Per-harness setup failures, keyed by harness id. */
  comparisonEntryErrors?: Record<string, string>;
  /** Override the whole inventory, e.g. to model an older host. */
  inventory?: AssetInventorySnapshot;
  settings?: RuntimeSettings;
  workspaces?: WorkspaceSummary[];
  review?: ReviewSnapshot;
  /** Batches the host should emit for a turn. */
  streamScript?(turnId: string, prompt: string): RuntimeEvent[][];
  /** Events a reopened session replays. */
  replay?: RuntimeEvent[];
  projects?: ProjectRef[];
  /** Presets the host has stored, keyed by workspace id. */
  presets?: Record<string, { harnessId: string; model: string | null }>;
  /** Terminals the host already has, as after a reload. */
  existingTerminals?: TerminalSession[];
  /** Message the host refuses to open a terminal with. */
  terminalError?: string;
  /** Holds worktree creation open so a test can observe the progress state. */
  holdWorktreeCreate?: boolean;
  /** Message the host rejects worktree creation with. */
  worktreeError?: string;
  /**
   * Keep the turn open until it is cancelled — models a long-running turn, so
   * a test can click Stop without racing the stream to completion.
   */
  holdUntilCancelled?: boolean;
}

/**
 * In-memory host for component tests. Mirrors `ArtemisHostClient` exactly so a
 * contract change surfaces here rather than only at runtime.
 */
export function createFakeHost(options: FakeHostOptions = {}): ArtemisHostClient & {
  savedSettings: RuntimeSettings[];
  launches: AgentLaunchRequest[];
  streamed: string[];
  replayedIds: string[];
  created: Array<{ projectId: string; branch: string }>;
  deleted: Array<{ workspaceId: string; force: boolean }>;
  terminals: TerminalSpec[];
  closedTerminals: string[];
  savedPresets: Array<{ workspaceId: string; harnessId: string; model: string | null }>;
  appliedIcons: string[];
  forks: Array<{ sessionId: string; throughTurnId: string }>;
  reverted: Array<{ patch: string; relativePath: string; workspacePath: string }>;
  peeked: Array<{ line?: number; relativePath: string; workspacePath: string }>;
  comparisons: Array<{ harnessIds: string[]; projectId: string; prompt: string }>;
  resolved: Array<{ runId: string; winner: string }>;
  abandoned: string[];
} {
  let settings: RuntimeSettings = options.settings ?? {
    opencodeDefaultModel: "anthropic/claude-opus-5"
  };
  const savedSettings: RuntimeSettings[] = [];
  const launches: AgentLaunchRequest[] = [];
  const streamed: string[] = [];
  const cancelled = new Set<string>();
  const replayedIds: string[] = [];
  const created: Array<{ projectId: string; branch: string }> = [];
  const deleted: Array<{ workspaceId: string; force: boolean }> = [];
  const terminals: TerminalSpec[] = [];
  const closedTerminals: string[] = [];
  let sessions: TerminalSession[] = [...(options.existingTerminals ?? [])];
  const presets: Record<string, LaunchPreset> = { ...(options.presets ?? {}) };
  const savedPresets: Array<{
    workspaceId: string;
    harnessId: string;
    model: string | null;
  }> = [];
  const appliedIcons: string[] = [];
  const forks: Array<{ sessionId: string; throughTurnId: string }> = [];
  const reverted: Array<{
    patch: string;
    relativePath: string;
    workspacePath: string;
  }> = [];
  const peeked: Array<{
    line?: number;
    relativePath: string;
    workspacePath: string;
  }> = [];
  const comparisons: Array<{
    harnessIds: string[];
    projectId: string;
    prompt: string;
  }> = [];
  const resolved: Array<{ runId: string; winner: string }> = [];
  const abandoned: string[] = [];

  // Mirrors the Rust catalog in appicon.rs.
  const iconCatalog: AppIcon[] = [
    { id: "olympian-marble", label: "Olympian" },
    { id: "arcane-sentinel-obsidian", label: "Arcane Sentinel" },
    { id: "auroral-archer-frost", label: "Auroral Archer" },
    { id: "celestial-emissary-stained-glass", label: "Celestial Emissary" },
    { id: "chrome-sentinel-cybernetic", label: "Chrome Sentinel" },
    { id: "chronos-archer-clockwork", label: "Chronos Archer" },
    { id: "desert-nomad-sandstone", label: "Desert Nomad" },
    { id: "frost-weaver-ice", label: "Frost Weaver" },
    { id: "galactic-vanguard-nebula", label: "Galactic Vanguard" },
    { id: "solar-sentinel-sunstone", label: "Solar Sentinel" },
    { id: "verdant-druid-moss", label: "Verdant Druid" }
  ];
  const projects = options.projects ?? fakeProjects;
  // Mutable so create and delete are observable through listWorkspaces, the
  // way they are against the real host.
  let workspaces = [...(options.workspaces ?? fakeWorkspaces)];

  return {
    savedSettings,
    launches,
    streamed,
    replayedIds,
    created,
    deleted,
    terminals,
    closedTerminals,
    savedPresets,
    appliedIcons,
    forks,
    reverted,
    peeked,
    comparisons,
    resolved,
    abandoned,

    getSnapshot: async (): Promise<AssetInventorySnapshot> =>
      options.inventory ?? fakeInventory,
    listProjects: async (): Promise<ProjectRef[]> => projects,
    listWorkspaces: async (projectId?: string): Promise<WorkspaceSummary[]> =>
      projectId
        ? workspaces.filter((workspace) => workspace.projectId === projectId)
        : workspaces,
    listSessions: async (): Promise<AgentSessionSummary[]> => fakeSessions,

    createWorkspace: async (
      projectId: string,
      branch: string
    ): Promise<WorkspaceSummary> => {
      if (options.holdWorktreeCreate) {
        await new Promise(() => {});
      }
      if (options.worktreeError) throw new Error(options.worktreeError);

      created.push({ projectId, branch });
      const workspace: WorkspaceSummary = {
        id: `ws-${projectId}-${branch.replace(/[^a-zA-Z0-9-_]/g, "-")}`,
        projectId,
        name: branch,
        branch,
        worktreePath: `/worktrees/${projectId}/${branch}`,
        status: "ready",
        activeSessionIds: [],
        changedFileCount: 0,
        lastActivityAt: "2026-08-10T12:00:00.000Z"
      };
      workspaces = [...workspaces, workspace];
      return workspace;
    },

    deleteWorkspace: async (workspaceId: string, force: boolean): Promise<void> => {
      deleted.push({ workspaceId, force });
      workspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
    },
    getLaunchPreset: async (workspaceId: string): Promise<LaunchPreset | null> =>
      presets[workspaceId] ?? null,

    saveLaunchPreset: async (
      workspaceId: string,
      harnessId: string,
      model: string | null
    ): Promise<void> => {
      presets[workspaceId] = { harnessId, model };
      savedPresets.push({ workspaceId, harnessId, model });
    },

    getReviewSnapshot: async (workspaceId: string): Promise<ReviewSnapshot> => ({
      ...(options.review ?? fakeReview),
      workspaceId
    }),
    listAppIcons: async (): Promise<AppIcon[]> => iconCatalog,

    setAppIcon: async (iconId: string): Promise<void> => {
      appliedIcons.push(iconId);
      settings = { ...settings, appIconId: iconId };
    },

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
    openTerminal: async (spec: TerminalSpec): Promise<TerminalSession> => {
      if (options.terminalError) throw new Error(options.terminalError);
      terminals.push(spec);
      const session: TerminalSession = {
        id: `term-${terminals.length}`,
        title: spec.title,
        command: spec.command,
        cwd: spec.cwd,
        isRunning: true,
        startedAt: "2026-08-10T12:00:00.000Z"
      };
      sessions = [...sessions, session];
      return session;
    },

    listTerminals: async (): Promise<TerminalSession[]> => sessions,
    subscribeTerminal: async (): Promise<string> => "",
    unsubscribeTerminal: async (): Promise<void> => {},
    writeTerminal: async (): Promise<void> => {},
    resizeTerminal: async (): Promise<void> => {},
    closeTerminal: async (terminalId: string): Promise<void> => {
      closedTerminals.push(terminalId);
      sessions = sessions.filter((session) => session.id !== terminalId);
    },

    createChatSession: async (request: CreateChatSessionRequest): Promise<ChatSession> => ({
      createdAt: "2026-08-10T12:00:00.000Z",
      harnessId: request.harnessId,
      // Mirrors `session_id_for_workspace` in the Rust host. Deterministic on
      // purpose: the event log is keyed by this, so a fake that invented an id
      // would hide a replay-key mismatch.
      id: `chat-${request.workspaceId}`,
      lastEventAt: "2026-08-10T12:00:00.000Z",
      status: "idle",
      title: "Test chat",
      workspaceId: request.workspaceId,
      workspacePath: request.workspacePath
    }),

    /**
     * Streams a scripted turn. `streamScript` lets a test drive the exact
     * batches the host would send; the default is a short successful turn.
     */
    streamChatMessage: async (
      sessionId: string,
      request: SendChatMessageRequest,
      onEvents: ChatEventListener
    ): Promise<void> => {
      streamed.push(request.prompt);
      const turnId = `turn-${streamed.length}`;
      const batches =
        options.streamScript?.(turnId, request.prompt) ??
        defaultScript(turnId, sessionId, request.prompt);

      for (const batch of batches) {
        if (cancelled.has(sessionId)) break;
        onEvents(batch);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (options.holdUntilCancelled) {
        while (!cancelled.has(sessionId)) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }

      if (cancelled.has(sessionId)) {
        cancelled.delete(sessionId);
        onEvents([
          {
            id: `${turnId}-cancelled`,
            sessionId,
            timestamp: "2026-08-10T12:00:03.000Z",
            turnId,
            message: "Turn stopped.",
            type: "turn.errored"
          }
        ]);
      }
    },

    cancelChatTurn: async (sessionId: string): Promise<void> => {
      cancelled.add(sessionId);
    },

    revertFileChange: async (
      workspacePath: string,
      relativePath: string,
      patch: string
    ): Promise<void> => {
      reverted.push({ patch, relativePath, workspacePath });
    },

    /** A synthetic forty-line file, windowed the way the host does it. */
    peekFile: async (
      workspacePath: string,
      relativePath: string,
      line?: number
    ): Promise<FileWindow> => {
      peeked.push({ line, relativePath, workspacePath });
      const totalLines = 40;
      const cited = line !== undefined && line >= 1 && line <= totalLines ? line : null;
      const anchor = cited ?? (line === undefined ? 1 : totalLines);
      const startLine = Math.max(1, anchor - 3);
      const endLine = Math.min(totalLines, anchor + 3);
      return {
        focusLine: cited,
        lines: Array.from(
          { length: endLine - startLine + 1 },
          (_, index) => `line ${startLine + index}`
        ),
        path: relativePath,
        startLine,
        totalLines
      };
    },

    /** Mirrors the host: one worktree per harness, branched from head. */
    startComparison: async (
      projectId: string,
      prompt: string,
      harnessIds: string[]
    ): Promise<Comparison> => {
      comparisons.push({ harnessIds, projectId, prompt });
      if (options.comparisonError) throw new Error(options.comparisonError);
      const unique = [...new Set(harnessIds)];
      return {
        entries: unique.map((harnessId) => ({
          branch: `compare/run/${harnessId}`,
          error: options.comparisonEntryErrors?.[harnessId],
          harnessId,
          path: options.comparisonEntryErrors?.[harnessId]
            ? undefined
            : `/work/worktrees/${harnessId}`,
          workspaceId: `cmp-run-${harnessId}`
        })),
        id: "cmp-run",
        projectId,
        prompt
      };
    },

    resolveComparison: async (
      run: Comparison,
      winnerWorkspaceId: string
    ): Promise<void> => {
      if (!run.entries.some((entry) => entry.workspaceId === winnerWorkspaceId)) {
        throw new Error("That run is not part of this comparison.");
      }
      resolved.push({ runId: run.id, winner: winnerWorkspaceId });
    },

    abandonComparison: async (run: Comparison): Promise<void> => {
      abandoned.push(run.id);
    },

    forkChatSession: async (
      sessionId: string,
      throughTurnId: string
    ): Promise<ChatSession> => {
      forks.push({ sessionId, throughTurnId });
      return {
        createdAt: "2026-08-11T09:40:00.000Z",
        harnessId: "opencode",
        id: `${sessionId}-fork-${forks.length}`,
        lastEventAt: "2026-08-11T09:40:00.000Z",
        status: "idle",
        title: "Fork of Test chat",
        workspaceId: "ws-artemis",
        workspacePath: "/work/artemis"
      };
    },

    replayChatSession: async (sessionId: string): Promise<RuntimeEvent[]> => {
      replayedIds.push(sessionId);
      const recorded = options.replay ?? [];
      // Only the session those events belong to replays them.
      return recorded.length > 0 && recorded[0]!.sessionId === sessionId ? recorded : [];
    }
  };
}

function defaultScript(
  turnId: string,
  sessionId: string,
  prompt: string
): RuntimeEvent[][] {
  const at = (n: number) => `2026-08-10T12:00:0${n}.000Z`;
  return [
    [
      {
        id: `${turnId}-started`,
        sessionId,
        timestamp: at(0),
        turnId,
        harnessId: "opencode",
        workspaceId: "ws-artemis",
        type: "turn.started"
      },
      {
        id: `${turnId}-user`,
        sessionId,
        timestamp: at(0),
        turnId,
        text: prompt,
        type: "user.message"
      }
    ],
    [
      {
        id: `${turnId}-d1`,
        sessionId,
        timestamp: at(1),
        turnId,
        blockId: "b1",
        text: "Reading ",
        type: "text.delta"
      }
    ],
    [
      {
        id: `${turnId}-d2`,
        sessionId,
        timestamp: at(2),
        turnId,
        blockId: "b1",
        text: "the scanner.",
        type: "text.delta"
      }
    ],
    [
      {
        id: `${turnId}-done`,
        sessionId,
        timestamp: at(3),
        turnId,
        opencodeSessionId: "ses_fake",
        type: "turn.completed"
      }
    ]
  ];
}
