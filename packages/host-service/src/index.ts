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
    ReviewRuntime,
    TerminalRuntime {}

export interface LocalHostServiceOptions {
  latencyMs?: number;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

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

    async listAppIcons(): Promise<AppIcon[]> {
      return [];
    },

    async setAppIcon(): Promise<void> {
      throw new Error(ICONS_UNSUPPORTED);
    },

    async getLaunchPreset(): Promise<LaunchPreset | null> {
      return null;
    },

    async saveLaunchPreset(): Promise<void> {
      return;
    },

    async openTerminal(): Promise<TerminalSession> {
      throw new Error(TERMINALS_UNSUPPORTED);
    },

    async listTerminals(): Promise<TerminalSession[]> {
      return [];
    },

    async subscribeTerminal(): Promise<string> {
      return "";
    },

    async unsubscribeTerminal(): Promise<void> {
      return;
    },

    async writeTerminal(): Promise<void> {
      throw new Error(TERMINALS_UNSUPPORTED);
    },

    async resizeTerminal(): Promise<void> {
      return;
    },

    async closeTerminal(): Promise<void> {
      return;
    },

    async createWorkspace(): Promise<WorkspaceSummary> {
      throw new Error(WORKTREES_UNSUPPORTED);
    },

    async deleteWorkspace(): Promise<void> {
      throw new Error(WORKTREES_UNSUPPORTED);
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
      return session;
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

    /** The seed service has no event log, so there is nothing to branch. */
    async forkChatSession(): Promise<ChatSession> {
      throw new Error("Forking a session requires the desktop app.");
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
