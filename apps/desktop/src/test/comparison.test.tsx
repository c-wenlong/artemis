import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeHost, type FakeHostOptions } from "./fakeHost";

/**
 * The wedge: one prompt, three harnesses, three diffs, one kept.
 *
 * The destructive half is what most of this file is about. Keeping one answer
 * throws away the others' uncommitted work and there is no undo, so the UI must
 * name what it is about to destroy and must never do it by accident.
 */
async function compare(prompt = "add retries", options: FakeHostOptions = {}) {
  const host = createFakeHost(options);
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });

  await user.click(screen.getByRole("button", { name: /compare/i }));
  const dialog = await screen.findByRole("dialog", { name: /compare/i });
  return { dialog, host, prompt, user };
}

async function runComparison(
  harnesses: RegExp[] = [/opencode/i, /claude code/i],
  options: FakeHostOptions = {}
) {
  const { dialog, host, user } = await compare("add retries", options);
  for (const label of harnesses) {
    await user.click(within(dialog).getByRole("checkbox", { name: label }));
  }
  await user.type(within(dialog).getByRole("textbox", { name: /prompt/i }), "add retries");
  await user.click(within(dialog).getByRole("button", { name: /^start/i }));
  return { host, user };
}

describe("setting up a comparison", () => {
  it("offers the harnesses that can be compared", async () => {
    const { dialog } = await compare();
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(1);
    // Amp has no adapter, so its output cannot be rendered as a diff-bearing
    // transcript alongside the others.
    expect(within(dialog).queryByRole("checkbox", { name: /amp/i })).toBeNull();
  });

  it("will not start without at least two harnesses", async () => {
    const { dialog, user } = await compare();
    await user.type(within(dialog).getByRole("textbox", { name: /prompt/i }), "go");
    expect(within(dialog).getByRole("button", { name: /^start/i })).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox", { name: /opencode/i }));
    expect(
      within(dialog).getByRole("button", { name: /^start/i }),
      "one harness is not a comparison"
    ).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox", { name: /claude code/i }));
    expect(within(dialog).getByRole("button", { name: /^start/i })).toBeEnabled();
  });

  it("will not start without a prompt", async () => {
    const { dialog, user } = await compare();
    await user.click(within(dialog).getByRole("checkbox", { name: /opencode/i }));
    await user.click(within(dialog).getByRole("checkbox", { name: /claude code/i }));
    expect(within(dialog).getByRole("button", { name: /^start/i })).toBeDisabled();
  });

  it("asks the host for one worktree per harness", async () => {
    const { host } = await runComparison();
    await waitFor(() => expect(host.comparisons).toHaveLength(1));
    expect(host.comparisons[0]).toMatchObject({
      harnessIds: ["opencode", "claude"],
      projectId: "artemis",
      prompt: "add retries"
    });
  });

  it("sends the same prompt to every harness", async () => {
    const { host } = await runComparison();
    await waitFor(() => expect(host.streamed).toHaveLength(2));
    expect(new Set(host.streamed)).toEqual(new Set(["add retries"]));
  });
});

describe("reading the results", () => {
  it("gives each harness its own tab", async () => {
    await runComparison([/opencode/i, /claude code/i]);
    const tabs = await screen.findAllByTestId("comparison-tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      expect.stringMatching(/opencode/i),
      expect.stringMatching(/claude/i)
    ]);
  });

  it("shows a harness that could not start, rather than dropping it", async () => {
    await runComparison([/opencode/i, /claude code/i], {
      comparisonEntryErrors: { claude: "branch already checked out" }
    });

    const tabs = await screen.findAllByTestId("comparison-tab");
    expect(tabs).toHaveLength(2);
    const failed = tabs.find((tab) => /claude/i.test(tab.textContent ?? ""))!;
    expect(failed).toHaveAttribute("data-failed", "true");
  });

  it("switches between answers", async () => {
    const { user } = await runComparison();
    const tabs = await screen.findAllByTestId("comparison-tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    await user.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
  });
});

describe("keeping one answer", () => {
  it("names what will be discarded before doing it", async () => {
    const { user } = await runComparison();
    await user.click(await screen.findByRole("button", { name: /keep this/i }));

    const confirm = await screen.findByRole("dialog", { name: /keep/i });
    expect(confirm).toHaveTextContent(/claude/i);
    expect(confirm, "the user must be told this cannot be undone").toHaveTextContent(
      /cannot be undone|permanently|discard/i
    );
  });

  it("does nothing until it is confirmed", async () => {
    const { host, user } = await runComparison();
    await user.click(await screen.findByRole("button", { name: /keep this/i }));
    const confirm = await screen.findByRole("dialog", { name: /keep/i });
    await user.click(within(confirm).getByRole("button", { name: /cancel/i }));

    expect(host.resolved).toHaveLength(0);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /keep/i })).toBeNull()
    );
  });

  it("keeps the harness whose tab is open", async () => {
    const { host, user } = await runComparison();
    const tabs = await screen.findAllByTestId("comparison-tab");
    await user.click(tabs[1]!);

    await user.click(screen.getByRole("button", { name: /keep this/i }));
    const confirm = await screen.findByRole("dialog", { name: /keep/i });
    await user.click(within(confirm).getByRole("button", { name: /^keep/i }));

    await waitFor(() => expect(host.resolved).toHaveLength(1));
    expect(host.resolved[0]?.winner).toBe("cmp-run-claude");
  });

  it("surfaces a refusal rather than looking like it worked", async () => {
    const host = createFakeHost();
    vi.spyOn(host, "resolveComparison").mockRejectedValueOnce(
      new Error("That run is not part of this comparison.")
    );
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await user.click(screen.getByRole("button", { name: /compare/i }));
    const dialog = await screen.findByRole("dialog", { name: /compare/i });
    await user.click(within(dialog).getByRole("checkbox", { name: /opencode/i }));
    await user.click(within(dialog).getByRole("checkbox", { name: /claude code/i }));
    await user.type(within(dialog).getByRole("textbox", { name: /prompt/i }), "go");
    await user.click(within(dialog).getByRole("button", { name: /^start/i }));

    await user.click(await screen.findByRole("button", { name: /keep this/i }));
    const confirm = await screen.findByRole("dialog", { name: /keep/i });
    await user.click(within(confirm).getByRole("button", { name: /^keep/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not part of/i);
  });

  it("can discard every answer", async () => {
    const { host, user } = await runComparison();
    await user.click(await screen.findByRole("button", { name: /discard all/i }));
    const confirm = await screen.findByRole("dialog", { name: /discard/i });
    await user.click(within(confirm).getByRole("button", { name: /^discard/i }));

    await waitFor(() => expect(host.abandoned).toEqual(["cmp-run"]));
  });
});
