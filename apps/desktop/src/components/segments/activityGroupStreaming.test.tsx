import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ChatBlock, ChatMessage } from "@artemis/core";
import { MessageList } from "../Conversation/MessageList";

const tool = (
  id: string,
  name = "bash",
  status: "running" | "completed" | "errored" = "completed"
): ChatBlock => ({ id, name, status, type: "tool_call" });

function messages(blocks: ChatBlock[]): ChatMessage[] {
  return [
    {
      blocks,
      createdAt: "2026-08-10T12:00:00.000Z",
      id: "t1-assistant",
      role: "assistant",
      sessionId: "s1",
      turnId: "t1"
    }
  ];
}

function renderList(blocks: ChatBlock[]) {
  return render(
    <MessageList
      isStreaming
      messages={messages(blocks)}
      turns={{ t1: { startedAt: "2026-08-10T12:00:00.000Z", status: "running" } }}
    />
  );
}

describe("a group as it streams", () => {
  it("forms once a second call arrives", () => {
    const { rerender } = renderList([tool("t1", "bash", "running")]);
    expect(screen.queryByTestId("activity-group")).toBeNull();

    rerender(
      <MessageList
        isStreaming
        messages={messages([tool("t1"), tool("t2", "read", "running")])}
        turns={{ t1: { startedAt: "2026-08-10T12:00:00.000Z", status: "running" } }}
      />
    );
    expect(screen.getByTestId("activity-group")).toHaveTextContent("Running 2 tools");
  });

  /**
   * The group's identity is its first call, so appending does not remount it.
   * If it did, a group the user opened would snap shut every time another call
   * landed — which, mid-run, is constantly.
   */
  it("stays open while more calls append to it", async () => {
    const user = userEvent.setup();
    const { rerender } = renderList([tool("t1"), tool("t2", "read", "running")]);

    await user.click(within(screen.getByTestId("activity-group")).getAllByRole("button")[0]!);
    expect(screen.getAllByTestId("segment-row")).toHaveLength(2);

    rerender(
      <MessageList
        isStreaming
        messages={messages([tool("t1"), tool("t2", "read"), tool("t3", "grep", "running")])}
        turns={{ t1: { startedAt: "2026-08-10T12:00:00.000Z", status: "running" } }}
      />
    );
    expect(screen.getAllByTestId("segment-row")).toHaveLength(3);
  });

  /**
   * `defaultOpen` only applies at mount, so a failure that lands after the group
   * is already on screen — the normal case while streaming — would otherwise
   * stay folded away.
   */
  it("opens itself when a call fails mid-run", () => {
    const { rerender } = renderList([tool("t1"), tool("t2", "read", "running")]);
    expect(screen.queryAllByTestId("segment-row")).toHaveLength(0);

    rerender(
      <MessageList
        isStreaming
        messages={messages([tool("t1"), tool("t2", "read", "errored")])}
        turns={{ t1: { startedAt: "2026-08-10T12:00:00.000Z", status: "running" } }}
      />
    );

    expect(screen.getByTestId("activity-group")).toHaveTextContent("1 failed");
    expect(screen.getAllByTestId("segment-row").length).toBeGreaterThan(0);
  });

  it("lets the reader close a failed group again", async () => {
    const user = userEvent.setup();
    renderList([tool("t1"), tool("t2", "bash", "errored")]);

    expect(screen.getAllByTestId("segment-row").length).toBeGreaterThan(0);
    await user.click(within(screen.getByTestId("activity-group")).getAllByRole("button")[0]!);
    // Opening it for you is a default, not a lock.
    expect(screen.queryAllByTestId("segment-row")).toHaveLength(0);
  });

  it("stays active while one call runs and another has already failed", () => {
    renderList([tool("t1", "bash", "errored"), tool("t2", "read", "running")]);
    const group = screen.getByTestId("activity-group");
    expect(group).toHaveAttribute("data-active", "true");
    expect(group).toHaveTextContent("Running 2 tools, 1 failed");
  });
});
