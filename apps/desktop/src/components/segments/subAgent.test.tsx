import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ChatBlock } from "@artemis/core";
import { buildTimeline } from "../../chat/activityGroups";
import { SubAgentSegment } from "./SubAgentSegment";

/**
 * A fan-out should read as "two named agents are working", and either one
 * should open on its own.
 *
 * The thing being avoided is a main thread that fills with someone else's
 * mechanics. A delegated run of thirty calls belongs behind a name, with the
 * detail one click away — not inlined between the prose the user asked for.
 */

const tool = (
  id: string,
  agent: { id: string; name: string },
  status: "running" | "completed" | "errored" = "completed",
  name = "grep"
): ChatBlock => ({ agent, id, name, status, type: "tool_call" });

const explore = { id: "a1", name: "explore" };

function groupOf(blocks: ChatBlock[]) {
  const item = buildTimeline(blocks)[0];
  if (item?.kind !== "agent") throw new Error("expected a sub-agent group");
  return item.group;
}

describe("SubAgentSegment", () => {
  it("names the agent rather than the tools it ran", () => {
    render(<SubAgentSegment group={groupOf([tool("t1", explore)])} />);
    expect(screen.getByTestId("sub-agent-chip")).toHaveTextContent("explore");
  });

  it("says it started working while its calls are running", () => {
    render(
      <SubAgentSegment group={groupOf([tool("t1", explore, "running")])} />
    );
    expect(screen.getByTestId("sub-agent-chip")).toHaveTextContent(
      /started working/i
    );
  });

  /** The count is the useful summary once it has stopped moving. */
  it("reports what it did once finished", () => {
    render(
      <SubAgentSegment
        group={groupOf([tool("t1", explore), tool("t2", explore)])}
      />
    );
    expect(screen.getByTestId("sub-agent-chip")).toHaveTextContent("ran 2 tools");
  });

  /**
   * The main thread stays collapsed. This is the whole point: the panel is
   * where the detail lives.
   */
  /**
   * The chip still summarises which tools ran — that is the point of a summary.
   * What must not be in the main thread is the *detail*: the per-call rows with
   * their arguments and output.
   */
  it("keeps the calls out of the main thread until asked", () => {
    render(
      <SubAgentSegment
        group={groupOf([tool("t1", explore, "completed", "read")])}
      />
    );
    expect(screen.queryByTestId("sub-agent-panel")).toBeNull();
    expect(document.querySelectorAll(".sub-agent-call")).toHaveLength(0);
    expect(screen.getByTestId("sub-agent-chip")).toHaveTextContent("read");
  });

  it("opens that agent's own transcript when the chip is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SubAgentSegment
        group={groupOf([
          tool("t1", explore, "completed", "read"),
          tool("t2", explore, "completed", "grep")
        ])}
      />
    );

    await user.click(screen.getByTestId("sub-agent-chip"));

    const panel = screen.getByTestId("sub-agent-panel");
    expect(within(panel).getByText("read")).toBeVisible();
    expect(within(panel).getByText("grep")).toBeVisible();
  });

  it("closes again", async () => {
    const user = userEvent.setup();
    render(<SubAgentSegment group={groupOf([tool("t1", explore)])} />);

    await user.click(screen.getByTestId("sub-agent-chip"));
    expect(screen.getByTestId("sub-agent-panel")).toBeVisible();
    await user.click(screen.getByTestId("sub-agent-chip"));
    expect(screen.queryByTestId("sub-agent-panel")).toBeNull();
  });

  /**
   * Same rule as an activity group: a failure opens itself. Collapsing an error
   * out of sight behind a name is how a bug survives a review.
   */
  it("opens itself when one of the agent's calls failed", () => {
    render(
      <SubAgentSegment
        group={groupOf([tool("t1", explore, "errored", "bash")])}
      />
    );
    expect(screen.getByTestId("sub-agent-panel")).toBeVisible();
  });

  it("carries the agent's accent so a fan-out is scannable", () => {
    render(<SubAgentSegment group={groupOf([tool("t1", explore)])} />);
    expect(screen.getByTestId("sub-agent-chip")).toHaveAttribute("data-tone");
  });

  /** A chip is a control, so it has to be reachable without a mouse. */
  it("is a button, not a clickable div", () => {
    render(<SubAgentSegment group={groupOf([tool("t1", explore)])} />);
    expect(screen.getByTestId("sub-agent-chip").tagName).toBe("BUTTON");
  });
});
