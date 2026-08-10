import type {
  ChatBlock,
  ChatMessage,
  ChatSessionStatus,
  RuntimeEvent
} from "@artemis/core";

/**
 * Folded view of a session's event stream.
 *
 * The event log is the source of truth; this is a projection of it. Because the
 * fold is incremental and order-preserving, the same function serves the live
 * stream and the replay of a recorded log — which is what makes reopening a
 * session show exactly what streamed.
 */
export type TurnStatus = "running" | "completed" | "failed";

/**
 * Timing for one turn. Both ends are optional because a truncated log can be
 * missing either, and an invented duration is worse than none.
 */
export interface TurnRecord {
  startedAt?: string;
  completedAt?: string;
  status: TurnStatus;
}

export interface Transcript {
  messages: ChatMessage[];
  status: ChatSessionStatus;
  /** Per-turn timing, for the elapsed heartbeat and the "Worked for" footer. */
  turns: Record<string, TurnRecord>;
  /** Set by `turn.completed`; needed to resume the opencode conversation. */
  opencodeSessionId?: string;
}

export function emptyTranscript(): Transcript {
  return { messages: [], status: "idle", turns: {} };
}

function upsertBlock(blocks: ChatBlock[], block: ChatBlock): ChatBlock[] {
  const index = blocks.findIndex((candidate) => candidate.id === block.id);
  if (index === -1) return [...blocks, block];
  const next = blocks.slice();
  next[index] = block;
  return next;
}

function findBlock(blocks: ChatBlock[], id: string): ChatBlock | undefined {
  return blocks.find((block) => block.id === id);
}

/**
 * Assistant message for a turn, created on demand. Turns are appended, never
 * replaced, so earlier ones stay visible.
 */
function withAssistant(
  messages: ChatMessage[],
  event: RuntimeEvent,
  update: (blocks: ChatBlock[]) => ChatBlock[]
): ChatMessage[] {
  const id = `${event.turnId}-assistant`;
  const index = messages.findIndex((message) => message.id === id);

  if (index === -1) {
    return [
      ...messages,
      {
        blocks: update([]),
        createdAt: event.timestamp,
        id,
        role: "assistant",
        sessionId: event.sessionId,
        turnId: event.turnId
      }
    ];
  }

  const next = messages.slice();
  const existing = next[index]!;
  next[index] = { ...existing, blocks: update(existing.blocks) };
  return next;
}

/**
 * Resolve tool calls still marked running when their turn ends.
 *
 * Real opencode emits `tool_call.started` without a matching completion often
 * enough that this is the normal case, not an edge one. Left alone the
 * transcript shows a spinner and a climbing heartbeat on a turn that finished
 * — so the call is resolved to whatever happened to the turn that owned it:
 * completed if it completed, failed if it failed or was stopped.
 */
function resolveDanglingCalls(
  messages: ChatMessage[],
  turnId: string,
  outcome: "completed" | "errored"
): ChatMessage[] {
  return messages.map((message) => {
    if (message.turnId !== turnId) return message;
    let changed = false;
    const blocks = message.blocks.map((block) => {
      if (block.type !== "tool_call" || block.status !== "running") return block;
      changed = true;
      return { ...block, status: outcome };
    });
    return changed ? { ...message, blocks } : message;
  });
}

/**
 * Fold events into a transcript. Pure and incremental: applying events one at a
 * time gives the same result as applying them in a batch, which is what lets the
 * UI take whatever batch size the host happens to send.
 */
export function reduceEvents(state: Transcript, events: RuntimeEvent[]): Transcript {
  let messages = state.messages;
  let status = state.status;
  let turns = state.turns;
  let opencodeSessionId = state.opencodeSessionId;

  const recordTurn = (turnId: string, patch: Partial<TurnRecord>) => {
    const existing = turns[turnId] ?? { status: "running" as TurnStatus };
    turns = { ...turns, [turnId]: { ...existing, ...patch } };
  };

  for (const event of events) {
    switch (event.type) {
      case "turn.started": {
        status = "running";
        recordTurn(event.turnId, { startedAt: event.timestamp, status: "running" });
        break;
      }

      case "user.message": {
        const id = `${event.turnId}-user`;
        if (messages.some((message) => message.id === id)) break;
        messages = [
          ...messages,
          {
            blocks: [
              { id: `${id}-text`, status: "completed", text: event.text, type: "text" }
            ],
            createdAt: event.timestamp,
            id,
            role: "user",
            sessionId: event.sessionId,
            turnId: event.turnId
          }
        ];
        break;
      }

      case "text.delta":
      case "reasoning.delta": {
        const type = event.type === "text.delta" ? "text" : "reasoning";
        messages = withAssistant(messages, event, (blocks) => {
          const existing = findBlock(blocks, event.blockId);
          const previous =
            existing && (existing.type === "text" || existing.type === "reasoning")
              ? existing.text
              : "";
          return upsertBlock(blocks, {
            id: event.blockId,
            status: "completed",
            text: previous + event.text,
            type
          });
        });
        break;
      }

      case "tool_call.started": {
        messages = withAssistant(messages, event, (blocks) =>
          upsertBlock(blocks, {
            id: event.blockId,
            input: event.input,
            name: event.name,
            status: "running",
            type: "tool_call"
          })
        );
        break;
      }

      case "tool_call.completed":
      case "tool_call.errored": {
        const isError = event.type === "tool_call.errored";
        messages = withAssistant(messages, event, (blocks) => {
          const existing = findBlock(blocks, event.blockId);
          const previous = existing?.type === "tool_call" ? existing : undefined;
          return upsertBlock(blocks, {
            id: event.blockId,
            // The start event carries the input; completion does not resend it.
            input: previous?.input,
            name: event.name ?? previous?.name ?? "tool",
            output: isError ? event.message : event.output,
            status: isError ? "errored" : "completed",
            type: "tool_call"
          });
        });
        break;
      }

      case "turn.completed": {
        status = "idle";
        recordTurn(event.turnId, {
          completedAt: event.timestamp,
          status: "completed"
        });
        messages = resolveDanglingCalls(messages, event.turnId, "completed");
        opencodeSessionId = event.opencodeSessionId ?? opencodeSessionId;
        break;
      }

      case "turn.errored": {
        status = "failed";
        recordTurn(event.turnId, { completedAt: event.timestamp, status: "failed" });
        messages = withAssistant(messages, event, (blocks) =>
          upsertBlock(blocks, {
            id: `${event.turnId}-error`,
            message: event.message,
            status: "errored",
            type: "error"
          })
        );
        messages = resolveDanglingCalls(messages, event.turnId, "errored");
        break;
      }

      default:
        // An event kind this build does not know about is not a reason to stop
        // rendering the ones it does.
        break;
    }
  }

  return { messages, status, turns, opencodeSessionId };
}
