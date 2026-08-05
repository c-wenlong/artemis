import type { AgentSessionSummary, WorkspaceSummary } from "@artemis/core";
import "./WorkspaceBoard.css";

interface WorkspaceBoardProps {
  selectedWorkspaceId: string | null;
  sessions: AgentSessionSummary[];
  workspaces: WorkspaceSummary[];
  onSelectWorkspace(workspaceId: string): void;
}

export function WorkspaceBoard({
  selectedWorkspaceId,
  sessions,
  workspaces,
  onSelectWorkspace
}: WorkspaceBoardProps) {
  return (
    <div className="workspace-board">
      {workspaces.map((workspace) => {
        const workspaceSessions = sessions.filter(
          (session) => session.workspaceId === workspace.id
        );
        return (
          <button
            aria-label={`Select workspace ${workspace.name}`}
            className={
              workspace.id === selectedWorkspaceId
                ? "workspace-card selected"
                : "workspace-card"
            }
            key={workspace.id}
            type="button"
            onClick={() => onSelectWorkspace(workspace.id)}
          >
            <div className="workspace-card-header">
              <div>
                <h3>{workspace.name}</h3>
                <p>{workspace.branch}</p>
              </div>
              <span className={`status status-${workspace.status}`}>
                {workspace.status}
              </span>
            </div>
            <div className="workspace-meta">
              <span>{workspace.changedFileCount} changed files</span>
              <span>{workspaceSessions.length} sessions</span>
              <span>{workspace.worktreePath}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
