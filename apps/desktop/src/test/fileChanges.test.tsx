import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileChange, RuntimeEvent } from "@artemis/core";
import { App } from "../App";
import { createFakeHost, type FakeHostOptions } from "./fakeHost";

const SESSION = "chat-ws-artemis";

const SEED_PATCH = `Index: /work/artemis/seed.txt
===================================================================
--- /work/artemis/seed.txt
+++ /work/artemis/seed.txt
@@ -1,3 +1,4 @@
 alpha
 beta
 gamma
+delta
`;

const NOTES_PATCH = `@@ -0,0 +1,2 @@
+- one
+- two
`;

const EDITED: FileChange[] = [
  { additions: 1, deletions: 0, patch: SEED_PATCH, path: "seed.txt" },
  { additions: 2, deletions: 0, patch: NOTES_PATCH, path: "notes.md" }
];

function turnThatEdits(
  turnId: string,
  fileChanges: FileChange[] = EDITED
): RuntimeEvent[][] {
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
        fileChanges,
        id: `${turnId}-tool`,
        input: JSON.stringify({ patchText: "*** Begin Patch" }),
        name: "apply_patch",
        output: "Success.",
        timestamp: "2026-08-11T09:31:40.000Z",
        type: "tool_call.completed"
      }
    ],
    [
      {
        ...base,
        blockId: "text-0",
        id: `${turnId}-text`,
        text: "Done.",
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

async function converse(options: FakeHostOptions = {}) {
  const host = createFakeHost({
    streamScript: (turnId) => turnThatEdits(turnId),
    ...options
  });
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
  await user.click(screen.getByRole("button", { name: /^run$/i }));
  const card = await screen.findByTestId("edit-summary");
  return { card, host, user };
}

describe("the inline diff", () => {
  it("opens a file's diff from its row", async () => {
    const { card, user } = await converse();
    expect(within(card).queryByTestId("diff-view")).toBeNull();

    const rows = within(card).getAllByTestId("edit-row");
    await user.click(within(rows[0]!).getByRole("button", { name: /seed\.txt/i }));

    const diff = within(card).getByTestId("diff-view");
    expect(diff).toHaveTextContent("delta");
    expect(diff).toHaveTextContent("alpha");
  });

  it("marks additions and removals so they are not read as plain text", async () => {
    const { card, user } = await converse();
    const rows = within(card).getAllByTestId("edit-row");
    await user.click(within(rows[0]!).getByRole("button", { name: /seed\.txt/i }));

    const lines = within(card).getAllByTestId("diff-line");
    const added = lines.filter((line) => line.dataset.kind === "added");
    expect(added).toHaveLength(1);
    expect(added[0]).toHaveTextContent("delta");
    expect(lines.filter((line) => line.dataset.kind === "context")).toHaveLength(3);
  });

  it("closes again", async () => {
    const { card, user } = await converse();
    const row = within(card).getAllByTestId("edit-row")[0]!;
    await user.click(within(row).getByRole("button", { name: /seed\.txt/i }));
    await user.click(within(row).getByRole("button", { name: /seed\.txt/i }));
    expect(within(card).queryByTestId("diff-view")).toBeNull();
  });

  /** A harness that reports counts but no diff should not offer an empty view. */
  it("does not offer a diff it does not have", async () => {
    const { card } = await converse({
      streamScript: (turnId) =>
        turnThatEdits(turnId, [{ additions: 1, deletions: 0, path: "opaque.bin" }])
    });
    const row = within(card).getAllByTestId("edit-row")[0]!;
    expect(within(row).queryByRole("button", { name: /opaque/i })).toBeNull();
    expect(row).toHaveTextContent("opaque.bin");
  });
});

describe("undo", () => {
  it("asks the host to reverse that file's patch", async () => {
    const { card, host, user } = await converse();
    const row = within(card).getAllByTestId("edit-row")[0]!;

    await user.click(within(row).getByRole("button", { name: /undo/i }));

    await waitFor(() => expect(host.reverted).toHaveLength(1));
    expect(host.reverted[0]).toEqual({
      patch: SEED_PATCH,
      relativePath: "seed.txt",
      workspacePath: "/work/artemis"
    });
  });

  it("marks the row as undone rather than leaving it looking pending", async () => {
    const { card, user } = await converse();
    const row = within(card).getAllByTestId("edit-row")[0]!;
    await user.click(within(row).getByRole("button", { name: /undo/i }));

    await waitFor(() => expect(row).toHaveAttribute("data-reverted", "true"));
    expect(within(row).queryByRole("button", { name: /^undo$/i })).toBeNull();
  });

  it("leaves the other files alone", async () => {
    const { card, host, user } = await converse();
    const rows = within(card).getAllByTestId("edit-row");
    await user.click(within(rows[0]!).getByRole("button", { name: /undo/i }));

    await waitFor(() => expect(host.reverted).toHaveLength(1));
    expect(rows[1]).not.toHaveAttribute("data-reverted", "true");
    expect(within(rows[1]!).getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  /**
   * The host refuses when the file has moved on. That refusal is the whole
   * safety property, so it has to reach the user rather than fail silently.
   */
  it("surfaces a refusal instead of pretending it worked", async () => {
    const host = createFakeHost({ streamScript: (turnId) => turnThatEdits(turnId) });
    vi.spyOn(host, "revertFileChange").mockRejectedValueOnce(
      new Error("This edit no longer matches the file, so it was not undone.")
    );
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "go");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    const card = await screen.findByTestId("edit-summary");
    const row = within(card).getAllByTestId("edit-row")[0]!;
    await user.click(within(row).getByRole("button", { name: /undo/i }));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      /no longer matches/i
    );
    expect(row).not.toHaveAttribute("data-reverted", "true");
    expect(
      within(row).getByRole("button", { name: /undo/i }),
      "a failed undo stays available to retry"
    ).toBeInTheDocument();
  });

  it("is absent when there is no patch to reverse", async () => {
    const { card } = await converse({
      streamScript: (turnId) =>
        turnThatEdits(turnId, [{ additions: 1, deletions: 0, path: "opaque.bin" }])
    });
    const row = within(card).getAllByTestId("edit-row")[0]!;
    expect(within(row).queryByRole("button", { name: /undo/i })).toBeNull();
  });
});

describe("review", () => {
  it("opens the whole change set at once", async () => {
    const { card, user } = await converse();
    await user.click(within(card).getByRole("button", { name: /review/i }));

    const dialog = await screen.findByRole("dialog", { name: /changes/i });
    expect(within(dialog).getAllByTestId("diff-view")).toHaveLength(2);
    expect(dialog).toHaveTextContent("seed.txt");
    expect(dialog).toHaveTextContent("notes.md");
    expect(dialog).toHaveTextContent("delta");
  });

  it("closes without touching anything", async () => {
    const { card, host, user } = await converse();
    await user.click(within(card).getByRole("button", { name: /review/i }));
    const dialog = await screen.findByRole("dialog", { name: /changes/i });
    await user.click(within(dialog).getByRole("button", { name: /close/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /changes/i })).toBeNull()
    );
    expect(host.reverted).toHaveLength(0);
  });
});
