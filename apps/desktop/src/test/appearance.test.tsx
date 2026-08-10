import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeHost } from "./fakeHost";

async function openSettings() {
  const user = userEvent.setup();
  render(<App host={createFakeHost()} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  await user.click(screen.getByRole("button", { name: /settings/i }));
  const dialog = await screen.findByRole("dialog", { name: /settings/i });
  return { user, dialog };
}

async function openAppearance(host = createFakeHost()) {
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  await user.click(screen.getByRole("button", { name: /settings/i }));
  const dialog = await screen.findByRole("dialog", { name: /settings/i });
  await user.click(within(dialog).getByRole("tab", { name: /appearance/i }));
  return { host, user, dialog };
}

describe("settings tabs", () => {
  it("opens on General, with Appearance available", async () => {
    const { dialog } = await openSettings();
    const tabs = within(dialog).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["General", "Appearance"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the general settings out of the way on the appearance tab", async () => {
    const { dialog } = await openAppearance();
    expect(
      within(dialog).queryByRole("textbox", { name: /default model/i })
    ).toBeNull();
  });

  it("returns to General", async () => {
    const { dialog, user } = await openAppearance();
    await user.click(within(dialog).getByRole("tab", { name: /general/i }));
    expect(
      within(dialog).getByRole("textbox", { name: /default model/i })
    ).toBeInTheDocument();
  });
});

describe("the appearance tab", () => {
  it("offers every icon variant the host reports", async () => {
    const { dialog } = await openAppearance();
    const options = within(dialog).getAllByRole("radio");
    expect(options).toHaveLength(12);
    expect(
      within(dialog).getByRole("radio", { name: /deep sea gradient/i })
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: /frost weaver/i })
    ).toBeInTheDocument();
  });

  it("shows the bundled icon as selected to begin with", async () => {
    const { dialog } = await openAppearance();
    expect(
      within(dialog).getByRole("radio", { name: /deep sea gradient/i })
    ).toBeChecked();
  });

  it("applies a chosen icon", async () => {
    const { host, dialog, user } = await openAppearance();
    await user.click(within(dialog).getByRole("radio", { name: /frost weaver/i }));

    await waitFor(() => expect(host.appliedIcons).toEqual(["frost-weaver-ice"]));
    expect(
      within(dialog).getByRole("radio", { name: /frost weaver/i })
    ).toBeChecked();
  });

  it("reflects the icon already stored when the tab opens", async () => {
    const { dialog } = await openAppearance(
      createFakeHost({ settings: { appIconId: "olympian-marble" } })
    );
    expect(within(dialog).getByRole("radio", { name: /olympian/i })).toBeChecked();
  });

  /**
   * The distinction matters and is invisible from the panel: only the running
   * app's dock icon changes. Finder keeps showing the bundled one.
   */
  it("says plainly what a change does and does not affect", async () => {
    const { dialog } = await openAppearance();
    expect(within(dialog).getByTestId("appearance-note")).toHaveTextContent(/dock/i);
  });

  it("reports a failure instead of showing the wrong icon as chosen", async () => {
    const host = createFakeHost();
    vi.spyOn(host, "setAppIcon").mockRejectedValueOnce(new Error("Unknown icon"));
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await user.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    await user.click(within(dialog).getByRole("tab", { name: /appearance/i }));

    await user.click(within(dialog).getByRole("radio", { name: /frost weaver/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unknown icon");
    // The selection stays on what is actually applied.
    expect(
      within(dialog).getByRole("radio", { name: /deep sea gradient/i })
    ).toBeChecked();
  });
});
