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

export interface ToolCallStartedEvent extends RuntimeEventBase {
  blockId: string;
  input?: string;
  name: string;
  type: "tool_call.started";
}

export interface ToolCallCompletedEvent extends RuntimeEventBase {
  blockId: string;
  name?: string;
  output?: string;
  type: "tool_call.completed";
}

export interface ToolCallErroredEvent extends RuntimeEventBase {
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

export interface ChatTurnResult {
  events: RuntimeEvent[];
  messages: ChatMessage[];
  session: ChatSession;
}

export interface ChatRuntime {
  createChatSession(request: CreateChatSessionRequest): Promise<ChatSession>;
  sendChatMessage(
    sessionId: string,
    request: SendChatMessageRequest
  ): Promise<ChatTurnResult>;
}
