import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@artemis/core";
import type { TurnRecord } from "../../chat/reduce";
import { MessageList } from "../Conversation/MessageList";
import { ReasoningSegment, ToolSegment } from "./BlockSegments";
import { TurnFooter } from "./TurnFooters";

function assistant(blocks: ChatMessage["blocks"], turnId = "t1"): ChatMessage {
  return {
    blocks,
    createdAt: "2026-08-10T12:00:00.000Z",
    id: `${turnId}-assistant`,
    role: "assistant",
    sessionId: "s1",
    turnId
  };
}

describe("ToolSegment summary", () => {
  it("surfaces the most identifying value from JSON input", () => {
    render(
      <ToolSegment
        block={{
          id: "b",
          input: '{"path":"src/scanner.rs","limit":40}',
          name: "read",
          status: "completed",
          type: "tool_call"
        }}
      />
    );
    // The path is what identifies the call; the object as a whole is unreadable
    // on one line.
    expect(screen.getByTestId("segment-tool_call")).toHaveTextContent(
      "src/scanner.rs"
    );
  });

  it("falls back to the first line when input is not JSON", () => {
    render(
      <ToolSegment
        block={{
          id: "b",
          input: "git status --porcelain\nsecond line",
          name: "bash",
          status: "completed",
          type: "tool_call"
        }}
      />
    );
    const tool = screen.getByTestId("segment-tool_call");
    expect(tool).toHaveTextContent("git status --porcelain");
    expect(tool).not.toHaveTextContent("second line");
  });

  it("truncates a long summary rather than wrapping the header", () => {
    render(
      <ToolSegment
        block={{
          id: "b",
          input: "x".repeat(400),
          name: "bash",
          status: "running",
          type: "tool_call"
        }}
      />
    );
    const summary = screen.getByTestId("segment-tool_call").textContent ?? "";
    expect(summary.length).toBeLessThan(200);
  });

  it("has no toggle when there is nothing but a name to show", () => {
    render(
      <ToolSegment
        block={{ id: "b", name: "noop", status: "running", type: "tool_call" }}
      />
    );
    // No input and no output: a chevron would open an empty box.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("carries the destructive tone when the call failed", () => {
    render(
      <ToolSegment
        block={{
          id: "b",
          name: "bash",
          output: "permission denied",
          status: "errored",
          type: "tool_call"
        }}
      />
    );
    expect(screen.getByTestId("segment-card")).toHaveAttribute(
      "data-tone",
      "destructive"
    );
  });
});

describe("ReasoningSegment", () => {
  it("starts collapsed", async () => {
    const user = userEvent.setup();
    render(<ReasoningSegment text="a long internal monologue" />);
    expect(screen.queryByText("a long internal monologue")).toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("a long internal monologue")).toBeInTheDocument();
  });
});

describe("TurnFooter", () => {
  it("formats durations over a minute", () => {
    render(
      <TurnFooter
        completedAt="2026-08-10T12:02:05.000Z"
        startedAt="2026-08-10T12:00:00.000Z"
      />
    );
    expect(screen.getByTestId("turn-footer")).toHaveTextContent("Worked for 2m 5s");
  });

  it("renders nothing when either end of the turn is unknown", () => {
    const { rerender } = render(<TurnFooter startedAt="2026-08-10T12:00:00.000Z" />);
    expect(screen.queryByTestId("turn-footer")).toBeNull();

    rerender(<TurnFooter completedAt="2026-08-10T12:00:00.000Z" />);
    expect(screen.queryByTestId("turn-footer")).toBeNull();
  });

  it("refuses to invent a duration from a negative interval", () => {
    render(
      <TurnFooter
        completedAt="2026-08-10T12:00:00.000Z"
        startedAt="2026-08-10T12:05:00.000Z"
      />
    );
    expect(screen.queryByTestId("turn-footer")).toBeNull();
  });
});

describe("live footer placement", () => {
  const running: Record<string, TurnRecord> = {
    t1: { startedAt: "2026-08-10T12:00:00.000Z", status: "running" }
  };

  /**
   * Regression: a log whose terminal event was never written replays as a turn
   * still marked "running". Rendering a ticking heartbeat for it animates work
   * that stopped long ago, and the elapsed was computed off the recorded
   * timestamp, so it read as tens of minutes on a freshly opened window.
   */
  it("does not animate a replayed unfinished turn", () => {
    render(
      <MessageList
        isStreaming={false}
        messages={[assistant([{ id: "b", status: "completed", text: "hi", type: "text" }])]}
        turns={running}
      />
    );
    expect(screen.queryByTestId("streaming-footer")).toBeNull();
    // Nor a duration, which is unknown for a turn that never ended.
    expect(screen.queryByTestId("turn-footer")).toBeNull();
  });

  it("animates only the turn that is actually streaming", () => {
    render(
      <MessageList
        isStreaming
        messages={[
          assistant([{ id: "a", status: "completed", text: "old", type: "text" }], "t1"),
          assistant([{ id: "b", status: "completed", text: "new", type: "text" }], "t2")
        ]}
        turns={{
          t1: {
            completedAt: "2026-08-10T12:00:04.000Z",
            startedAt: "2026-08-10T12:00:00.000Z",
            status: "completed"
          },
          t2: { startedAt: "2026-08-10T12:00:10.000Z", status: "running" }
        }}
      />
    );

    // One heartbeat, on the live turn; the earlier turn keeps its duration.
    expect(screen.getAllByTestId("streaming-footer")).toHaveLength(1);
    expect(screen.getByTestId("turn-footer")).toHaveTextContent("Worked for 4s");
  });

  it("gives the user's own message no footer", () => {
    render(
      <MessageList
        isStreaming
        messages={[
          {
            blocks: [{ id: "u", status: "completed", text: "ask", type: "text" }],
            createdAt: "2026-08-10T12:00:00.000Z",
            id: "t1-user",
            role: "user",
            sessionId: "s1",
            turnId: "t1"
          }
        ]}
        turns={running}
      />
    );
    expect(
      within(screen.getByTestId("message-user")).queryByTestId("streaming-footer")
    ).toBeNull();
  });
});
