import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AgentLaunchRequest,
  AgentLaunchResult,
  AgentSessionSummary,
  AssetInventorySnapshot,
  ChatEventListener,
  ChatSession,
  CreateChatSessionRequest,
  ProjectRef,
  ReviewSnapshot,
  RuntimeEvent,
  RuntimeSettings,
  SendChatMessageRequest,
  TerminalOutputListener,
  TerminalSession,
  TerminalSpec,
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

    createWorkspace(projectId: string, branch: string): Promise<WorkspaceSummary> {
      return invoke("create_workspace", { projectId, branch });
    },

    deleteWorkspace(workspaceId: string, force: boolean): Promise<void> {
      return invoke("delete_workspace", { workspaceId, force });
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

    openTerminal(spec: TerminalSpec): Promise<TerminalSession> {
      return invoke("open_terminal", { spec });
    },

    listTerminals(): Promise<TerminalSession[]> {
      return invoke("list_terminals");
    },

    subscribeTerminal(
      terminalId: string,
      onOutput: TerminalOutputListener
    ): Promise<string> {
      const channel = new Channel<string>();
      channel.onmessage = (chunk) => onOutput(chunk);
      return invoke("subscribe_terminal", { terminalId, channel });
    },

    unsubscribeTerminal(terminalId: string): Promise<void> {
      return invoke("unsubscribe_terminal", { terminalId });
    },

    writeTerminal(terminalId: string, data: string): Promise<void> {
      return invoke("write_terminal", { terminalId, data });
    },

    resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void> {
      return invoke("resize_terminal", { terminalId, cols, rows });
    },

    closeTerminal(terminalId: string): Promise<void> {
      return invoke("close_terminal", { terminalId });
    },

    createChatSession(request: CreateChatSessionRequest): Promise<ChatSession> {
      return invoke("create_chat_session", { request });
    },

    /**
     * Events arrive over a Tauri channel in batches — the host coalesces
     * consecutive deltas before sending, so this is one message per flush
     * rather than per token. The promise resolves when the turn ends.
     */
    streamChatMessage(
      sessionId: string,
      request: SendChatMessageRequest,
      onEvents: ChatEventListener
    ): Promise<void> {
      const channel = new Channel<RuntimeEvent[]>();
      channel.onmessage = (events) => onEvents(events);
      return invoke("send_chat_message", { sessionId, request, channel });
    },

    cancelChatTurn(sessionId: string): Promise<void> {
      return invoke("cancel_chat_turn", { sessionId });
    },

    replayChatSession(sessionId: string): Promise<RuntimeEvent[]> {
      return invoke("replay_chat_session", { sessionId });
    }
  };
}
