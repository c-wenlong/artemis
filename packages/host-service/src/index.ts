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
  RuntimeSettings,
  RuntimeSettingsRuntime,
  SendChatMessageRequest,
  WorkspaceRuntime,
  WorkspaceSummary
} from "@artemis/core";
import {
  reviewSnapshotFor,
  seedInventory,
  seedProjects,
  seedSessions,
  seedWorkspaces
} from "./seed";

export interface ArtemisHostService
  extends AssetCatalog,
    WorkspaceRuntime,
    AgentRuntime,
    ChatRuntime,
    RuntimeSettingsRuntime,
    ReviewRuntime {}

export interface LocalHostServiceOptions {
  latencyMs?: number;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

export function createLocalHostService(
  options: LocalHostServiceOptions = {}
): ArtemisHostService {
  const latencyMs = options.latencyMs ?? 80;

  return {
    async getSnapshot(): Promise<AssetInventorySnapshot> {
      await wait(latencyMs);
      return seedInventory;
    },

    async listProjects(): Promise<ProjectRef[]> {
      await wait(latencyMs);
      return seedProjects;
    },

    async listWorkspaces(projectId?: string): Promise<WorkspaceSummary[]> {
      await wait(latencyMs);
      return projectId
        ? seedWorkspaces.filter((workspace) => workspace.projectId === projectId)
        : seedWorkspaces;
    },

    async listSessions(workspaceId?: string): Promise<AgentSessionSummary[]> {
      await wait(latencyMs);
      return workspaceId
        ? seedSessions.filter((session) => session.workspaceId === workspaceId)
        : seedSessions;
    },

    async launchAgent(request: AgentLaunchRequest): Promise<AgentLaunchResult> {
      await wait(latencyMs);
      const now = new Date().toISOString();
      return {
        args: [],
        command: request.harnessId,
        completedAt: now,
        cwd: request.workspacePath,
        error: "Local mock host cannot launch agents.",
        ok: false,
        startedAt: now,
        stderr: "",
        stdout: ""
      };
    },

    async createChatSession(request: CreateChatSessionRequest): Promise<ChatSession> {
      await wait(latencyMs);
      const now = new Date().toISOString();
      return {
        createdAt: now,
        harnessId: request.harnessId,
        id: "mock-chat",
        lastEventAt: now,
        model: request.model,
        startPath: request.startPath,
        status: "idle",
        title: request.title ?? "Mock chat",
        workspaceId: request.workspaceId,
        workspacePath: request.workspacePath
      };
    },

    async sendChatMessage(
      sessionId: string,
      request: SendChatMessageRequest
    ): Promise<ChatTurnResult> {
      await wait(latencyMs);
      const now = new Date().toISOString();
      return {
        events: [],
        messages: [
          {
            blocks: [
              {
                id: "mock-user-text",
                status: "completed",
                text: request.prompt,
                type: "text"
              }
            ],
            createdAt: now,
            id: "mock-user",
            role: "user",
            sessionId,
            turnId: "mock-turn"
          }
        ],
        session: {
          createdAt: now,
          harnessId: "opencode",
          id: sessionId,
          lastEventAt: now,
          status: "idle",
          title: "Mock chat",
          workspaceId: "mock-workspace",
          workspacePath: "."
        }
      };
    },

    async getRuntimeSettings(): Promise<RuntimeSettings> {
      await wait(latencyMs);
      return {};
    },

    async updateRuntimeSettings(settings: RuntimeSettings): Promise<RuntimeSettings> {
      await wait(latencyMs);
      return settings;
    },

    async getReviewSnapshot(workspaceId: string): Promise<ReviewSnapshot> {
      await wait(latencyMs);
      return reviewSnapshotFor(workspaceId);
    }
  };
}
