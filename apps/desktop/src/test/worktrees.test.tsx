import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeHost, fakeProjects, fakeWorkspaces } from "./fakeHost";

async function renderApp(host = createFakeHost()) {
  const user = userEvent.setup();
  render(<App host={host} />);
  await screen.findByRole("button", { name: /^artemis$/i });
  return { host, user };
}

function rail() {
  return within(screen.getByRole("navigation", { name: /workspaces/i }));
}

describe("creating a worktree", () => {
  it("offers a way to add one per project", async () => {
    await renderApp();
    expect(
      rail().getAllByRole("button", { name: /new worktree/i }).length
    ).toBeGreaterThan(0);
  });

  it("asks for a branch name and creates it", async () => {
    const { host, user } = await renderApp();
    await user.click(rail().getAllByRole("button", { name: /new worktree/i })[0]!);

    const dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.type(
      within(dialog).getByRole("textbox", { name: /branch/i }),
      "feature/login"
    );
    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(host.created).toEqual([{ projectId: "artemis", branch: "feature/login" }])
    );
  });

  it("will not create a worktree with no branch name", async () => {
    const { host, user } = await renderApp();
    await user.click(rail().getAllByRole("button", { name: /new worktree/i })[0]!);
    const dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));
    expect(host.created).toHaveLength(0);
  });

  it("shows the new worktree in the rail once it exists", async () => {
    const { user } = await renderApp();
    await user.click(rail().getAllByRole("button", { name: /new worktree/i })[0]!);
    const dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.type(within(dialog).getByRole("textbox", { name: /branch/i }), "m5-worktrees");
    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(rail().getByRole("button", { name: /^m5-worktrees$/i })).toBeInTheDocument()
    );
  });

  /** Creating copies a tree; on a large repo that is not instant. */
  it("reports progress while git works", async () => {
    const host = createFakeHost({ holdWorktreeCreate: true });
    const { user } = await renderApp(host);
    await user.click(rail().getAllByRole("button", { name: /new worktree/i })[0]!);
    const dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.type(within(dialog).getByRole("textbox", { name: /branch/i }), "slow");
    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    expect(await within(dialog).findByText(/creating/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /creating/i })).toBeDisabled();
  });

  it("surfaces git's own message when creation fails", async () => {
    const host = createFakeHost({
      worktreeError: "fatal: a branch named 'dup' already exists"
    });
    const { user } = await renderApp(host);
    await user.click(rail().getAllByRole("button", { name: /new worktree/i })[0]!);
    const dialog = await screen.findByRole("dialog", { name: /new worktree/i });
    await user.type(within(dialog).getByRole("textbox", { name: /branch/i }), "dup");
    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    // Git's wording, not a generic "something went wrong".
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "a branch named 'dup' already exists"
    );
    // The dialog stays open so the name can be corrected.
    expect(screen.getByRole("dialog", { name: /new worktree/i })).toBeInTheDocument();
  });
});

describe("deleting a worktree", () => {
  const withWorktree = () =>
    createFakeHost({
      workspaces: [
        ...fakeWorkspaces,
        {
          id: "ws-artemis-feature",
          projectId: "artemis",
          name: "feature/login",
          branch: "feature/login",
          worktreePath: "/worktrees/artemis/feature-login",
          status: "ready",
          activeSessionIds: [],
          changedFileCount: 0,
          lastActivityAt: "2026-08-10T12:00:00.000Z"
        }
      ]
    });

  it("deletes after confirmation", async () => {
    const host = withWorktree();
    const { user } = await renderApp(host);

    await user.click(rail().getByRole("button", { name: /^feature\/login$/i }));
    await user.click(rail().getByRole("button", { name: /delete worktree/i }));

    const dialog = await screen.findByRole("dialog", { name: /delete/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(host.deleted).toEqual([{ workspaceId: "ws-artemis-feature", force: false }])
    );
  });

  it("does not delete when the confirmation is dismissed", async () => {
    const host = withWorktree();
    const { user } = await renderApp(host);

    await user.click(rail().getByRole("button", { name: /^feature\/login$/i }));
    await user.click(rail().getByRole("button", { name: /delete worktree/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete/i });
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(host.deleted).toHaveLength(0);
  });

  /**
   * The host refuses a dirty worktree. The UI must relay that refusal and make
   * discarding a second, deliberate choice: never retry with force on its own.
   */
  it("relays a refusal and requires a second, explicit choice to discard", async () => {
    const host = withWorktree();
    vi.spyOn(host, "deleteWorkspace").mockImplementationOnce(async () => {
      throw new Error("This worktree has uncommitted changes.");
    });
    const { user } = await renderApp(host);

    await user.click(rail().getByRole("button", { name: /^feature\/login$/i }));
    await user.click(rail().getByRole("button", { name: /delete worktree/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "uncommitted changes"
    );
    // No automatic retry: nothing was force-deleted behind the user's back.
    expect(host.deleted).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: /discard changes and delete/i })
    );
    await waitFor(() =>
      expect(host.deleted).toEqual([{ workspaceId: "ws-artemis-feature", force: true }])
    );
  });

  it("does not offer to delete a project's own checkout", async () => {
    const { user } = await renderApp(withWorktree());
    // The main checkout is the repository, not a worktree Artemis made.
    await user.click(rail().getByRole("button", { name: /^artemis$/i }));
    expect(rail().queryByRole("button", { name: /delete worktree/i })).toBeNull();
  });

  it("moves the selection off a workspace it just deleted", async () => {
    const host = withWorktree();
    const { user } = await renderApp(host);

    await user.click(rail().getByRole("button", { name: /^feature\/login$/i }));
    await user.click(rail().getByRole("button", { name: /delete worktree/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(screen.getByTestId("composer-context")).not.toHaveTextContent(
        "feature/login"
      )
    );
  });
});

describe("the rail with worktrees", () => {
  it("groups a project's worktrees under its name", async () => {
    await renderApp(
      createFakeHost({
        projects: fakeProjects,
        workspaces: [
          ...fakeWorkspaces,
          {
            id: "ws-artemis-two",
            projectId: "artemis",
            name: "m5",
            branch: "m5",
            worktreePath: "/worktrees/artemis/m5",
            status: "ready",
            activeSessionIds: [],
            changedFileCount: 2,
            lastActivityAt: "2026-08-10T12:00:00.000Z"
          }
        ]
      })
    );

    // Two workspaces for one project means the project heading earns its place.
    expect(rail().getByRole("heading", { name: "artemis" })).toBeInTheDocument();
    expect(rail().getByRole("button", { name: /^m5$/i })).toBeInTheDocument();
  });
});
