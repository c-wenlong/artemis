import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeHost } from "./fakeHost";

const mounted: string[] = [];
const unmounted: string[] = [];

/**
 * Records mount and unmount so the tests below can assert what the dock does to
 * terminal views when tabs change, which is the difference between a PTY that
 * survives and one that gets torn down under you.
 */
vi.mock("../components/Terminal/TerminalView", async () => {
  const react = await import("react");
  return {
    TerminalView: ({ terminalId }: { terminalId: string }) => {
      react.useEffect(() => {
        mounted.push(terminalId);
        return () => {
          unmounted.push(terminalId);
        };
      }, [terminalId]);
      return <div data-terminal-id={terminalId} data-testid="terminal-view" />;
    }
  };
});

async function renderApp(host = createFakeHost()) {
  mounted.length = 0;
  unmounted.length = 0;
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  return { host, user };
}

function dock() {
  return within(screen.getByRole("complementary", { name: /terminal/i }));
}

async function addTerminal(user: ReturnType<typeof userEvent.setup>) {
  const existing = screen.queryByRole("complementary", { name: /terminal/i });
  if (existing) {
    await user.click(within(existing).getByRole("button", { name: /new terminal/i }));
    return;
  }
  await user.click(screen.getByRole("button", { name: /open terminal/i }));
}

describe("what the dock does to terminal views", () => {
  it("mounts a fresh view per tab rather than reusing one across PTYs", async () => {
    const { user } = await renderApp();
    await addTerminal(user);
    await addTerminal(user);

    const [firstTab] = dock().getAllByRole("tab");
    await user.click(firstTab!);

    // Keyed by id: switching tears down one view and builds the other, so a
    // view is never left bound to a PTY it is no longer showing.
    expect(mounted).toEqual(["term-1", "term-2", "term-1"]);
    expect(unmounted).toContain("term-2");
  });

  /**
   * Hiding the dock unmounts the view, which detaches the subscriber. The
   * process keeps running host-side, that is exactly the reload case, and it
   * must not close anything.
   */
  it("unmounts the view when hidden but never closes the terminal", async () => {
    const { host, user } = await renderApp();
    await addTerminal(user);
    expect(mounted).toEqual(["term-1"]);

    await user.click(screen.getByRole("button", { name: /hide terminal/i }));
    expect(unmounted).toEqual(["term-1"]);
    expect(host.closedTerminals).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /open terminal/i }));
    // Remounting resubscribes; the backlog is what fills the screen back in.
    expect(mounted).toEqual(["term-1", "term-1"]);
  });

  it("moves to a surviving tab when the visible one is closed", async () => {
    const { user } = await renderApp();
    await addTerminal(user);
    await addTerminal(user);

    await user.click(dock().getByRole("button", { name: /close terminal/i }));

    const tabs = dock().getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("terminal-view")).toHaveAttribute(
      "data-terminal-id",
      "term-1"
    );
  });
});

describe("what the terminal is started with", () => {
  it("follows the selected workspace", async () => {
    const { host, user } = await renderApp();
    await user.click(
      within(screen.getByRole("navigation", { name: /workspaces/i })).getByRole(
        "button",
        { name: /^quiver$/i }
      )
    );
    await addTerminal(user);

    await waitFor(() => expect(host.terminals[0]).toMatchObject({ cwd: "/work/quiver" }));
  });

  it("falls back to a shell when the harness has no executable", async () => {
    const { host, user } = await renderApp();
    // Nothing selected yet is unusual, but a terminal is still useful.
    await addTerminal(user);
    await waitFor(() => expect(host.terminals).toHaveLength(1));
    expect(host.terminals[0]!.command).toMatch(/opencode|sh$/);
  });

  it("asks for a sane initial size rather than zero", async () => {
    const { host, user } = await renderApp();
    await addTerminal(user);
    await waitFor(() => expect(host.terminals).toHaveLength(1));
    // A PTY opened at 0x0 makes programs render into nothing until the first
    // resize lands.
    expect(host.terminals[0]!.cols).toBeGreaterThan(0);
    expect(host.terminals[0]!.rows).toBeGreaterThan(0);
  });
});

describe("failures", () => {
  it("leaves the dock closed when opening fails", async () => {
    const host = createFakeHost({ terminalError: "no such shell" });
    const { user } = await renderApp(host);
    await user.click(screen.getByRole("button", { name: /open terminal/i }));

    await screen.findByRole("alert");
    // An empty dock next to an error message would be two ways of saying the
    // same thing.
    expect(screen.queryByRole("complementary", { name: /terminal/i })).toBeNull();
  });

  it("recovers once opening succeeds again", async () => {
    const host = createFakeHost();
    const open = vi
      .spyOn(host, "openTerminal")
      .mockRejectedValueOnce(new Error("transient"));
    const { user } = await renderApp(host);

    await user.click(screen.getByRole("button", { name: /open terminal/i }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /open terminal/i }));
    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: /terminal/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
