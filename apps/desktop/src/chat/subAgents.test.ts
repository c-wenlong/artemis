import { describe, expect, it } from "vitest";
import type { ChatBlock } from "@artemis/core";
import { buildTimeline } from "./activityGroups";

/**
 * A fan-out has to read as "two named agents are working".
 *
 * Without this, a harness that delegates renders as one undifferentiated run of
 * tool calls: thirty rows with no indication that half of them belong to one
 * agent reading files and half to another running tests. The names are the only
 * thing that makes the shape of the work legible, and the harness already knows
 * them.
 */

const text = (id: string): ChatBlock => ({
  id,
  status: "completed",
  text: "prose",
  type: "text"
});

const tool = (
  id: string,
  agent?: { id: string; name: string },
  status: "running" | "completed" | "errored" = "completed"
): ChatBlock => ({
  agent,
  id,
  name: "bash",
  status,
  type: "tool_call"
});

const explore = { id: "a1", name: "explore" };
const general = { id: "a2", name: "general" };

function kinds(blocks: ChatBlock[]) {
  return buildTimeline(blocks).map((item) => item.kind);
}

describe("sub-agent grouping", () => {
  /**
   * The reason the milestone exists. Two agents' calls sitting next to each
   * other must not fold into one anonymous "Ran 4 tools".
   */
  it("splits a run at the boundary between two agents", () => {
    const timeline = buildTimeline([
      tool("t1", explore),
      tool("t2", explore),
      tool("t3", general),
      tool("t4", general)
    ]);

    expect(timeline).toHaveLength(2);
    expect(timeline.every((item) => item.kind === "agent")).toBe(true);
    expect(
      timeline.map((item) => (item.kind === "agent" ? item.group.agent.name : null))
    ).toEqual(["explore", "general"]);
  });

  /** A delegated call is still delegated when it is the only one. */
  it("groups a single sub-agent call, unlike an ordinary lone tool call", () => {
    expect(kinds([tool("t1", explore)])).toEqual(["agent"]);
    expect(kinds([tool("t1")])).toEqual(["block"]);
  });

  it("keeps the main thread's own calls out of the agent groups", () => {
    expect(kinds([tool("t1"), tool("t2"), tool("t3", explore)])).toEqual([
      "group",
      "agent"
    ]);
  });

  /**
   * Prose splits a run for the same reason it splits an activity group: folding
   * across it would put the group's second half before text that preceded it.
   */
  it("does not fold one agent's calls across intervening prose", () => {
    expect(kinds([tool("t1", explore), text("m"), tool("t2", explore)])).toEqual([
      "agent",
      "block",
      "agent"
    ]);
  });

  /** Two agents with the same name are still two agents. */
  it("splits on identity, not on name", () => {
    const timeline = buildTimeline([
      tool("t1", { id: "a1", name: "explore" }),
      tool("t2", { id: "a2", name: "explore" })
    ]);
    expect(timeline).toHaveLength(2);
  });

  it("reports a sub-agent as working while any of its calls is running", () => {
    const timeline = buildTimeline([
      tool("t1", explore, "completed"),
      tool("t2", explore, "running")
    ]);
    expect(timeline[0]!.kind === "agent" && timeline[0]!.group.isActive).toBe(true);
  });

  it("surfaces a failure inside a sub-agent rather than hiding it in the panel", () => {
    const timeline = buildTimeline([
      tool("t1", explore, "completed"),
      tool("t2", explore, "errored")
    ]);
    expect(timeline[0]!.kind === "agent" && timeline[0]!.group.hasFailure).toBe(true);
  });

  /** Colour is derived, so two agents in one turn never collide by accident. */
  it("gives two agents in the same turn different colours", () => {
    const timeline = buildTimeline([tool("t1", explore), tool("t2", general)]);
    const tones = timeline.map((item) =>
      item.kind === "agent" ? item.group.tone : null
    );
    expect(tones[0]).not.toEqual(tones[1]);
    expect(tones[0]).toEqual(expect.any(Number));
  });

  /** Same agent, same colour, wherever it appears in the transcript. */
  it("gives one agent the same colour every time it appears", () => {
    const timeline = buildTimeline([
      tool("t1", explore),
      text("m"),
      tool("t2", explore)
    ]);
    const [first, second] = timeline.filter((item) => item.kind === "agent");
    expect(first!.kind === "agent" && first.group.tone).toEqual(
      second!.kind === "agent" && second.group.tone
    );
  });
});
