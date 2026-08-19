import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent, RuntimeSettings } from "@artemis/core";
import { App } from "../App";
import { createFakeHost, type FakeHostOptions } from "./fakeHost";

const SESSION = "chat-ws-artemis";

/** A turn with a tool call and an answer: enough to have both to hide. */
function turn(turnId: string): RuntimeEvent[][] {
  const base = { sessionId: SESSION, turnId };
  return [
    [
      {
        ...base,
        harnessId: "opencode",
        id: `${turnId}-start`,
        timestamp: "2026-08-11T09:31:00.000Z",
        type: "turn.started",
        workspaceId: "ws-artemis"
      }
    ],
    [
      {
        ...base,
        blockId: "tool-0",
        id: `${turnId}-tool`,
        input: JSON.stringify({ command: "ls -la" }),
        name: "bash",
        output: "total 8",
        timestamp: "2026-08-11T09:31:40.000Z",
        type: "tool_call.completed"
      }
    ],
    [
      {
        ...base,
        blockId: "text-0",
        id: `${turnId}-text`,
        text: "The answer.",
        timestamp: "2026-08-11T09:32:00.000Z",
        type: "text.delta"
      }
    ],
    [
      {
        ...base,
        id: `${turnId}-done`,
        timestamp: "2026-08-11T09:33:24.000Z",
        type: "turn.completed"
      }
    ]
  ];
}

async function converse(settings: RuntimeSettings, options: FakeHostOptions = {}) {
  const host = createFakeHost({
    settings,
    streamScript: (turnId) => turn(turnId),
    ...options
  });
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
  await user.click(screen.getByRole("button", { name: /^run$/i }));
  const log = screen.getByRole("log", { name: /conversation/i });
  await within(log).findByTestId("turn-header");
  return { host, log, user };
}

async function openDeveloper() {
  const host = createFakeHost();
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  await user.click(screen.getByRole("button", { name: /settings/i }));
  const dialog = await screen.findByRole("dialog", { name: /settings/i });
  await user.click(within(dialog).getByRole("tab", { name: /developer/i }));
  return { dialog, host, user };
}

describe("the developer tab", () => {
  it("sits alongside the other settings sections", async () => {
    const host = createFakeHost();
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await user.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });

    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["General", "Appearance", "Developer"]);
  });

  it("shows everything by default", async () => {
    const { dialog } = await openDeveloper();
    expect(
      within(dialog).getByRole("radio", { name: /everything/i })
    ).toBeChecked();
  });

  it("saves the choice", async () => {
    const { dialog, host, user } = await openDeveloper();
    await user.click(within(dialog).getByRole("radio", { name: /output only/i }));
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(host.savedSettings).toHaveLength(1));
    expect(host.savedSettings[0]?.transcriptVerbosity).toBe("output");
  });

  it("reflects what is already stored", async () => {
    const host = createFakeHost({ settings: { transcriptVerbosity: "output" } });
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await user.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    await user.click(within(dialog).getByRole("tab", { name: /developer/i }));

    expect(
      within(dialog).getByRole("radio", { name: /output only/i })
    ).toBeChecked();
  });

  it("keeps the Quiver CLI off unless it is chosen", async () => {
    const { dialog } = await openDeveloper();
    const toggle = within(dialog).getByRole("checkbox", { name: /quiver/i });
    expect(toggle).not.toBeChecked();
  });

  it("saves turning the Quiver CLI on", async () => {
    const { dialog, host, user } = await openDeveloper();
    await user.click(within(dialog).getByRole("checkbox", { name: /quiver/i }));
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(host.savedSettings).toHaveLength(1));
    expect(host.savedSettings[0]?.quiverCliEnabled).toBe(true);
  });

  /**
   * Reading Quiver's files is free and unconditional; running its Python is
   * what the toggle governs. Saying so stops the setting reading as "use
   * Quiver at all".
   */
  it("says that only the subprocess is optional", async () => {
    const { dialog } = await openDeveloper();
    expect(within(dialog).getByTestId("quiver-note")).toHaveTextContent(
      /file|read/i
    );
  });

  /** It governs what is kept in view, which is worth saying out loud. */
  it("explains the cost, not just the appearance", async () => {
    const { dialog } = await openDeveloper();
    expect(within(dialog).getByTestId("verbosity-note")).toHaveTextContent(
      /context/i
    );
  });
});

describe("what the transcript renders", () => {
  it("shows the tool trace when set to everything", async () => {
    const { log } = await converse({ transcriptVerbosity: "full" });
    expect(within(log).getByTestId("segment-tool_call")).toBeInTheDocument();
    expect(log).toHaveTextContent("The answer.");
  });

  it("folds the trace away when set to output only", async () => {
    const { log } = await converse({ transcriptVerbosity: "output" });
    expect(within(log).queryByTestId("segment-tool_call")).toBeNull();
    expect(log, "the answer is never what gets hidden").toHaveTextContent(
      "The answer."
    );
  });

  it("still lets a folded turn be opened", async () => {
    const { log, user } = await converse({ transcriptVerbosity: "output" });
    await user.click(within(log).getByTestId("turn-header"));
    expect(within(log).getByTestId("segment-tool_call")).toBeInTheDocument();
  });

  /** An older settings file has no opinion, and must not start hiding output. */
  it("shows everything when the setting has never been chosen", async () => {
    const { log } = await converse({});
    expect(within(log).getByTestId("segment-tool_call")).toBeInTheDocument();
  });

  /**
   * A running turn keeps showing its work even on "output only". The streaming
   * footer is otherwise the only sign of life during a long tool sequence, and
   * the header that would open it does not exist until the turn ends. It folds
   * when the turn finishes, which is when the trace stops being news.
   */
  it("does not blind a running turn", async () => {
    const host = createFakeHost({
      holdUntilCancelled: true,
      settings: { transcriptVerbosity: "output" },
      streamScript: (turnId) => turn(turnId)
    });
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    const log = screen.getByRole("log", { name: /conversation/i });
    await waitFor(() =>
      expect(within(log).getByTestId("segment-tool_call")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() =>
      expect(within(log).queryByTestId("segment-tool_call")).toBeNull()
    );
  });

  it("takes effect without reopening the session", async () => {
    const host = createFakeHost({
      settings: { transcriptVerbosity: "full" },
      streamScript: (turnId) => turn(turnId)
    });
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    const log = screen.getByRole("log", { name: /conversation/i });
    await within(log).findByTestId("turn-header");
    expect(within(log).getByTestId("segment-tool_call")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    await user.click(within(dialog).getByRole("tab", { name: /developer/i }));
    await user.click(within(dialog).getByRole("radio", { name: /output only/i }));
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(within(log).queryByTestId("segment-tool_call")).toBeNull()
    );
  });
});
