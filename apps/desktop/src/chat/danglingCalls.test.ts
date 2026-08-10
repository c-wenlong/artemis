import { describe, expect, it } from "vitest";
import type { ChatBlock, RuntimeEvent } from "@artemis/core";
import { emptyTranscript, reduceEvents } from "./reduce";

const at = (n: number) => `2026-08-10T12:00:0${n}.000Z`;

const started: RuntimeEvent = {
  id: "s",
  sessionId: "s1",
  timestamp: at(0),
  turnId: "t1",
  harnessId: "opencode",
  workspaceId: "ws",
  type: "turn.started"
};

const toolStarted = (blockId: string, name = "read"): RuntimeEvent => ({
  id: `${blockId}-s`,
  sessionId: "s1",
  timestamp: at(1),
  turnId: "t1",
  blockId,
  name,
  type: "tool_call.started"
});

function toolBlocks(state: ReturnType<typeof reduceEvents>) {
  return state.messages
    .flatMap((message) => message.blocks)
    .filter((block): block is Extract<ChatBlock, { type: "tool_call" }> =>
      block.type === "tool_call"
    );
}

/**
 * Real opencode output, captured from a live run: it emitted
 * `tool_call.started` for three `read` calls and never sent a completion for
 * any of them. Left alone the transcript claims those calls are still running —
 * on a turn that visibly finished, with a heartbeat ticking past the recorded
 * duration.
 */
describe("tool calls left dangling when a turn ends", () => {
  it("resolves them as completed when the turn completed", () => {
    const state = reduceEvents(emptyTranscript(), [
      started,
      toolStarted("t-1"),
      toolStarted("t-2"),
      { id: "c", sessionId: "s1", timestamp: at(3), turnId: "t1", type: "turn.completed" }
    ]);

    expect(toolBlocks(state).map((block) => block.status)).toEqual([
      "completed",
      "completed"
    ]);
  });

  it("resolves them as failed when the turn failed or was stopped", () => {
    const state = reduceEvents(emptyTranscript(), [
      started,
      toolStarted("t-1"),
      {
        id: "e",
        sessionId: "s1",
        timestamp: at(3),
        turnId: "t1",
        message: "Turn stopped.",
        type: "turn.errored"
      }
    ]);

    // A stopped turn killed the process group; the call did not finish.
    expect(toolBlocks(state)[0]!.status).toBe("errored");
  });

  it("leaves calls that did report a result alone", () => {
    const state = reduceEvents(emptyTranscript(), [
      started,
      toolStarted("t-1"),
      {
        id: "d",
        sessionId: "s1",
        timestamp: at(2),
        turnId: "t1",
        blockId: "t-1",
        name: "read",
        output: "contents",
        type: "tool_call.completed"
      },
      toolStarted("t-2"),
      {
        id: "f",
        sessionId: "s1",
        timestamp: at(2),
        turnId: "t1",
        blockId: "t-2",
        message: "denied",
        type: "tool_call.errored"
      },
      { id: "c", sessionId: "s1", timestamp: at(3), turnId: "t1", type: "turn.completed" }
    ]);

    const blocks = toolBlocks(state);
    expect(blocks[0]).toMatchObject({ status: "completed", output: "contents" });
    expect(blocks[1]).toMatchObject({ status: "errored", output: "denied" });
  });

  it("only resolves calls belonging to the turn that ended", () => {
    const state = reduceEvents(emptyTranscript(), [
      started,
      toolStarted("t-1"),
      { id: "c", sessionId: "s1", timestamp: at(3), turnId: "t1", type: "turn.completed" },
      {
        id: "s2",
        sessionId: "s1",
        timestamp: at(4),
        turnId: "t2",
        harnessId: "opencode",
        workspaceId: "ws",
        type: "turn.started"
      },
      {
        id: "t2-s",
        sessionId: "s1",
        timestamp: at(5),
        turnId: "t2",
        blockId: "t-9",
        name: "bash",
        type: "tool_call.started"
      }
    ]);

    const blocks = toolBlocks(state);
    expect(blocks[0]!.status).toBe("completed");
    // The live turn's call is genuinely still running.
    expect(blocks[1]!.status).toBe("running");
  });
});
