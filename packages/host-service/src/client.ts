import type {
  AgentRuntime,
  AppIcon,
  AgentLaunchRequest,
  AgentLaunchResult,
  AgentSessionSummary,
  AssetCatalog,
  AssetInventorySnapshot,
  ChatRuntime,
  ChatSession,
  CreateChatSessionRequest,
  RuntimeEvent,
  ProjectRef,
  LaunchPreset,
  ReviewRuntime,
  TerminalRuntime,
  TerminalSession,
  ReviewSnapshot,
  RuntimeSettings,
  RuntimeSettingsRuntime,
  WorkspaceRuntime,
  WorkspaceSummary
} from "@artemis/core";

export interface ArtemisHostClient
  extends AssetCatalog,
    WorkspaceRuntime,
    AgentRuntime,
    ChatRuntime,
    RuntimeSettingsRuntime,
    ReviewRuntime,
    TerminalRuntime {}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Artemis host request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Artemis host request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Mirrors `session_id_for_workspace` in the Rust host. Session identity is
 * deterministic and shared, which is why browser mode can resolve a session and
 * replay its log even though it cannot stream a new turn.
 */
function sessionIdForWorkspace(workspaceId: string): string {
  return `chat-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * Streaming is owned by the Rust host (M1). This reference host cannot stream,
 * so it says so rather than shipping a second, divergent implementation.
 */
const WORKTREES_UNSUPPORTED =
  "Creating and deleting worktrees requires the Tauri host.";

/** Terminals are PTYs owned by the Rust host; there is no browser equivalent. */
const TERMINALS_UNSUPPORTED =
  "Terminals require the Tauri host. Run `pnpm dev` instead of `pnpm dev:web`.";

/** The dock icon belongs to the native app, which browser mode is not. */
const ICONS_UNSUPPORTED = "Changing the app icon requires the Tauri host.";

const CHAT_UNSUPPORTED =
  "Streaming chat requires the Tauri host. Run `pnpm dev` instead of `pnpm dev:web`.";

export function createHttpHostClient(basePath = "/api/artemis"): ArtemisHostClient {
  return {
    getSnapshot(): Promise<AssetInventorySnapshot> {
      return getJson(`${basePath}/snapshot`);
    },

    listProjects(): Promise<ProjectRef[]> {
      return getJson(`${basePath}/projects`);
    },

    listWorkspaces(projectId?: string): Promise<WorkspaceSummary[]> {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return getJson(`${basePath}/workspaces${query}`);
    },

    listSessions(workspaceId?: string): Promise<AgentSessionSummary[]> {
      const query = workspaceId
        ? `?workspaceId=${encodeURIComponent(workspaceId)}`
        : "";
      return getJson(`${basePath}/sessions${query}`);
    },

    listAppIcons(): Promise<AppIcon[]> {
      return Promise.resolve([]);
    },

    setAppIcon(): Promise<void> {
      return Promise.reject(new Error(ICONS_UNSUPPORTED));
    },

    getLaunchPreset(): Promise<LaunchPreset | null> {
      return Promise.resolve(null);
    },

    saveLaunchPreset(): Promise<void> {
      return Promise.resolve();
    },

    openTerminal(): Promise<TerminalSession> {
      return Promise.reject(new Error(TERMINALS_UNSUPPORTED));
    },

    listTerminals(): Promise<TerminalSession[]> {
      return Promise.resolve([]);
    },

    subscribeTerminal(): Promise<string> {
      return Promise.resolve("");
    },

    unsubscribeTerminal(): Promise<void> {
      return Promise.resolve();
    },

    writeTerminal(): Promise<void> {
      return Promise.reject(new Error(TERMINALS_UNSUPPORTED));
    },

    resizeTerminal(): Promise<void> {
      return Promise.resolve();
    },

    closeTerminal(): Promise<void> {
      return Promise.resolve();
    },

    createWorkspace(): Promise<WorkspaceSummary> {
      return Promise.reject(new Error(WORKTREES_UNSUPPORTED));
    },

    deleteWorkspace(): Promise<void> {
      return Promise.reject(new Error(WORKTREES_UNSUPPORTED));
    },

    launchAgent(request: AgentLaunchRequest): Promise<AgentLaunchResult> {
      return postJson(`${basePath}/launch`, request);
    },

    createChatSession(request: CreateChatSessionRequest): Promise<ChatSession> {
      const now = new Date().toISOString();
      const session: ChatSession = {
        createdAt: now,
        harnessId: request.harnessId,
        id: sessionIdForWorkspace(request.workspaceId),
        lastEventAt: now,
        status: "idle",
        title: request.title ?? "OpenCode session",
        workspaceId: request.workspaceId,
        workspacePath: request.workspacePath
      };
      return Promise.resolve(session);
    },

    streamChatMessage(): Promise<void> {
      return Promise.reject(new Error(CHAT_UNSUPPORTED));
    },

    cancelChatTurn(): Promise<void> {
      return Promise.resolve();
    },

    /**
     * Reads a log the Rust host recorded. Streaming still requires Tauri, but
     * a finished turn can be rendered here — which is what makes the browser
     * preview usable for looking at the transcript.
     */
    replayChatSession(sessionId: string): Promise<RuntimeEvent[]> {
      return getJson<RuntimeEvent[]>(
        `${basePath}/chat/replay?sessionId=${encodeURIComponent(sessionId)}`
      ).catch(() => []);
    },

    getRuntimeSettings(): Promise<RuntimeSettings> {
      return getJson(`${basePath}/settings`);
    },

    updateRuntimeSettings(settings: RuntimeSettings): Promise<RuntimeSettings> {
      return postJson(`${basePath}/settings`, settings);
    },

    getReviewSnapshot(workspaceId: string): Promise<ReviewSnapshot> {
      return getJson(
        `${basePath}/review?workspaceId=${encodeURIComponent(workspaceId)}`
      );
    }
  };
}
