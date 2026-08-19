import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ChatBlock, ChatMessage } from "@artemis/core";
import { MessageList } from "../Conversation/MessageList";

const tool = (
  id: string,
  name = "bash",
  status: "running" | "completed" | "errored" = "completed",
  extra: Partial<Extract<ChatBlock, { type: "tool_call" }>> = {}
): ChatBlock => ({ id, name, status, type: "tool_call", ...extra });

function assistantWith(blocks: ChatBlock[]): ChatMessage[] {
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

function renderBlocks(blocks: ChatBlock[], isStreaming = false) {
  return render(
    <MessageList
      isStreaming={isStreaming}
      messages={assistantWith(blocks)}
      turns={{ t1: { startedAt: "2026-08-10T12:00:00.000Z", status: "running" } }}
    />
  );
}

describe("activity group in the transcript", () => {
  it("collapses a run of tool calls to a single summary line", () => {
    renderBlocks([tool("t1"), tool("t2", "read"), tool("t3", "grep")]);

    const group = screen.getByTestId("activity-group");
    expect(group).toHaveTextContent("Ran 3 tools");
    expect(group).toHaveTextContent("bash · read · grep");
    // The individual calls are not rendered until the group is opened.
    expect(screen.queryAllByTestId("segment-row")).toHaveLength(0);
  });

  it("expands to one row per call", async () => {
    const user = userEvent.setup();
    renderBlocks([tool("t1"), tool("t2", "read"), tool("t3", "grep")]);

    await user.click(within(screen.getByTestId("activity-group")).getAllByRole("button")[0]!);
    expect(screen.getAllByTestId("segment-row")).toHaveLength(3);
  });

  it("uses borderless rows inside the group, not nested cards", async () => {
    const user = userEvent.setup();
    renderBlocks([tool("t1"), tool("t2")]);

    await user.click(screen.getAllByRole("button")[0]!);
    const group = screen.getByTestId("activity-group");
    // One card: the group itself. The calls inside are rows.
    expect(within(group).getAllByTestId("segment-card")).toHaveLength(1);
    expect(within(group).getAllByTestId("segment-row")).toHaveLength(2);
  });

  it("shows a call's input and output from inside its row", async () => {
    const user = userEvent.setup();
    renderBlocks([
      tool("t1", "bash", "completed", { input: "ls -la", output: "3 files" }),
      tool("t2")
    ]);

    await user.click(screen.getAllByRole("button")[0]!);
    const row = screen.getAllByTestId("segment-row")[0]!;
    await user.click(within(row).getByRole("button"));
    expect(row).toHaveTextContent("ls -la");
    expect(row).toHaveTextContent("3 files");
  });

  /**
   * A failure inside a collapsed group is how a bug goes unnoticed. The group
   * says so on its header and opens itself.
   */
  it("never hides a failure behind a collapsed header", () => {
    renderBlocks([tool("t1"), tool("t2", "bash", "errored"), tool("t3")]);

    const group = screen.getByTestId("activity-group");
    expect(group).toHaveTextContent("1 failed");
    expect(within(group).getByTestId("segment-card")).toHaveAttribute(
      "data-tone",
      "destructive"
    );
    // Opened for you: the calls are visible without a click.
    expect(screen.getAllByTestId("segment-row").length).toBeGreaterThan(0);
  });

  it("ticks an elapsed on the header while the group is working", () => {
    renderBlocks([tool("t1"), tool("t2", "bash", "running")], true);

    const group = screen.getByTestId("activity-group");
    expect(group).toHaveTextContent("Running 2 tools");
    expect(within(group).getByTestId("group-elapsed")).toBeInTheDocument();
  });

  it("drops the heartbeat once the run finishes", () => {
    renderBlocks([tool("t1"), tool("t2")], true);
    expect(screen.queryByTestId("group-elapsed")).toBeNull();
  });

  it("leaves a lone tool call as its own segment", () => {
    renderBlocks([tool("t1")]);
    expect(screen.queryByTestId("activity-group")).toBeNull();
    expect(screen.getByTestId("segment-tool_call")).toBeInTheDocument();
  });

  it("keeps reasoning inline, outside the group", async () => {
    const user = userEvent.setup();
    renderBlocks([
      tool("t1"),
      tool("t2"),
      { id: "r1", status: "completed", text: "weighing it", type: "reasoning" },
      tool("t3"),
      tool("t4")
    ]);

    // Two groups with the reasoning between them, in order.
    expect(screen.getAllByTestId("activity-group")).toHaveLength(2);
    const reasoning = screen.getByTestId("segment-reasoning");
    await user.click(within(reasoning).getByRole("button"));
    expect(reasoning).toHaveTextContent("weighing it");
  });

  it("makes a thirty-call turn readable", () => {
    renderBlocks([
      { id: "intro", status: "completed", text: "Here is what I did.", type: "text" },
      ...Array.from({ length: 30 }, (_, index) => tool(`t${index}`)),
      { id: "outro", status: "completed", text: "Done.", type: "text" }
    ]);

    expect(screen.getAllByTestId("activity-group")).toHaveLength(1);
    expect(screen.getByTestId("activity-group")).toHaveTextContent("Ran 30 tools");
    // Nothing from the thirty calls is on screen until asked for.
    expect(screen.queryAllByTestId("segment-row")).toHaveLength(0);
  });
});
