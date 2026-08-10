import type { ProjectRef, WorkspaceSummary } from "@artemis/core";
import { StatusDot } from "../StatusDot/StatusDot";
import "./Rail.css";

interface RailProps {
  projects: ProjectRef[];
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  onSelectWorkspace(workspaceId: string): void;
  onOpenSettings(): void;
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
 * Left rail: projects resolved down to the workspaces you actually open.
 *
 * A project heading appears only when it holds more than one workspace — until
 * M5 adds worktrees that is the common case, and "artemis › artemis" is noise,
 * not hierarchy.
 */
export function Rail({
  projects,
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onOpenSettings
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
            {group.workspaces.length > 1 ? (
              <h2 className="rail-group-label">{group.project.name}</h2>
            ) : null}
            {group.workspaces.map((workspace) => (
              <button
                aria-current={workspace.id === selectedWorkspaceId ? "true" : undefined}
                className="rail-item"
                key={workspace.id}
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
            ))}
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="rail-empty">No git repositories under the scan root.</p>
        ) : null}
      </nav>

      <div className="rail-footer">
        <button className="rail-footer-button" onClick={onOpenSettings} type="button">
          Settings
        </button>
      </div>
    </div>
  );
}
