import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeHost } from "./fakeHost";

/**
 * xterm.js needs real layout, which jsdom does not have, so `TerminalView` is
 * stubbed. What is under test is everything around it: which terminals exist,
 * which tab is showing, and what happens on reconnect. The emulator itself is
 * third-party and not Artemis's to prove.
 */
vi.mock("../components/Terminal/TerminalView", () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-terminal-id={terminalId} data-testid="terminal-view" />
  )
}));

async function renderApp(host = createFakeHost()) {
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  return { host, user };
}

/**
 * The composer button toggles the dock; the "+" inside it starts another
 * terminal. Two affordances, because one control cannot both reveal and add.
 */
async function openTerminal(user: ReturnType<typeof userEvent.setup>) {
  const dock = screen.queryByRole("complementary", { name: /terminal/i });
  if (dock) {
    await user.click(within(dock).getByRole("button", { name: /new terminal/i }));
    return;
  }
  await user.click(screen.getByRole("button", { name: /open terminal/i }));
}

describe("the terminal dock", () => {
  it("stays out of the way until a terminal is opened", async () => {
    await renderApp();
    expect(screen.queryByRole("complementary", { name: /terminal/i })).toBeNull();
  });

  it("opens a terminal in the selected workspace", async () => {
    const { host, user } = await renderApp();
    await openTerminal(user);

    await waitFor(() => expect(host.terminals).toHaveLength(1));
    expect(host.terminals[0]).toMatchObject({ cwd: "/work/artemis" });
    expect(await screen.findByTestId("terminal-view")).toBeInTheDocument();
  });

  it("uses the selected harness as the terminal's command", async () => {
    const { host, user } = await renderApp();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /harness/i }),
      "claude"
    );
    await openTerminal(user);

    // The dock is where non-opencode harnesses run; it should start the one
    // the composer is pointing at.
    await waitFor(() =>
      expect(host.terminals[0]).toMatchObject({
        command: "/opt/homebrew/bin/claude"
      })
    );
  });

  it("gives each terminal a tab and shows the newest", async () => {
    const { user } = await renderApp();
    await openTerminal(user);
    await openTerminal(user);

    const dock = within(screen.getByRole("complementary", { name: /terminal/i }));
    expect(dock.getAllByRole("tab")).toHaveLength(2);
    expect(dock.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    // Only the visible tab is mounted.
    expect(screen.getAllByTestId("terminal-view")).toHaveLength(1);
  });

  it("switches between tabs", async () => {
    const { user } = await renderApp();
    await openTerminal(user);
    await openTerminal(user);

    const dock = within(screen.getByRole("complementary", { name: /terminal/i }));
    const [first] = dock.getAllByRole("tab");
    await user.click(first!);

    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("closes a terminal and tells the host to stop it", async () => {
    const { host, user } = await renderApp();
    await openTerminal(user);

    const dock = within(screen.getByRole("complementary", { name: /terminal/i }));
    await user.click(dock.getByRole("button", { name: /close terminal/i }));

    await waitFor(() => expect(host.closedTerminals).toHaveLength(1));
    // The last tab closing takes the dock with it.
    expect(screen.queryByRole("complementary", { name: /terminal/i })).toBeNull();
  });

  it("hides the whole dock without killing what is running", async () => {
    const { host, user } = await renderApp();
    await openTerminal(user);

    await user.click(screen.getByRole("button", { name: /hide terminal/i }));
    expect(screen.queryByRole("complementary", { name: /terminal/i })).toBeNull();
    // Hiding is not closing: the process keeps going.
    expect(host.closedTerminals).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /open terminal/i }));
    expect(
      within(screen.getByRole("complementary", { name: /terminal/i })).getAllByRole("tab")
    ).toHaveLength(1);
  });

  /**
   * The exit criterion for M6. A reload drops the webview, not the PTY, so the
   * dock has to find what is already running rather than starting fresh.
   */
  it("adopts terminals the host already has, as it would after a reload", async () => {
    const host = createFakeHost({
      existingTerminals: [
        {
          id: "term-survivor",
          title: "claude",
          command: "/opt/homebrew/bin/claude",
          cwd: "/work/artemis",
          isRunning: true,
          startedAt: "2026-08-10T12:00:00.000Z"
        }
      ]
    });
    const { user } = await renderApp(host);

    await user.click(screen.getByRole("button", { name: /open terminal/i }));
    const dock = within(screen.getByRole("complementary", { name: /terminal/i }));

    expect(dock.getByRole("tab", { name: /claude/i })).toBeInTheDocument();
    // Adopted, not restarted.
    expect(host.terminals).toHaveLength(0);
  });

  it("marks a terminal whose process has exited", async () => {
    const host = createFakeHost({
      existingTerminals: [
        {
          id: "term-dead",
          title: "sh",
          command: "/bin/sh",
          cwd: "/work/artemis",
          isRunning: false,
          startedAt: "2026-08-10T12:00:00.000Z"
        }
      ]
    });
    const { user } = await renderApp(host);
    await user.click(screen.getByRole("button", { name: /open terminal/i }));

    const dock = within(screen.getByRole("complementary", { name: /terminal/i }));
    expect(dock.getByRole("tab", { name: /sh/i })).toHaveAttribute(
      "data-running",
      "false"
    );
  });

  it("reports why a terminal could not start", async () => {
    const host = createFakeHost({ terminalError: "Could not start /bin/nope" });
    const { user } = await renderApp(host);
    await openTerminal(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not start /bin/nope"
    );
  });
});
