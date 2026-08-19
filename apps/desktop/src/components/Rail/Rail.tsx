import type { ProjectRef, WorkspaceSummary } from "@artemis/core";
import { StatusDot } from "../StatusDot/StatusDot";
import "./Rail.css";

interface RailProps {
  projects: ProjectRef[];
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  onSelectWorkspace(workspaceId: string): void;
  /** Start a comparison: one prompt, several harnesses. */
  onCompare?(): void;
  onOpenSettings(): void;
  onNewWorktree(projectId: string): void;
  onDeleteWorktree(workspaceId: string): void;
}

interface Group {
  project: ProjectRef;
  workspaces: WorkspaceSummary[];
}

function groupByProject(
  projects: ProjectRef[],
  workspaces: WorkspaceSummary[]
): Group[] {
  const groups = projects.map((project) => ({
    project,
    workspaces: workspaces.filter((workspace) => workspace.projectId === project.id)
  }));
  // Workspaces whose project went missing still need somewhere to live.
  const known = new Set(projects.map((project) => project.id));
  const orphans = workspaces.filter((workspace) => !known.has(workspace.projectId));
  if (orphans.length > 0) {
    groups.push({
      project: { id: "__orphans", name: "Other", rootPath: "", mainBranch: "" },
      workspaces: orphans
    });
  }
  return groups.filter((group) => group.workspaces.length > 0);
}

/**
 * A project's own checkout is not a worktree Artemis made, so it cannot be
 * deleted from here. Identified by path rather than by an id convention, which
 * would silently stop matching if the host changed how it builds ids.
 */
function isMainCheckout(project: ProjectRef, workspace: WorkspaceSummary): boolean {
  return workspace.worktreePath === project.rootPath;
}

/**
 * Left rail: projects resolved down to the workspaces you actually open.
 *
 * A project heading appears only when it holds more than one workspace:
 * "artemis › artemis" is noise, not hierarchy. The add control lives on the
 * group row either way.
 */
export function Rail({
  projects,
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onCompare,
  onOpenSettings,
  onNewWorktree,
  onDeleteWorktree
}: RailProps) {
  const groups = groupByProject(projects, workspaces);

  return (
    <div className="rail">
      <div className="rail-brand">
        <span aria-hidden className="rail-mark">
          A
        </span>
        <span className="rail-wordmark">Artemis</span>
      </div>

      <nav aria-label="Projects and workspaces" className="rail-nav">
        {groups.map((group) => (
          <div className="rail-group" key={group.project.id}>
            <div className="rail-group-head">
              {group.workspaces.length > 1 ? (
                <h2 className="rail-group-label">{group.project.name}</h2>
              ) : (
                <span aria-hidden className="rail-group-spacer" />
              )}
              {group.project.id === "__orphans" ? null : (
                <button
                  aria-label={`New worktree in ${group.project.name}`}
                  className="rail-group-action"
                  onClick={() => onNewWorktree(group.project.id)}
                  title="New worktree"
                  type="button"
                >
                  +
                </button>
              )}
            </div>

            {group.workspaces.map((workspace) => {
              const selected = workspace.id === selectedWorkspaceId;
              const deletable = !isMainCheckout(group.project, workspace);

              return (
                <div className="rail-item-row" key={workspace.id}>
                  <button
                    aria-current={selected ? "true" : undefined}
                    /* Just the name: the dot carries its own label, and
                       "artemis: ready artemis 4" is not a useful thing to hear. */
                    aria-label={workspace.name}
                    className="rail-item"
                    onClick={() => onSelectWorkspace(workspace.id)}
                    type="button"
                  >
                    <StatusDot status={workspace.status} subject={workspace.name} />
                    <span className="rail-item-name">{workspace.name}</span>
                    {workspace.changedFileCount > 0 ? (
                      <span className="rail-item-count mono">
                        {workspace.changedFileCount}
                      </span>
                    ) : null}
                  </button>

                  {selected && deletable ? (
                    <button
                      aria-label={`Delete worktree ${workspace.name}`}
                      className="rail-item-action"
                      onClick={() => onDeleteWorktree(workspace.id)}
                      title="Delete worktree"
                      type="button"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="rail-empty">No git repositories under the scan root.</p>
        ) : null}
      </nav>

      <div className="rail-footer">
        {onCompare ? (
          <button className="rail-footer-button" onClick={onCompare} type="button">
            Compare
          </button>
        ) : null}
        <button className="rail-footer-button" onClick={onOpenSettings} type="button">
          Settings
        </button>
      </div>
    </div>
  );
}
