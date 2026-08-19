import type { HarnessKind } from "../catalog/types";

export type RuntimeEventType =
  | "turn.started"
  | "user.message"
  | "text.delta"
  | "reasoning.delta"
  | "tool_call.started"
  | "tool_call.completed"
  | "tool_call.errored"
  | "turn.completed"
  | "turn.errored";

export interface RuntimeEventBase {
  id: string;
  sessionId: string;
  timestamp: string;
  turnId: string;
  type: RuntimeEventType;
}

export interface TurnStartedEvent extends RuntimeEventBase {
  harnessId: string;
  type: "turn.started";
  workspaceId: string;
}

export interface UserMessageEvent extends RuntimeEventBase {
  text: string;
  type: "user.message";
}

export interface TextDeltaEvent extends RuntimeEventBase {
  blockId: string;
  text: string;
  type: "text.delta";
}

export interface ReasoningDeltaEvent extends RuntimeEventBase {
  blockId: string;
  text: string;
  type: "reasoning.delta";
}

/**
 * The sub-agent a tool call belongs to, when the harness says which.
 *
 * Optional throughout, and it will stay optional: a harness that does not
 * delegate has nothing to report, and one that delegates without naming the
 * worker gives us an `id` and no useful `name`. Absent means "the main thread
 * did this", which is the only safe reading: attributing a call to an agent
 * that did not make it is worse than not attributing it at all.
 *
 * `id` is what identity means here, not `name`. Two agents of the same kind
 * running in parallel are two agents, and a fan-out of three `explore` workers
 * is the case the feature exists for.
 */
export interface AgentRef {
  id: string;
  name: string;
}

export interface ToolCallStartedEvent extends RuntimeEventBase {
  agent?: AgentRef;
  blockId: string;
  input?: string;
  name: string;
  type: "tool_call.started";
}

/**
 * A file a tool call changed, as the harness reported it.
 *
 * opencode computes the per-file line counts itself, so they are carried
 * through rather than re-derived from patch text. `path` is workspace-relative.
 */
export interface FileChange {
  additions: number;
  deletions: number;
  /**
   * The unified diff for this file, when the harness sent one. It is what the
   * transcript renders and what an undo reverse-applies. Absent means the
   * change is known but not showable: the row renders without a diff rather
   * than with an empty one.
   */
  patch?: string;
  path: string;
}

export interface ToolCallCompletedEvent extends RuntimeEventBase {
  agent?: AgentRef;
  blockId: string;
  /** Files the call changed, when the harness reports them. */
  fileChanges?: FileChange[];
  /**
   * What the call was given. Present here as well as on the start event because
   * `opencode run --format json` reports each tool exactly once, already
   * finished: there is no start frame to have carried it.
   */
  input?: string;
  name?: string;
  output?: string;
  type: "tool_call.completed";
}

export interface ToolCallErroredEvent extends RuntimeEventBase {
  agent?: AgentRef;
  blockId: string;
  message: string;
  name?: string;
  type: "tool_call.errored";
}

export interface TurnCompletedEvent extends RuntimeEventBase {
  opencodeSessionId?: string;
  type: "turn.completed";
}

export interface TurnErroredEvent extends RuntimeEventBase {
  exitCode?: number;
  message: string;
  type: "turn.errored";
}

export type RuntimeEvent =
  | TurnStartedEvent
  | UserMessageEvent
  | TextDeltaEvent
  | ReasoningDeltaEvent
  | ToolCallStartedEvent
  | ToolCallCompletedEvent
  | ToolCallErroredEvent
  | TurnCompletedEvent
  | TurnErroredEvent;

export type ChatBlockStatus = "running" | "completed" | "errored";

export interface TextChatBlock {
  id: string;
  status: ChatBlockStatus;
  text: string;
  type: "text";
}

export interface ReasoningChatBlock {
  id: string;
  status: ChatBlockStatus;
  text: string;
  type: "reasoning";
}

export interface ToolCallChatBlock {
  /** Set when a sub-agent made this call rather than the main thread. */
  agent?: AgentRef;
  fileChanges?: FileChange[];
  id: string;
  input?: string;
  name: string;
  output?: string;
  status: ChatBlockStatus;
  type: "tool_call";
}

export interface ErrorChatBlock {
  id: string;
  message: string;
  status: "errored";
  type: "error";
}

export type ChatBlock =
  | TextChatBlock
  | ReasoningChatBlock
  | ToolCallChatBlock
  | ErrorChatBlock;

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  blocks: ChatBlock[];
  createdAt: string;
  id: string;
  role: ChatMessageRole;
  sessionId: string;
  turnId: string;
}

export type ChatSessionStatus = "idle" | "running" | "failed" | "stopped";

export interface ChatSession {
  createdAt: string;
  harnessId: string;
  harnessKind?: HarnessKind;
  id: string;
  lastEventAt: string;
  model?: string;
  opencodeSessionId?: string;
  startPath?: string;
  status: ChatSessionStatus;
  title: string;
  workspaceId: string;
  workspacePath: string;
}

export interface CreateChatSessionRequest {
  harnessId: string;
  model?: string;
  opencodeSessionId?: string;
  startPath?: string;
  title?: string;
  workspaceId: string;
  workspacePath: string;
}

export interface SendChatMessageRequest {
  prompt: string;
  startPath?: string;
}

/** Receives batches of events as a turn streams. */
export type ChatEventListener = (events: RuntimeEvent[]) => void;

export interface ChatRuntime {
  createChatSession(request: CreateChatSessionRequest): Promise<ChatSession>;
  /**
   * Run a turn, delivering events to `onEvents` as they arrive. Resolves when
   * the turn ends; the transcript is built from the events, not the return
   * value.
   *
   * Batched rather than one-event-at-a-time because the host coalesces
   * consecutive deltas before sending: a fast model emits a line per token,
   * and forwarding each individually costs an IPC message and a render each.
   */
  streamChatMessage(
    sessionId: string,
    request: SendChatMessageRequest,
    onEvents: ChatEventListener
  ): Promise<void>;
  /** Stop the running turn. A terminal event still arrives. */
  cancelChatTurn(sessionId: string): Promise<void>;
  /** Every event recorded for a session, for rebuilding it on reopen. */
  replayChatSession(sessionId: string): Promise<RuntimeEvent[]>;
  /**
   * Branch a conversation: a new session carrying every turn through
   * `throughTurnId`.
   *
   * The transcript is copied; the harness-side context is not. Reusing the
   * opencode session id would make the fork an alias rather than a branch, with
   * both sides appending to one server-side conversation, so the fork's next
   * turn starts a fresh opencode session that has no memory of what it shows.
   */
  forkChatSession(sessionId: string, throughTurnId: string): Promise<ChatSession>;
}
