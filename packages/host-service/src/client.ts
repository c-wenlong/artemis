import type {
  AgentRuntime,
  AgentLaunchRequest,
  AgentLaunchResult,
  AgentSessionSummary,
  AssetCatalog,
  AssetInventorySnapshot,
  ChatRuntime,
  ChatSession,
  ChatTurnResult,
  CreateChatSessionRequest,
  ProjectRef,
  ReviewRuntime,
  ReviewSnapshot,
  SendChatMessageRequest,
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

    createChatSession(request: CreateChatSessionRequest): Promise<ChatSession> {
      return postJson(`${basePath}/chat/sessions`, request);
    },

    sendChatMessage(
      sessionId: string,
      request: SendChatMessageRequest
    ): Promise<ChatTurnResult> {
      return postJson(
        `${basePath}/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        request
      );
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
