import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@artemis/core";
import { App } from "../App";
import { createFakeHost } from "./fakeHost";

async function renderApp(host = createFakeHost()) {
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  return { host, user };
}

async function send(user: ReturnType<typeof userEvent.setup>, prompt: string) {
  await user.type(screen.getByRole("textbox", { name: /prompt/i }), prompt);
  await user.click(screen.getByRole("button", { name: /^run$/i }));
}

const at = (n: number) => `2026-08-10T12:00:0${n}.000Z`;

describe("streaming a turn", () => {
  it("renders the prompt and the reply as it arrives", async () => {
    const { user } = await renderApp();
    await send(user, "explain the scanner");

    const log = screen.getByRole("log", { name: /conversation/i });
    await waitFor(() => expect(log).toHaveTextContent("explain the scanner"));
    // Two deltas for one block must read as one continuous sentence.
    await waitFor(() => expect(log).toHaveTextContent("Reading the scanner."));
  });

  it("sends the prompt through the streaming API, not the one-shot launcher", async () => {
    const { host, user } = await renderApp();
    await send(user, "stream me");
    await waitFor(() => expect(host.streamed).toEqual(["stream me"]));
    expect(host.launches, "chat must not go through launchAgent").toHaveLength(0);
  });

  it("shows a stop control only while a turn is in flight", async () => {
    const host = createFakeHost();
    const { user } = await renderApp(host);
    expect(screen.queryByRole("button", { name: /stop/i })).toBeNull();

    await send(user, "long job");
    await screen.findByRole("button", { name: /stop/i });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /stop/i })).toBeNull()
    );
  });

  it("stopping asks the host to cancel and still ends the turn", async () => {
    // Holds the turn open so the click cannot race the stream to completion.
    const host = createFakeHost({ holdUntilCancelled: true });
    const cancel = vi.spyOn(host, "cancelChatTurn");
    const { user } = await renderApp(host);

    await send(user, "long job");
    await user.click(await screen.findByRole("button", { name: /stop/i }));

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    // The composer must return to a usable state rather than staying busy.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^run$/i })).toBeEnabled()
    );
  });

  it("renders reasoning and tool activity distinctly from the answer", async () => {
    const host = createFakeHost({
      streamScript: (turnId) => [
        [
          {
            id: `${turnId}-s`,
            sessionId: "chat-ws-artemis",
            timestamp: at(0),
            turnId,
            harnessId: "opencode",
            workspaceId: "ws-artemis",
            type: "turn.started"
          } satisfies RuntimeEvent
        ],
        [
          {
            id: `${turnId}-r`,
            sessionId: "chat-ws-artemis",
            timestamp: at(1),
            turnId,
            blockId: "r1",
            text: "weighing options",
            type: "reasoning.delta"
          } satisfies RuntimeEvent
        ],
        [
          {
            id: `${turnId}-t`,
            sessionId: "chat-ws-artemis",
            timestamp: at(1),
            turnId,
            blockId: "tool-1",
            name: "bash",
            input: "ls -la",
            type: "tool_call.started"
          } satisfies RuntimeEvent
        ],
        [
          {
            id: `${turnId}-tc`,
            sessionId: "chat-ws-artemis",
            timestamp: at(2),
            turnId,
            blockId: "tool-1",
            name: "bash",
            output: "3 files",
            type: "tool_call.completed"
          } satisfies RuntimeEvent
        ],
        [
          {
            id: `${turnId}-d`,
            sessionId: "chat-ws-artemis",
            timestamp: at(2),
            turnId,
            blockId: "b1",
            text: "Done.",
            type: "text.delta"
          } satisfies RuntimeEvent
        ],
        [
          {
            id: `${turnId}-done`,
            sessionId: "chat-ws-artemis",
            timestamp: at(3),
            turnId,
            type: "turn.completed"
          } satisfies RuntimeEvent
        ]
      ]
    });
    const { user } = await renderApp(host);
    await send(user, "go");

    const log = screen.getByRole("log", { name: /conversation/i });
    await waitFor(() => expect(log).toHaveTextContent("Done."));

    // M3 collapses reasoning behind a header; it is context, not the answer.
    const reasoning = within(log).getByTestId("segment-reasoning");
    expect(reasoning).not.toHaveTextContent("weighing options");
    await user.click(within(reasoning).getByRole("button"));
    expect(reasoning).toHaveTextContent("weighing options");
    const tool = within(log).getByTestId("segment-tool_call");
    expect(tool).toHaveTextContent("bash");
    expect(tool).toHaveAttribute("data-status", "completed");
  });

  it("surfaces a failed turn instead of silently stopping", async () => {
    const host = createFakeHost({
      streamScript: (turnId) => [
        [
          {
            id: `${turnId}-s`,
            sessionId: "chat-ws-artemis",
            timestamp: at(0),
            turnId,
            harnessId: "opencode",
            workspaceId: "ws-artemis",
            type: "turn.started"
          } satisfies RuntimeEvent
        ],
        [
          {
            id: `${turnId}-e`,
            sessionId: "chat-ws-artemis",
            timestamp: at(1),
            turnId,
            message: "OpenCode is out of credits.",
            type: "turn.errored"
          } satisfies RuntimeEvent
        ]
      ]
    });
    const { user } = await renderApp(host);
    await send(user, "go");

    await waitFor(() =>
      expect(screen.getByTestId("segment-error")).toHaveTextContent(
        "OpenCode is out of credits."
      )
    );
    expect(screen.getByRole("button", { name: /^run$/i })).toBeEnabled();
  });

  it("keeps earlier turns when a second prompt is sent", async () => {
    const { user } = await renderApp();
    await send(user, "first");
    await waitFor(() =>
      expect(screen.getByRole("log", { name: /conversation/i })).toHaveTextContent(
        "Reading the scanner."
      )
    );
    await send(user, "second");

    const log = screen.getByRole("log", { name: /conversation/i });
    await waitFor(() => expect(log).toHaveTextContent("second"));
    expect(log).toHaveTextContent("first");
  });

  it("reuses one chat session across turns rather than starting a new one", async () => {
    const host = createFakeHost();
    const create = vi.spyOn(host, "createChatSession");
    const { user } = await renderApp(host);

    await send(user, "one");
    await waitFor(() => expect(host.streamed).toHaveLength(1));
    await send(user, "two");
    await waitFor(() => expect(host.streamed).toHaveLength(2));

    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("replay", () => {
  it("rebuilds a recorded turn when the session is reopened", async () => {
    const recorded: RuntimeEvent[] = [
      {
        id: "r-s",
        sessionId: "chat-ws-artemis",
        timestamp: at(0),
        turnId: "t-old",
        harnessId: "opencode",
        workspaceId: "ws-artemis",
        type: "turn.started"
      },
      {
        id: "r-u",
        sessionId: "chat-ws-artemis",
        timestamp: at(0),
        turnId: "t-old",
        text: "what happened last time?",
        type: "user.message"
      },
      {
        id: "r-d",
        sessionId: "chat-ws-artemis",
        timestamp: at(1),
        turnId: "t-old",
        blockId: "b1",
        text: "This is the recorded answer.",
        type: "text.delta"
      },
      {
        id: "r-c",
        sessionId: "chat-ws-artemis",
        timestamp: at(2),
        turnId: "t-old",
        type: "turn.completed"
      }
    ];

    await renderApp(createFakeHost({ replay: recorded }));

    const log = screen.getByRole("log", { name: /conversation/i });
    await waitFor(() => expect(log).toHaveTextContent("This is the recorded answer."));
    expect(log).toHaveTextContent("what happened last time?");
    // A replayed turn is finished, so the composer is usable immediately.
    expect(screen.getByRole("button", { name: /^run$/i })).toBeEnabled();
  });

  it("shows the empty state when there is nothing recorded", async () => {
    await renderApp();
    expect(screen.getByTestId("conversation-empty")).toBeInTheDocument();
  });

  /**
   * Regression: the hook used to replay under the workspace id while the host
   * keyed its event log by the chat session id, so replay silently found
   * nothing in the real app. The fake host now honours the id it is given.
   */
  it("replays under the session id the host actually recorded", async () => {
    const host = createFakeHost();
    await renderApp(host);
    await waitFor(() => expect(host.replayedIds.length).toBeGreaterThan(0));
    expect(host.replayedIds).toContain("chat-ws-artemis");
    expect(host.replayedIds, "the workspace id is not the log key").not.toContain(
      "ws-artemis"
    );
  });
});
