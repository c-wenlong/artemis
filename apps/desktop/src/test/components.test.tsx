import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceStatus } from "@artemis/core";
import { App } from "../App";
import { Composer } from "../components/Composer/Composer";
import { Rail } from "../components/Rail/Rail";
import { StatusDot } from "../components/StatusDot/StatusDot";
import {
  createFakeHost,
  fakeInventory,
  fakeProjects,
  fakeWorkspaces
} from "./fakeHost";

describe("StatusDot", () => {
  const cases: Array<[WorkspaceStatus, string]> = [
    ["ready", "ready"],
    ["creating", "creating"],
    ["running", "running"],
    ["needs-attention", "needs attention"],
    ["error", "error"],
    ["archived", "archived"]
  ];

  it.each(cases)("labels %s in words, not colour alone", (status, label) => {
    render(<StatusDot status={status} subject="repo" />);
    const dot = screen.getByRole("img", { name: `repo: ${label}` });
    expect(dot).toHaveAttribute("data-status", status);
  });
});

describe("Rail", () => {
  const noop = () => {};

  it("omits the project heading when it holds a single workspace", () => {
    render(
      <Rail
        onDeleteWorktree={noop}
        onNewWorktree={noop}
        onOpenSettings={noop}
        onSelectWorkspace={noop}
        projects={fakeProjects}
        selectedWorkspaceId="ws-artemis"
        workspaces={fakeWorkspaces}
      />
    );
    // "artemis › artemis" would be noise, not hierarchy.
    expect(screen.queryByRole("heading", { name: "artemis" })).toBeNull();
    expect(screen.getByRole("button", { name: /^artemis$/i })).toBeInTheDocument();
  });

  it("shows the project heading once a project holds more than one workspace", () => {
    const workspaces = [
      ...fakeWorkspaces,
      {
        ...fakeWorkspaces[0]!,
        id: "ws-artemis-2",
        name: "m3-segments",
        branch: "m3-segments"
      }
    ];
    render(
      <Rail
        onDeleteWorktree={noop}
        onNewWorktree={noop}
        onOpenSettings={noop}
        onSelectWorkspace={noop}
        projects={fakeProjects}
        selectedWorkspaceId="ws-artemis"
        workspaces={workspaces}
      />
    );
    expect(screen.getByRole("heading", { name: "artemis" })).toBeInTheDocument();
  });

  it("keeps workspaces whose project is missing rather than dropping them", () => {
    render(
      <Rail
        onDeleteWorktree={noop}
        onNewWorktree={noop}
        onOpenSettings={noop}
        onSelectWorkspace={noop}
        projects={[]}
        selectedWorkspaceId={null}
        workspaces={fakeWorkspaces}
      />
    );
    expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^artemis$/i })).toBeInTheDocument();
  });

  it("marks the selected workspace for assistive technology", () => {
    render(
      <Rail
        onDeleteWorktree={noop}
        onNewWorktree={noop}
        onOpenSettings={noop}
        onSelectWorkspace={noop}
        projects={fakeProjects}
        selectedWorkspaceId="ws-quiver"
        workspaces={fakeWorkspaces}
      />
    );
    expect(screen.getByRole("button", { name: /^quiver$/i })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("reports an empty scan root instead of rendering nothing", () => {
    render(
      <Rail
        onDeleteWorktree={noop}
        onNewWorktree={noop}
        onOpenSettings={noop}
        onSelectWorkspace={noop}
        projects={[]}
        selectedWorkspaceId={null}
        workspaces={[]}
      />
    );
    expect(screen.getByText(/no git repositories/i)).toBeInTheDocument();
  });
});

describe("Composer", () => {
  const harnesses = fakeInventory.harnesses.filter(
    (harness) => harness.health === "ready"
  );

  function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
    const onSubmit = vi.fn();
    render(
      <Composer
        harnesses={harnesses}
        isBusy={false}
        model=""
        onModelChange={() => {}}
        onSelectHarness={() => {}}
        onSubmit={onSubmit}
        review={null}
        selectedHarnessId="opencode"
        workspace={fakeWorkspaces[0]!}
        {...overrides}
      />
    );
    return { onSubmit, user: userEvent.setup() };
  }

  it("submits on Cmd+Enter without leaving the keyboard", async () => {
    const { onSubmit, user } = renderComposer();
    await user.click(screen.getByRole("textbox", { name: /prompt/i }));
    await user.keyboard("ship it{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledWith("ship it");
  });

  it("trims whitespace and refuses a blank prompt", async () => {
    const { onSubmit, user } = renderComposer();
    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "   ");
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears the input after a successful submit", async () => {
    const { user } = renderComposer();
    const input = screen.getByRole("textbox", { name: /prompt/i });
    await user.type(input, "explain");
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    expect(input).toHaveValue("");
  });

  it("blocks a second run while one is in flight", async () => {
    const { onSubmit, user } = renderComposer({ isBusy: true });
    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "again");
    const run = screen.getByRole("button", { name: /running/i });
    expect(run).toBeDisabled();
    await user.click(run);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reads zero rather than blank when there is no review yet", () => {
    renderComposer({ review: null });
    const context = screen.getByTestId("composer-context");
    expect(context).toHaveTextContent("+0");
    expect(context).toHaveTextContent("−0");
  });

  it("says so when no workspace is selected", () => {
    renderComposer({ workspace: null });
    expect(screen.getByTestId("composer-context")).toHaveTextContent("No workspace");
  });
});

describe("App data flow", () => {
  it("does not refetch the inventory when the workspace changes", async () => {
    const host = createFakeHost();
    const getSnapshot = vi.spyOn(host, "getSnapshot");
    const getReview = vi.spyOn(host, "getReviewSnapshot");
    const user = userEvent.setup();

    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await waitFor(() => expect(getReview).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /^quiver$/i }));
    await waitFor(() => expect(getReview).toHaveBeenCalledTimes(2));

    // The old shell listed the selection in its load effect's dependencies, so
    // every click reran a full scan.
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("refreshes the diffstat after a run so the composer stays truthful", async () => {
    const host = createFakeHost();
    const getReview = vi.spyOn(host, "getReviewSnapshot");
    const user = userEvent.setup();

    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await waitFor(() => expect(getReview).toHaveBeenCalledTimes(1));

    await user.type(screen.getByRole("textbox", { name: /prompt/i }), "do work");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => expect(getReview).toHaveBeenCalledTimes(2));
  });

  it("seeds the model field from saved settings", async () => {
    render(<App host={createFakeHost()} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /model/i })).toHaveValue(
        "anthropic/claude-opus-5"
      )
    );
  });

  it("offers only ready harnesses, defaulting to opencode", async () => {
    render(<App host={createFakeHost()} />);
    await screen.findByRole("button", { name: /^artemis$/i });
    const harness = screen.getByRole("combobox", { name: /harness/i });
    await waitFor(() => expect(harness).toHaveValue("opencode"));
    // Named rather than counted: the point is that the missing harness is
    // absent, not how many happen to be installed in the fixture. Amp is ready
    // but unadapted, which is a dock decision, not a readiness one.
    expect(
      within(harness)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["OpenCode", "Claude Code", "Amp"]);
  });
});

describe("SettingsDialog", () => {
  it("discards edits on cancel", async () => {
    const host = createFakeHost();
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    await user.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    const field = within(dialog).getByRole("textbox", { name: /default model/i });
    await user.clear(field);
    await user.type(field, "throwaway");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(host.savedSettings).toHaveLength(0);

    // Reopening shows the persisted value, not the abandoned draft.
    await user.click(screen.getByRole("button", { name: /settings/i }));
    const reopened = await screen.findByRole("dialog", { name: /settings/i });
    expect(
      within(reopened).getByRole("textbox", { name: /default model/i })
    ).toHaveValue("anthropic/claude-opus-5");
  });

  it("exposes the scan root, the setting that bounds the inventory scan", async () => {
    const user = userEvent.setup();
    render(<App host={createFakeHost()} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    await user.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    expect(within(dialog).getByRole("textbox", { name: /scan root/i })).toBeInTheDocument();
  });
});
