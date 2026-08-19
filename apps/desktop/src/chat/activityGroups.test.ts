import { describe, expect, it } from "vitest";
import type { ChatBlock } from "@artemis/core";
import { buildTimeline } from "./activityGroups";

const text = (id: string, value = "prose"): ChatBlock => ({
  id,
  status: "completed",
  text: value,
  type: "text"
});

const reasoning = (id: string): ChatBlock => ({
  id,
  status: "completed",
  text: "thinking",
  type: "reasoning"
});

const tool = (
  id: string,
  name = "bash",
  status: "running" | "completed" | "errored" = "completed"
): ChatBlock => ({
  id,
  name,
  status,
  type: "tool_call"
});

function kinds(blocks: ChatBlock[]) {
  return buildTimeline(blocks).map((item) => item.kind);
}

describe("buildTimeline", () => {
  it("leaves prose alone", () => {
    expect(kinds([text("a"), text("b")])).toEqual(["block", "block"]);
  });

  /**
   * A group of one is strictly worse than the call itself: same information,
   * one more layer to open.
   */
  it("does not group a lone tool call", () => {
    expect(kinds([tool("t1")])).toEqual(["block"]);
  });

  it("groups consecutive tool calls", () => {
    const timeline = buildTimeline([tool("t1"), tool("t2"), tool("t3")]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.kind).toBe("group");
    if (timeline[0]!.kind !== "group") throw new Error("unreachable");
    expect(timeline[0]!.group.blocks).toHaveLength(3);
  });

  it("keeps prose out of the group and preserves order", () => {
    expect(
      kinds([text("a"), tool("t1"), tool("t2"), text("b"), tool("t3"), tool("t4")])
    ).toEqual(["block", "group", "block", "group"]);
  });

  /**
   * Reasoning is promoted out of activity groups: Traycer's rule; groups carry
   * only operational work. It splits an adjacent run because rendering it
   * between two halves of one group would misrepresent the sequence.
   */
  it("promotes reasoning out of a group, splitting the run", () => {
    expect(kinds([tool("t1"), tool("t2"), reasoning("r1"), tool("t3"), tool("t4")])).toEqual(
      ["group", "block", "group"]
    );
  });

  it("gives every group a stable id derived from its first call", () => {
    const first = buildTimeline([tool("t1"), tool("t2")]);
    const again = buildTimeline([tool("t1"), tool("t2")]);
    expect(first[0]).toEqual(again[0]);
  });
});

describe("group state", () => {
  function group(blocks: ChatBlock[]) {
    const [item] = buildTimeline(blocks);
    if (item?.kind !== "group") throw new Error("expected a group");
    return item.group;
  }

  it("is active while any call is still running", () => {
    expect(group([tool("t1"), tool("t2", "bash", "running")]).isActive).toBe(true);
    expect(group([tool("t1"), tool("t2")]).isActive).toBe(false);
  });

  it("counts failures so they cannot hide behind a collapsed header", () => {
    const failed = group([tool("t1"), tool("t2", "bash", "errored")]);
    expect(failed.failureCount).toBe(1);
    expect(failed.hasFailure).toBe(true);
  });

  it("reads in the past tense once finished", () => {
    expect(group([tool("t1"), tool("t2"), tool("t3")]).label).toBe("Ran 3 tools");
  });

  it("reads in the present tense while working", () => {
    expect(group([tool("t1"), tool("t2", "bash", "running")]).label).toBe(
      "Running 2 tools"
    );
  });

  it("names the tools it used, without repeating a name", () => {
    const summary = group([
      tool("t1", "bash"),
      tool("t2", "read"),
      tool("t3", "bash")
    ]).summary;
    expect(summary).toBe("bash · read");
  });

  it("caps the name list so a long run does not overflow the header", () => {
    const blocks = Array.from({ length: 12 }, (_, index) =>
      tool(`t${index}`, `tool${index}`)
    );
    const { summary } = group(blocks);
    expect(summary.split(" · ").length).toBeLessThanOrEqual(4);
    expect(summary).toMatch(/\+\d+ more/);
  });

  it("says how many failed in the label", () => {
    expect(
      group([tool("t1"), tool("t2", "bash", "errored"), tool("t3", "bash", "errored")])
        .label
    ).toBe("Ran 3 tools, 2 failed");
  });
});

describe("the point of grouping", () => {
  it("turns a thirty-call turn into one line", () => {
    const blocks = [
      text("intro"),
      ...Array.from({ length: 30 }, (_, index) => tool(`t${index}`)),
      text("outro")
    ];
    const timeline = buildTimeline(blocks);
    expect(timeline).toHaveLength(3);
    expect(kinds(blocks)).toEqual(["block", "group", "block"]);
  });
});
