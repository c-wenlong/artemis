import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeHost } from "./fakeHost";

async function renderApp(host = createFakeHost()) {
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  return { host, user };
}

function rail() {
  return within(screen.getByRole("navigation", { name: /workspaces/i }));
}

/**
 * A launch preset is the harness and model a workspace was last used with.
 * Without it, every reopen resets to the default and the choice has to be made
 * again, which for someone working across several repos is a small tax paid
 * constantly.
 */
describe("launch presets", () => {
  it("remembers the harness chosen for a workspace", async () => {
    const { host, user } = await renderApp();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /harness/i }),
      "claude"
    );

    await waitFor(() =>
      expect(host.savedPresets.at(-1)).toMatchObject({
        workspaceId: "ws-artemis",
        harnessId: "claude"
      })
    );
  });

  it("remembers the model", async () => {
    const { host, user } = await renderApp();
    const model = screen.getByRole("textbox", { name: /model/i });
    // Wait for the field to settle before editing it. Clearing an empty input
    // fires no change event, so it would not count as an edit, and the preset
    // load would then fill it back in underneath the typing.
    await waitFor(() => expect(model).toHaveValue("anthropic/claude-opus-5"));

    await user.clear(model);
    await user.type(model, "zai/glm-5");

    await waitFor(() =>
      expect(host.savedPresets.at(-1)).toMatchObject({ model: "zai/glm-5" })
    );
  });

  it("restores the saved preset when the app opens", async () => {
    const host = createFakeHost({
      presets: { "ws-artemis": { harnessId: "claude", model: "zai/glm-5" } }
    });
    await renderApp(host);

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /harness/i })).toHaveValue("claude")
    );
    expect(screen.getByRole("textbox", { name: /model/i })).toHaveValue("zai/glm-5");
  });

  it("applies each workspace's own preset as the selection changes", async () => {
    const host = createFakeHost({
      presets: {
        "ws-artemis": { harnessId: "opencode", model: "anthropic/claude-opus-5" },
        "ws-quiver": { harnessId: "claude", model: "zai/glm-5" }
      }
    });
    const { user } = await renderApp(host);

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /harness/i })).toHaveValue("opencode")
    );

    await user.click(rail().getByRole("button", { name: /^quiver$/i }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /harness/i })).toHaveValue("claude")
    );
    expect(screen.getByRole("textbox", { name: /model/i })).toHaveValue("zai/glm-5");
  });

  it("falls back to the default when a workspace has no preset", async () => {
    const host = createFakeHost({
      presets: { "ws-artemis": { harnessId: "claude", model: "zai/glm-5" } }
    });
    const { user } = await renderApp(host);
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /harness/i })).toHaveValue("claude")
    );

    await user.click(rail().getByRole("button", { name: /^quiver$/i }));
    // No preset for quiver: opencode is preferred, and the settings default
    // model applies.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /harness/i })).toHaveValue("opencode")
    );
  });

  it("ignores a preset naming a harness that is no longer installed", async () => {
    const host = createFakeHost({
      // "aider" is in the catalog but not ready on this machine.
      presets: { "ws-artemis": { harnessId: "aider", model: null } }
    });
    await renderApp(host);

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /harness/i })).toHaveValue("opencode")
    );
  });

  it("does not save a preset before anything has been chosen", async () => {
    const host = createFakeHost();
    const save = vi.spyOn(host, "saveLaunchPreset");
    await renderApp(host);

    // Loading a workspace is not a choice; only a change is.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /harness/i })).toHaveValue("opencode")
    );
    expect(save).not.toHaveBeenCalled();
  });
});
