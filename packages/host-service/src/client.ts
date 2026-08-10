import type {
  AgentRuntime,
  AgentLaunchRequest,
  AgentLaunchResult,
  AgentSessionSummary,
  AssetCatalog,
  AssetInventorySnapshot,
  ChatRuntime,
  ChatSession,
  RuntimeEvent,
  ProjectRef,
  ReviewRuntime,
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
    ReviewRuntime {}

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
 * Streaming chat is owned by the Rust host (M1). This reference host cannot
 * stream, so it reports chat as unavailable rather than shipping a second,
 * divergent implementation.
 */
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

    launchAgent(request: AgentLaunchRequest): Promise<AgentLaunchResult> {
      return postJson(`${basePath}/launch`, request);
    },

    createChatSession(): Promise<ChatSession> {
      return Promise.reject(new Error(CHAT_UNSUPPORTED));
    },

    streamChatMessage(): Promise<void> {
      return Promise.reject(new Error(CHAT_UNSUPPORTED));
    },

    cancelChatTurn(): Promise<void> {
      return Promise.resolve();
    },

    replayChatSession(): Promise<RuntimeEvent[]> {
      return Promise.resolve([]);
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
