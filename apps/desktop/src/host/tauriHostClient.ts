import { invoke } from "@tauri-apps/api/core";
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

/**
 * Talks to the Rust host over Tauri's IPC. Command names match the
 * `#[tauri::command]` functions in `src-tauri/src/lib.rs`; Tauri maps camelCase
 * argument keys onto their snake_case Rust parameters.
 */
export function createTauriHostClient(): ArtemisHostClient {
  return {
    getSnapshot(): Promise<AssetInventorySnapshot> {
      return invoke("get_snapshot");
    },

    listProjects(): Promise<ProjectRef[]> {
      return invoke("list_projects");
    },

    listWorkspaces(projectId?: string): Promise<WorkspaceSummary[]> {
      return invoke("list_workspaces", { projectId: projectId ?? null });
    },

    listSessions(workspaceId?: string): Promise<AgentSessionSummary[]> {
      return invoke("list_sessions", { workspaceId: workspaceId ?? null });
    },

    getReviewSnapshot(workspaceId: string): Promise<ReviewSnapshot> {
      return invoke("get_review_snapshot", { workspaceId });
    },

    getRuntimeSettings(): Promise<RuntimeSettings> {
      return invoke("get_runtime_settings");
    },

    updateRuntimeSettings(settings: RuntimeSettings): Promise<RuntimeSettings> {
      return invoke("update_runtime_settings", { settings });
    },

    launchAgent(request: AgentLaunchRequest): Promise<AgentLaunchResult> {
      return invoke("launch_agent", { request });
    },

    // Chat is the one surface the Rust host does not own yet. M1 replaces the
    // whole request/response shape with a streamed RuntimeEvent channel, so
    // porting the current one-shot implementation first would be wasted work.
    createChatSession(request: CreateChatSessionRequest): Promise<ChatSession> {
      return Promise.reject(
        new Error(
          `Chat is not available in the Tauri host yet (M1). Requested harness: ${request.harnessId}.`
        )
      );
    },

    sendChatMessage(
      sessionId: string,
      _request: SendChatMessageRequest
    ): Promise<ChatTurnResult> {
      return Promise.reject(
        new Error(
          `Chat is not available in the Tauri host yet (M1). Session: ${sessionId}.`
        )
      );
    }
  };
}
