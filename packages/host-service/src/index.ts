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

/**
 * Streaming chat is owned by the Rust host (M1). This reference host cannot
 * stream, so it reports chat as unavailable rather than shipping a second,
 * divergent implementation.
 */
const CHAT_UNSUPPORTED =
  "Streaming chat requires the Tauri host. Run `pnpm dev` instead of `pnpm dev:web`.";

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

    async createChatSession(): Promise<ChatSession> {
      throw new Error(CHAT_UNSUPPORTED);
    },

    async streamChatMessage(): Promise<void> {
      throw new Error(CHAT_UNSUPPORTED);
    },

    async cancelChatTurn(): Promise<void> {
      return;
    },

    async replayChatSession(): Promise<RuntimeEvent[]> {
      return [];
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
