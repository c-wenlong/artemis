import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@artemis/core";
import { emptyTranscript, reduceEvents } from "./reduce";

let sequence = 0;
const base = (turnId = "t1") => ({
  id: `e${++sequence}`,
  sessionId: "s1",
  timestamp: "2026-08-10T00:00:00.000Z",
  turnId
});

const textDelta = (blockId: string, text: string, turnId = "t1"): RuntimeEvent => ({
  ...base(turnId),
  blockId,
  text,
  type: "text.delta"
});

const reasoningDelta = (blockId: string, text: string): RuntimeEvent => ({
  ...base(),
  blockId,
  text,
  type: "reasoning.delta"
});

const userMessage = (text: string, turnId = "t1"): RuntimeEvent => ({
  ...base(turnId),
  text,
  type: "user.message"
});

const turnStarted = (turnId = "t1"): RuntimeEvent => ({
  ...base(turnId),
  harnessId: "opencode",
  type: "turn.started",
  workspaceId: "ws"
});

describe("reduceEvents", () => {
  it("starts empty", () => {
    expect(emptyTranscript().messages).toEqual([]);
    expect(emptyTranscript().status).toBe("idle");
  });

  it("appends deltas into one growing block", () => {
    const state = reduceEvents(emptyTranscript(), [
      turnStarted(),
      textDelta("b1", "Hel"),
      textDelta("b1", "lo")
    ]);
    const assistant = state.messages.find((message) => message.role === "assistant");
    expect(assistant?.blocks).toHaveLength(1);
    expect(assistant?.blocks[0]).toMatchObject({ type: "text", text: "Hello" });
  });

  it("is incremental: folding one at a time matches folding all at once", () => {
    const events = [turnStarted(), textDelta("b1", "a"), textDelta("b1", "b")];
    const atOnce = reduceEvents(emptyTranscript(), events);
    const oneByOne = events.reduce(
      (state, event) => reduceEvents(state, [event]),
      emptyTranscript()
    );
    expect(oneByOne).toEqual(atOnce);
  });

  it("keeps the user prompt as its own message ahead of the reply", () => {
    const state = reduceEvents(emptyTranscript(), [
      turnStarted(),
      userMessage("why is this slow?"),
      textDelta("b1", "Because…")
    ]);
    expect(state.messages[0]).toMatchObject({ role: "user" });
    expect(state.messages[0]?.blocks[0]).toMatchObject({ text: "why is this slow?" });
    expect(state.messages[1]).toMatchObject({ role: "assistant" });
  });

  it("separates reasoning from the answer", () => {
    const state = reduceEvents(emptyTranscript(), [
      turnStarted(),
      reasoningDelta("r1", "thinking"),
      textDelta("b1", "answer")
    ]);
    const blocks = state.messages.find((m) => m.role === "assistant")?.blocks ?? [];
    expect(blocks.map((block) => block.type)).toEqual(["reasoning", "text"]);
  });

  it("preserves arrival order across block kinds", () => {
    const state = reduceEvents(emptyTranscript(), [
      turnStarted(),
      textDelta("b1", "before "),
      { ...base(), blockId: "t1", name: "bash", input: "ls", type: "tool_call.started" },
      textDelta("b2", "after")
    ]);
    const blocks = state.messages.find((m) => m.role === "assistant")?.blocks ?? [];
    expect(blocks.map((block) => block.type)).toEqual(["text", "tool_call", "text"]);
  });

  it("moves a tool call from running to completed in place", () => {
    const started = reduceEvents(emptyTranscript(), [
      turnStarted(),
      { ...base(), blockId: "tool-1", name: "bash", input: "ls", type: "tool_call.started" }
    ]);
    let blocks = started.messages.find((m) => m.role === "assistant")?.blocks ?? [];
    expect(blocks[0]).toMatchObject({ status: "running", name: "bash", input: "ls" });

    const done = reduceEvents(started, [
      { ...base(), blockId: "tool-1", name: "bash", output: "a.txt", type: "tool_call.completed" }
    ]);
    blocks = done.messages.find((m) => m.role === "assistant")?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      status: "completed",
      output: "a.txt",
      // The input from the start event must survive the completion.
      input: "ls"
    });
  });

  it("marks a failed tool call without losing its identity", () => {
    const state = reduceEvents(emptyTranscript(), [
      turnStarted(),
      { ...base(), blockId: "tool-1", name: "bash", input: "rm", type: "tool_call.started" },
      { ...base(), blockId: "tool-1", message: "permission denied", type: "tool_call.errored" }
    ]);
    const blocks = state.messages.find((m) => m.role === "assistant")?.blocks ?? [];
    expect(blocks[0]).toMatchObject({
      status: "errored",
      name: "bash",
      output: "permission denied"
    });
  });

  it("tracks turn status through to completion", () => {
    let state = reduceEvents(emptyTranscript(), [turnStarted()]);
    expect(state.status).toBe("running");
    state = reduceEvents(state, [{ ...base(), type: "turn.completed" }]);
    expect(state.status).toBe("idle");
  });

  it("surfaces a turn error as a block and a status", () => {
    const state = reduceEvents(emptyTranscript(), [
      turnStarted(),
      { ...base(), message: "no credits", type: "turn.errored" }
    ]);
    expect(state.status).toBe("failed");
    const blocks = state.messages.find((m) => m.role === "assistant")?.blocks ?? [];
    expect(blocks.at(-1)).toMatchObject({ type: "error", message: "no credits" });
  });

  it("keeps earlier turns when a new one starts", () => {
    let state = reduceEvents(emptyTranscript(), [
      turnStarted("t1"),
      userMessage("first", "t1"),
      textDelta("b1", "one", "t1"),
      { ...base("t1"), type: "turn.completed" }
    ]);
    state = reduceEvents(state, [
      turnStarted("t2"),
      userMessage("second", "t2"),
      textDelta("b2", "two", "t2")
    ]);
    expect(state.messages).toHaveLength(4);
    expect(state.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
  });

  it("is idempotent for a replayed log", () => {
    const events: RuntimeEvent[] = [
      turnStarted(),
      userMessage("hello"),
      textDelta("b1", "hi"),
      { ...base(), type: "turn.completed" }
    ];
    const live = reduceEvents(emptyTranscript(), events);
    const replayed = reduceEvents(emptyTranscript(), events);
    expect(replayed).toEqual(live);
  });

  it("ignores an unknown event kind rather than throwing", () => {
    const state = reduceEvents(emptyTranscript(), [
      turnStarted(),
      { ...base(), type: "something.new" } as unknown as RuntimeEvent
    ]);
    expect(state.status).toBe("running");
  });
});
