import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@artemis/core";
import { App } from "../App";
import { createFakeHost, type FakeHostOptions } from "./fakeHost";

const SESSION = "chat-ws-artemis";

function turn(
  turnId: string,
  parts: {
    text?: string;
    tools?: Array<{ input: string; name: string }>;
  }
): RuntimeEvent[][] {
  const base = { sessionId: SESSION, turnId };
  const batches: RuntimeEvent[][] = [
    [
      {
        ...base,
        harnessId: "opencode",
        id: `${turnId}-start`,
        timestamp: "2026-08-11T09:31:00.000Z",
        type: "turn.started",
        workspaceId: "ws-artemis"
      }
    ]
  ];

  for (const [index, call] of (parts.tools ?? []).entries()) {
    batches.push([
      {
        ...base,
        blockId: `tool-${index}`,
        id: `${turnId}-tool-${index}`,
        input: call.input,
        name: call.name,
        timestamp: "2026-08-11T09:31:30.000Z",
        type: "tool_call.started"
      },
      {
        ...base,
        blockId: `tool-${index}`,
        id: `${turnId}-tool-${index}-done`,
        name: call.name,
        output: "ok",
        timestamp: "2026-08-11T09:31:40.000Z",
        type: "tool_call.completed"
      }
    ]);
  }

  if (parts.text) {
    batches.push([
      {
        ...base,
        blockId: "text-0",
        id: `${turnId}-text`,
        text: parts.text,
        timestamp: "2026-08-11T09:32:00.000Z",
        type: "text.delta"
      }
    ]);
  }

  batches.push([
    {
      ...base,
      id: `${turnId}-done`,
      // 2m 24s after the start, which the header should say in those words.
      timestamp: "2026-08-11T09:33:24.000Z",
      type: "turn.completed"
    }
  ]);

  return batches;
}

/**
 * Put a prompt in the composer and run it.
 *
 * Pasted rather than typed. `user.type` simulates every keystroke, so the
 * 40-line prompt in the truncation test cost several hundred of them, each with
 * its own React render: 645ms here and over the 5s limit on a Windows runner,
 * where it was the one test in 325 that failed. Nothing in this file asserts
 * anything about typing; pasting a long prompt is also what a person does.
 */
async function converse(prompt: string, options: FakeHostOptions = {}) {
  const host = createFakeHost(options);
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  await user.click(screen.getByRole("textbox", { name: /prompt/i }));
  await user.paste(prompt);
  await user.click(screen.getByRole("button", { name: /^run$/i }));
  const log = screen.getByRole("log", { name: /conversation/i });
  return { host, log, user };
}

describe("the user's prompt", () => {
  it("carries the time it was sent", async () => {
    const { log } = await converse("what changed?");
    await waitFor(() => expect(log).toHaveTextContent("what changed?"));
    expect(
      within(screen.getByTestId("message-user")).getByTestId("message-time")
    ).toBeInTheDocument();
  });

  it("can be copied", async () => {
    const { user } = await converse("copy me exactly");
    const message = await screen.findByTestId("message-user");
    await user.click(within(message).getByRole("button", { name: /copy/i }));
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe("copy me exactly")
    );
  });

  it("collapses a long prompt behind Show more", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const { user } = await converse(long);
    const message = await screen.findByTestId("message-user");

    const body = within(message).getByTestId("truncatable");
    expect(body).toHaveAttribute("data-expanded", "false");

    await user.click(within(message).getByRole("button", { name: /show more/i }));
    expect(body).toHaveAttribute("data-expanded", "true");
    expect(
      within(message).getByRole("button", { name: /show less/i })
    ).toBeInTheDocument();
  });

  it("leaves a short prompt alone", async () => {
    await converse("short");
    const message = await screen.findByTestId("message-user");
    expect(within(message).queryByRole("button", { name: /show more/i })).toBeNull();
  });
});

describe("the turn header", () => {
  it("says how long the turn took", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) => turn(turnId, { text: "Done." })
    });
    await waitFor(() =>
      expect(within(log).getByTestId("turn-header")).toHaveTextContent(
        /worked for 2m 24s/i
      )
    );
  });

  it("folds the mechanics away on request, and never the answer", async () => {
    const { log, user } = await converse("go", {
      streamScript: (turnId) =>
        turn(turnId, {
          text: "The answer.",
          tools: [{ input: '{"path":"a.ts"}', name: "read" }]
        })
    });

    const header = await within(log).findByTestId("turn-header");
    await waitFor(() => expect(log).toHaveTextContent("The answer."));
    expect(within(log).getByTestId("segment-tool_call")).toBeInTheDocument();

    await user.click(header);
    expect(within(log).queryByTestId("segment-tool_call")).toBeNull();
    expect(log, "the answer survives collapsing").toHaveTextContent("The answer.");
  });
});

describe("file references in prose", () => {
  it("renders a cited file and line as a chip", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) =>
        turn(turnId, { text: "See AGENTS.md (line 7) for the handoff." })
    });

    const chip = await within(log).findByTestId("file-chip");
    expect(chip).toHaveTextContent("AGENTS.md");
    expect(chip).toHaveTextContent("line 7");
  });

  it("gives a shell script a different icon from a document", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) =>
        turn(turnId, { text: "Run bootstrap.sh (line 8) after AGENTS.md (line 1)." })
    });

    const chips = await within(log).findAllByTestId("file-chip");
    expect(chips.map((chip) => chip.getAttribute("data-kind"))).toEqual([
      "shell",
      "doc"
    ]);
  });

  it("renders inline code as a pill, distinct from a citation", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) => turn(turnId, { text: "Run `git diff --check` first." })
    });
    await waitFor(() =>
      expect(within(log).getByTestId("code-pill")).toHaveTextContent("git diff --check")
    );
  });
});

describe("the edit summary", () => {
  const edits = [
    {
      input: JSON.stringify({ content: "a", filePath: "AGENTS.md" }),
      name: "write"
    },
    {
      input: JSON.stringify({
        filePath: "MIGRATION_HANDOFF.md",
        newString: "x\ny\nz",
        oldString: ""
      }),
      name: "edit"
    }
  ];

  it("summarises what the agent edited", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) => turn(turnId, { text: "Done.", tools: edits })
    });

    const card = await within(log).findByTestId("edit-summary");
    expect(card).toHaveTextContent(/edited 2 files/i);
    expect(within(card).getByTestId("edit-total")).toHaveTextContent("+4");
    expect(within(card).getByTestId("edit-total")).toHaveTextContent("-0");
  });

  it("lists each file with its own counts", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) => turn(turnId, { text: "Done.", tools: edits })
    });

    const rows = await within(await within(log).findByTestId("edit-summary")).findAllByTestId(
      "edit-row"
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("AGENTS.md");
    expect(rows[0]).toHaveTextContent("+1");
  });

  it("stays out of the way when the turn edited nothing", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) =>
        turn(turnId, { text: "Nothing to do.", tools: [{ input: "{}", name: "read" }] })
    });
    await waitFor(() => expect(log).toHaveTextContent("Nothing to do."));
    expect(within(log).queryByTestId("edit-summary")).toBeNull();
  });

  /** Undo and Review are M8b. Shipping them dead would be worse than absent. */
  it("does not offer buttons that do nothing yet", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) => turn(turnId, { text: "Done.", tools: edits })
    });
    const card = await within(log).findByTestId("edit-summary");
    expect(within(card).queryByRole("button", { name: /undo|review/i })).toBeNull();
  });
});

describe("the assistant footer", () => {
  it("offers copy and fork, and says when it finished", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) => turn(turnId, { text: "Done." })
    });

    const footer = await within(log).findByTestId("turn-actions");
    expect(within(footer).getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: /fork/i })).toBeInTheDocument();
    expect(within(footer).getByTestId("message-time")).toBeInTheDocument();
  });

  it("copies the answer without the mechanics around it", async () => {
    const { user, log } = await converse("go", {
      streamScript: (turnId) =>
        turn(turnId, {
          text: "The answer.",
          tools: [{ input: '{"path":"a.ts"}', name: "read" }]
        })
    });

    const footer = await within(log).findByTestId("turn-actions");
    await user.click(within(footer).getByRole("button", { name: /copy/i }));
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe("The answer.")
    );
  });

  it("forking asks the host to branch at that turn", async () => {
    const { host, log, user } = await converse("go", {
      streamScript: (turnId) => turn(turnId, { text: "Done." })
    });

    const footer = await within(log).findByTestId("turn-actions");
    await user.click(within(footer).getByRole("button", { name: /fork/i }));

    await waitFor(() => expect(host.forks).toHaveLength(1));
    expect(host.forks[0]).toEqual({
      sessionId: SESSION,
      throughTurnId: "turn-1"
    });
  });

  /** The user was explicit: satisfaction tracing is not wanted. */
  it("has no rating controls", async () => {
    const { log } = await converse("go", {
      streamScript: (turnId) => turn(turnId, { text: "Done." })
    });
    await within(log).findByTestId("turn-actions");
    expect(
      within(log).queryByRole("button", { name: /thumbs|helpful|rate/i })
    ).toBeNull();
  });
});
