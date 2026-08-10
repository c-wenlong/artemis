import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProjectRef, WorkspaceSummary } from "@artemis/core";
import { App } from "../App";
import { Rail } from "../components/Rail/Rail";
import { createFakeHost, fakeProjects, fakeWorkspaces } from "./fakeHost";

const noop = () => {};

function renderRail(
  projects: ProjectRef[],
  workspaces: WorkspaceSummary[],
  selectedWorkspaceId: string | null,
  handlers: Partial<{
    onNewWorktree: (id: string) => void;
    onDeleteWorktree: (id: string) => void;
  }> = {}
) {
  render(
    <Rail
      onDeleteWorktree={handlers.onDeleteWorktree ?? noop}
      onNewWorktree={handlers.onNewWorktree ?? noop}
      onOpenSettings={noop}
      onSelectWorkspace={noop}
      projects={projects}
      selectedWorkspaceId={selectedWorkspaceId}
      workspaces={workspaces}
    />
  );
}

const worktree: WorkspaceSummary = {
  id: "ws-artemis-feature",
  projectId: "artemis",
  name: "feature/login",
  branch: "feature/login",
  worktreePath: "/worktrees/artemis/feature-login",
  status: "ready",
  activeSessionIds: [],
  changedFileCount: 0,
  lastActivityAt: "2026-08-10T12:00:00.000Z"
};

describe("rail accessibility", () => {
  /**
   * The row used to announce as "artemis: ready artemis 4" — the dot's label,
   * the name, and the change count concatenated. The dot keeps its own label;
   * the row is just the name.
   */
  it("gives the row and its status dot distinct, non-redundant names", () => {
    renderRail(fakeProjects, fakeWorkspaces, "ws-artemis");
    expect(screen.getByRole("button", { name: "artemis" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "artemis: ready" })).toBeInTheDocument();
  });

  it("names the add control after its project so several are distinguishable", () => {
    renderRail(fakeProjects, fakeWorkspaces, null);
    expect(
      screen.getByRole("button", { name: "New worktree in artemis" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New worktree in quiver" })
    ).toBeInTheDocument();
  });
});

describe("which workspaces can be deleted", () => {
  /**
   * "Is this the project's own checkout" is decided by path, not by whether the
   * id looks a certain way. An id convention is invisible coupling: the host
   * could change how it builds ids and this would quietly start offering to
   * delete people's repositories.
   */
  it("offers delete for a worktree whose id does not follow the main convention", () => {
    renderRail(
      fakeProjects,
      [...fakeWorkspaces, { ...worktree, id: "ws-artemis" }],
      "ws-artemis"
    );
    // Two workspaces share an id shape here; the one at a different path is
    // still a worktree.
    expect(
      screen.getAllByRole("button", { name: /delete worktree/i }).length
    ).toBeGreaterThan(0);
  });

  it("never offers delete for a checkout sitting at the project root", () => {
    renderRail(
      fakeProjects,
      [{ ...worktree, id: "ws-odd-id", worktreePath: fakeProjects[0]!.rootPath }],
      "ws-odd-id"
    );
    expect(screen.queryByRole("button", { name: /delete worktree/i })).toBeNull();
  });

  it("shows the delete control only for the selected workspace", () => {
    renderRail(fakeProjects, [...fakeWorkspaces, worktree], "ws-artemis");
    // The worktree exists but is not selected, so its delete control is hidden
    // rather than lining the rail with destructive buttons.
    expect(screen.queryByRole("button", { name: /delete worktree/i })).toBeNull();
  });

  it("offers no add control for workspaces with no project", () => {
    renderRail([], fakeWorkspaces, null);
    expect(screen.queryByRole("button", { name: /new worktree/i })).toBeNull();
  });
});

describe("after a worktree changes", () => {
  it("re-reads the workspace list rather than patching it locally", async () => {
    const host = createFakeHost();
    const list = vi.spyOn(host, "listWorkspaces");
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    const before = list.mock.calls.length;
    await user.click(
      within(screen.getByRole("navigation", { name: /workspaces/i })).getByRole(
        "button",
        { name: "New worktree in artemis" }
      )
    );
    const dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.type(within(dialog).getByRole("textbox", { name: /branch/i }), "m5");
    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    // The host is the source of truth for what exists; a locally-appended row
    // would drift from it the moment git did anything unexpected.
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });

  it("selects the worktree it just created", async () => {
    const host = createFakeHost();
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    await user.click(
      within(screen.getByRole("navigation", { name: /workspaces/i })).getByRole(
        "button",
        { name: "New worktree in artemis" }
      )
    );
    const dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.type(within(dialog).getByRole("textbox", { name: /branch/i }), "m5");
    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    // Creating a worktree is how you start work in it.
    await waitFor(() =>
      expect(screen.getByTestId("composer-context")).toHaveTextContent("m5")
    );
  });

  it("closes the dialog once creation succeeds", async () => {
    const user = userEvent.setup();
    render(<App host={createFakeHost()} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    await user.click(
      within(screen.getByRole("navigation", { name: /workspaces/i })).getByRole(
        "button",
        { name: "New worktree in artemis" }
      )
    );
    const dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.type(within(dialog).getByRole("textbox", { name: /branch/i }), "m5");
    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /new worktree/i })).toBeNull()
    );
  });

  it("starts the branch field empty each time it opens", async () => {
    const host = createFakeHost({ worktreeError: "nope" });
    const user = userEvent.setup();
    render(<App host={host} />);
    await screen.findByRole("button", { name: /^artemis$/i });

    const add = within(
      screen.getByRole("navigation", { name: /workspaces/i })
    ).getByRole("button", { name: "New worktree in artemis" });

    await user.click(add);
    let dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.type(within(dialog).getByRole("textbox", { name: /branch/i }), "typo");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await user.click(add);
    dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    expect(within(dialog).getByRole("textbox", { name: /branch/i })).toHaveValue("");
  });
});
