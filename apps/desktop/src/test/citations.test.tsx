import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@artemis/core";
import { App } from "../App";
import { createFakeHost, type FakeHostOptions } from "./fakeHost";

const SESSION = "chat-ws-artemis";

function turnSaying(turnId: string, text: string): RuntimeEvent[][] {
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
        blockId: "text-0",
        id: `${turnId}-text`,
        text,
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

async function converse(text: string, options: FakeHostOptions = {}) {
  const host = createFakeHost({
    streamScript: (turnId) => turnSaying(turnId, text),
    ...options
  });
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
  await user.click(screen.getByRole("button", { name: /^run$/i }));
  const log = screen.getByRole("log", { name: /conversation/i });
  // Wait for the turn to finish, not merely for the chip to appear. Markdown
  // is re-parsed as text streams in, so a node grabbed mid-stream is replaced
  // before a click can land on it — which is a race in the test, not the app:
  // a reader clicks a settled transcript.
  await within(log).findByTestId("turn-header");
  await within(log).findByTestId("file-chip");
  return { host, log, user };
}

describe("a citation you can follow", () => {
  it("is a control, not just tinted text", async () => {
    const { log } = await converse("See AGENTS.md (line 7) for the handoff.");
    const chip = within(log).getByTestId("file-chip");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveAccessibleName(/AGENTS\.md/);
  });

  it("asks the host for the lines around the one cited", async () => {
    const { host, log, user } = await converse("See AGENTS.md (line 7).");
    await user.click(within(log).getByTestId("file-chip"));

    await waitFor(() => expect(host.peeked).toHaveLength(1));
    expect(host.peeked[0]).toMatchObject({
      line: 7,
      relativePath: "AGENTS.md",
      workspacePath: "/work/artemis"
    });
  });

  it("shows the file around the claim, with the cited line marked", async () => {
    const { log, user } = await converse("See AGENTS.md (line 7).");
    await user.click(within(log).getByTestId("file-chip"));

    const dialog = await screen.findByRole("dialog", { name: /AGENTS\.md/i });
    const lines = within(dialog).getAllByTestId("peek-line");
    expect(lines.length).toBeGreaterThan(1);

    const focused = lines.filter((line) => line.dataset.focused === "true");
    expect(focused, "exactly one line is the claim").toHaveLength(1);
    expect(focused[0]).toHaveTextContent("line 7");
  });

  it("numbers the lines so the window can be placed in the file", async () => {
    const { log, user } = await converse("See AGENTS.md (line 7).");
    await user.click(within(log).getByTestId("file-chip"));

    const dialog = await screen.findByRole("dialog", { name: /AGENTS\.md/i });
    expect(within(dialog).getByTestId("peek-range")).toHaveTextContent(/of 40/);
  });

  it("closes again", async () => {
    const { log, user } = await converse("See AGENTS.md (line 7).");
    await user.click(within(log).getByTestId("file-chip"));
    const dialog = await screen.findByRole("dialog", { name: /AGENTS\.md/i });
    await user.click(within(dialog).getByRole("button", { name: /close/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /AGENTS\.md/i })).toBeNull()
    );
  });

  it("opens a citation with no line number at the top of the file", async () => {
    const { host, log, user } = await converse("Edited config/app.json today.");
    await user.click(within(log).getByTestId("file-chip"));

    await waitFor(() => expect(host.peeked).toHaveLength(1));
    expect(host.peeked[0]?.line).toBeUndefined();
  });

  /**
   * The host refuses a file that has moved, a path that escapes, or a binary.
   * Each of those is a thing the reader needs told, not a dialog that opens
   * empty.
   */
  it("says why when the file cannot be read", async () => {
    const host = createFakeHost({
      streamScript: (turnId) => turnSaying(turnId, "See AGENTS.md (line 7).")
    });
    vi.spyOn(host, "peekFile").mockRejectedValueOnce(
      new Error("Could not find AGENTS.md. It may have been moved or deleted.")
    );
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    const log = screen.getByRole("log", { name: /conversation/i });
    await within(log).findByTestId("turn-header");
    await user.click(within(log).getByTestId("file-chip"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/moved or deleted/i);
  });

  /**
   * A stale citation — the line was removed by a later edit. The window still
   * opens so the file can be read, but nothing is highlighted as the claim.
   */
  it("highlights nothing when the cited line is gone", async () => {
    const { log, user } = await converse("See AGENTS.md (line 900).");
    await user.click(within(log).getByTestId("file-chip"));

    const dialog = await screen.findByRole("dialog", { name: /AGENTS\.md/i });
    expect(
      within(dialog).queryAllByTestId("peek-line").filter((l) => l.dataset.focused === "true")
    ).toHaveLength(0);
    expect(within(dialog).getByTestId("peek-stale")).toBeInTheDocument();
  });
});
