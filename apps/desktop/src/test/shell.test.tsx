import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { createFakeHost } from "./fakeHost";

async function renderApp(host = createFakeHost()) {
  const user = userEvent.setup();
  render(<App host={host} />);
  // The shell paints before data arrives; wait for the rail to fill.
  await screen.findByRole("button", { name: /^artemis$/i });
  return { host, user };
}

describe("shell", () => {
  it("drops the five-section nav — the conversation is the app", async () => {
    await renderApp();
    const navs = screen.queryAllByRole("navigation", { name: /sections/i });
    expect(navs).toHaveLength(0);
    for (const gone of ["Workbench", "Review", "Chat"]) {
      expect(
        screen.queryByRole("button", { name: new RegExp(`^${gone}$`, "i") }),
        `"${gone}" should no longer be a top-level destination`
      ).toBeNull();
    }
  });

  it("lists projects and their workspaces in the rail", async () => {
    await renderApp();
    const rail = screen.getByRole("navigation", { name: /workspaces/i });
    expect(within(rail).getByText("artemis")).toBeInTheDocument();
    expect(within(rail).getByText("quiver")).toBeInTheDocument();
  });

  it("shows workspace state as a labelled dot, not a badge of text", async () => {
    await renderApp();
    const rail = screen.getByRole("navigation", { name: /workspaces/i });
    const ready = within(rail).getByRole("img", { name: /artemis: ready/i });
    expect(ready).toHaveAttribute("data-status", "ready");
    const attention = within(rail).getByRole("img", {
      name: /quiver: needs attention/i
    });
    expect(attention).toHaveAttribute("data-status", "needs-attention");
  });

  it("selects a workspace from the rail", async () => {
    const { user } = await renderApp();
    const rail = screen.getByRole("navigation", { name: /workspaces/i });
    await user.click(within(rail).getByRole("button", { name: /^quiver$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("composer-context")).toHaveTextContent("quiver");
    });
  });
});

describe("composer", () => {
  it("carries run context: repo, branch and diffstat", async () => {
    await renderApp();
    const context = screen.getByTestId("composer-context");
    expect(context).toHaveTextContent("artemis");
    expect(context).toHaveTextContent("m2-design-system");
    // The review is a separate request from the initial load, so the diffstat
    // fills in a tick later — it reads +0 −0 until then, never blank.
    await waitFor(() => expect(context).toHaveTextContent("+160"));
    expect(context).toHaveTextContent("−96");
  });

  it("puts harness and model selection under the input, not in a catalog screen", async () => {
    await renderApp();
    const harness = screen.getByRole("combobox", { name: /harness/i });
    expect(within(harness).getByRole("option", { name: /opencode/i })).toBeInTheDocument();
    // Unavailable harnesses must not be offered.
    expect(within(harness).queryByRole("option", { name: /aider/i })).toBeNull();
    expect(screen.getByRole("textbox", { name: /model/i })).toBeInTheDocument();
  });

  // M1 moved chat off the one-shot launcher and onto the streaming API; see
  // streaming.test.tsx for the transcript behaviour.
  it("submits a prompt to the selected workspace", async () => {
    const { host, user } = await renderApp();
    await user.type(
      screen.getByRole("textbox", { name: /prompt/i }),
      "explain the scanner"
    );
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => expect(host.streamed).toEqual(["explain the scanner"]));
  });

  it("will not submit an empty prompt", async () => {
    const { host, user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    expect(host.streamed).toHaveLength(0);
  });
});

describe("settings", () => {
  it("is a modal, not a destination", async () => {
    const { user } = await renderApp();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    expect(dialog).toBeInTheDocument();
  });

  it("saves settings and closes", async () => {
    const { host, user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });

    const modelField = within(dialog).getByRole("textbox", { name: /default model/i });
    await user.clear(modelField);
    await user.type(modelField, "anthropic/claude-sonnet-5");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(host.savedSettings).toHaveLength(1));
    expect(host.savedSettings[0]?.opencodeDefaultModel).toBe("anthropic/claude-sonnet-5");
  });

  it("surfaces the asset inventory inside settings rather than as a section", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await screen.findByRole("dialog", { name: /settings/i });

    // Scoped to the harness list: "OpenCode" is also a settings section
    // heading, and asserting on the bare string would pass for the wrong reason.
    const harnesses = within(screen.getByTestId("settings-harnesses"));
    expect(harnesses.getByText("OpenCode")).toBeInTheDocument();
    expect(harnesses.getByText("1.17.11")).toBeInTheDocument();
    expect(harnesses.getByText("Claude Code")).toBeInTheDocument();
    // Unavailable harnesses are not presented as installed.
    expect(harnesses.queryByText("Aider")).toBeNull();
  });
});

describe("conversation surface", () => {
  it("constrains the reading column", async () => {
    await renderApp();
    const conversation = screen.getByRole("log", { name: /conversation/i });
    expect(conversation).toBeInTheDocument();
    expect(screen.getByTestId("conversation-column")).toHaveClass("conversation-column");
  });

  it("shows an empty state naming the selected harness", async () => {
    await renderApp();
    // The harness comes from the workspace's stored preset, which resolves a
    // tick after the rail does.
    await waitFor(() =>
      expect(screen.getByTestId("conversation-empty")).toHaveTextContent(/OpenCode/)
    );
  });
});
