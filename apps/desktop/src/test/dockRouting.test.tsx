import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { createFakeHost, fakeInventory } from "./fakeHost";

/**
 * The second half of M11's exit criterion. Three harnesses render as segments;
 * the fourth still works, in the dock.
 *
 * A harness Artemis cannot parse is not broken: it is a terminal. What must
 * not happen is launching it as a transcript, which streams a page of
 * unrendered JSON into the conversation.
 */
async function pick(label: RegExp) {
  const host = createFakeHost();
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });

  const harness = screen.getByRole("combobox", { name: /harness/i });
  const option = within(harness)
    .getAllByRole("option")
    .find((candidate) => label.test(candidate.textContent ?? ""));
  await user.selectOptions(harness, option!);
  return { host, user };
}

describe("routing a harness that cannot stream", () => {
  it("says so instead of offering a transcript", async () => {
    await pick(/amp/i);
    expect(await screen.findByTestId("dock-only-notice")).toHaveTextContent(
      /terminal/i
    );
  });

  it("offers to open it in the dock", async () => {
    const { host, user } = await pick(/amp/i);
    await user.click(
      await screen.findByRole("button", { name: /open in terminal/i })
    );

    await waitFor(() => expect(host.terminals).toHaveLength(1));
    expect(host.terminals[0]?.cwd).toBe("/work/artemis");
  });

  /** Launching it as a transcript is the failure this exists to prevent. */
  it("never starts a streamed turn for it", async () => {
    const { host, user } = await pick(/amp/i);
    const composer = screen.queryByRole("textbox", { name: /prompt/i });
    if (composer) {
      await user.type(composer, "do something");
      const run = screen.queryByRole("button", { name: /^run$/i });
      if (run) await user.click(run);
    }
    await waitFor(() => expect(host.streamed).toHaveLength(0));
  });

  it("leaves an adapted harness alone", async () => {
    const { host, user } = await pick(/opencode/i);
    expect(screen.queryByTestId("dock-only-notice")).toBeNull();

    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "hello");
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => expect(host.streamed).toEqual(["hello"]));
  });

  /**
   * The capability comes from the host, which computes it from the adapter
   * registry. A harness the host says nothing about is treated as streaming, so
   * an older host does not silently push every harness into the dock.
   */
  it("assumes streaming when the host does not say", async () => {
    const quiet = {
      ...fakeInventory,
      harnesses: fakeInventory.harnesses.map((harness) => {
        const { supportsStreaming: _drop, ...rest } = harness;
        return rest;
      })
    };
    const host = createFakeHost({ inventory: quiet });
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    expect(screen.queryByTestId("dock-only-notice")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "hello");
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => expect(host.streamed).toEqual(["hello"]));
  });
});
