import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@artemis/core";
import { App } from "../App";
import { createFakeHost } from "./fakeHost";

const at = (seconds: number) =>
  `2026-08-10T12:00:${String(seconds).padStart(2, "0")}.000Z`;

const SESSION = "chat-ws-artemis";

function recordedTurn(): RuntimeEvent[] {
  return [
    {
      id: "s",
      sessionId: SESSION,
      timestamp: at(0),
      turnId: "t1",
      harnessId: "opencode",
      workspaceId: "ws-artemis",
      type: "turn.started"
    },
    {
      id: "u",
      sessionId: SESSION,
      timestamp: at(0),
      turnId: "t1",
      text: "explain the scanner",
      type: "user.message"
    },
    {
      id: "r",
      sessionId: SESSION,
      timestamp: at(1),
      turnId: "t1",
      blockId: "r1",
      text: "The scanner walks PATH.",
      type: "reasoning.delta"
    },
    {
      id: "t-start",
      sessionId: SESSION,
      timestamp: at(1),
      turnId: "t1",
      blockId: "tool-1",
      name: "read",
      input: '{"path":"scanner.rs"}',
      type: "tool_call.started"
    },
    {
      id: "t-done",
      sessionId: SESSION,
      timestamp: at(2),
      turnId: "t1",
      blockId: "tool-1",
      name: "read",
      output: "fn scan_harnesses() {}",
      type: "tool_call.completed"
    },
    {
      id: "d",
      sessionId: SESSION,
      timestamp: at(2),
      turnId: "t1",
      blockId: "b1",
      text: "## Summary\n\nIt resolves `PATH` entries.",
      type: "text.delta"
    },
    {
      id: "c",
      sessionId: SESSION,
      timestamp: at(27),
      turnId: "t1",
      type: "turn.completed"
    }
  ];
}

describe("transcript rendering", () => {
  it("renders the answer as markdown, not as escaped source", async () => {
    render(<App host={createFakeHost({ replay: recordedTurn() })} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument()
    );
    // The backticks must become a code element, not survive as literal text.
    expect(screen.getByText("PATH").tagName).toBe("CODE");
    // The user's prompt is a text block too, so scope to the reply.
    const assistant = within(screen.getByTestId("message-assistant"));
    expect(assistant.getByTestId("segment-text")).not.toHaveTextContent("##");
  });

  it("collapses reasoning behind a header", async () => {
    const user = userEvent.setup();
    render(<App host={createFakeHost({ replay: recordedTurn() })} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    const reasoning = await screen.findByTestId("segment-reasoning");
    expect(reasoning).not.toHaveTextContent("The scanner walks PATH.");

    await user.click(within(reasoning).getByRole("button"));
    expect(reasoning).toHaveTextContent("The scanner walks PATH.");
  });

  it("collapses a tool call to a one-line summary naming what ran", async () => {
    const user = userEvent.setup();
    render(<App host={createFakeHost({ replay: recordedTurn() })} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    const tool = await screen.findByTestId("segment-tool_call");
    expect(tool).toHaveTextContent("read");
    // Output stays folded away until asked for.
    expect(tool).not.toHaveTextContent("fn scan_harnesses()");

    await user.click(within(tool).getByRole("button"));
    expect(tool).toHaveTextContent("fn scan_harnesses()");
    expect(tool).toHaveTextContent('{"path":"scanner.rs"}');
  });

  it("shows how long a finished turn took", async () => {
    render(<App host={createFakeHost({ replay: recordedTurn() })} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    await waitFor(() =>
      expect(screen.getByTestId("turn-header")).toHaveTextContent("Worked for 27s")
    );
  });

  it("renders the user's prompt as a bordered box, not a bubble", async () => {
    render(<App host={createFakeHost({ replay: recordedTurn() })} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    const user = await screen.findByTestId("message-user");
    expect(user).toHaveTextContent("explain the scanner");
  });
});

describe("streaming state", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a working verb and a ticking elapsed while a turn runs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const host = createFakeHost({ holdUntilCancelled: true });
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    const footer = await screen.findByTestId("streaming-footer");
    expect(footer).toHaveTextContent(/\w+…/);
    expect(footer).toHaveTextContent("0s");

    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() => expect(footer).toHaveTextContent("3s"));

    await user.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() =>
      expect(screen.queryByTestId("streaming-footer")).toBeNull()
    );
  });

  it("marks a running tool call as running", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const host = createFakeHost({
      holdUntilCancelled: true,
      streamScript: (turnId) => [
        [
          {
            id: `${turnId}-s`,
            sessionId: SESSION,
            timestamp: at(0),
            turnId,
            harnessId: "opencode",
            workspaceId: "ws-artemis",
            type: "turn.started"
          },
          {
            id: `${turnId}-t`,
            sessionId: SESSION,
            timestamp: at(0),
            turnId,
            blockId: "tool-1",
            name: "bash",
            input: "sleep 30",
            type: "tool_call.started"
          }
        ]
      ]
    });
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    const tool = await screen.findByTestId("segment-tool_call");
    await waitFor(() => expect(tool).toHaveAttribute("data-status", "running"));

    await user.click(screen.getByRole("button", { name: /stop/i }));
  });
});
