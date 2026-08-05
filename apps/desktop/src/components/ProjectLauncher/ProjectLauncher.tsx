import { useMemo, useState } from "react";
import type {
  AgentSessionSummary,
  ProjectRef,
  WorkspaceSummary
} from "@artemis/core";
import "./ProjectLauncher.css";

interface ProjectLauncherProps {
  projects: ProjectRef[];
  selectedWorkspaceId: string | null;
  sessions: AgentSessionSummary[];
  workspaces: WorkspaceSummary[];
  onOpenChat(): void;
  onSelectWorkspace(workspaceId: string): void;
}

export function ProjectLauncher({
  projects,
  selectedWorkspaceId,
  sessions,
  workspaces,
  onOpenChat,
  onSelectWorkspace
}: ProjectLauncherProps) {
  const [notice, setNotice] = useState(
    "Current checkout is ready. Project creation and GitHub linking are scaffolded as host actions."
  );

  const projectRows = useMemo(
    () =>
      projects.map((project) => {
        const projectWorkspaces = workspaces.filter(
          (workspace) => workspace.projectId === project.id
        );
        const changedFiles = projectWorkspaces.reduce(
          (total, workspace) => total + workspace.changedFileCount,
          0
        );
        const activeSessions = sessions.filter((session) =>
          projectWorkspaces.some((workspace) => workspace.id === session.workspaceId)
        );

        return {
          activeSessions,
          changedFiles,
          project,
          workspaces: projectWorkspaces
        };
      }),
    [projects, sessions, workspaces]
  );

  function openProject(workspaceId?: string) {
    if (workspaceId) {
      onSelectWorkspace(workspaceId);
    }
    onOpenChat();
  }

  return (
    <div className="project-launcher">
      <header className="launcher-head">
        <div>
          <p>Local projects</p>
          <h2>Choose where Artemis should work</h2>
        </div>
        <div className="launcher-actions">
          <button
            type="button"
            onClick={() =>
              setNotice("Open project will connect to the host file picker next.")
            }
          >
            Open local project
          </button>
          <button
            type="button"
            onClick={() =>
              setNotice("New project will create a fresh repo/worktree from here.")
            }
          >
            New project
          </button>
          <button
            type="button"
            onClick={() =>
              setNotice("GitHub linking is reserved for the upcoming provider setup.")
            }
          >
            Link GitHub
          </button>
        </div>
      </header>

      <p className="launcher-notice">{notice}</p>

      <section className="project-table" aria-label="Projects">
        {projectRows.map(({ activeSessions, changedFiles, project, workspaces: rows }) => {
          const primaryWorkspace =
            rows.find((workspace) => workspace.id === selectedWorkspaceId) ??
            rows[0];

          return (
            <article className="project-row" key={project.id}>
              <div className="project-main">
                <h3>{project.name}</h3>
                <p>{project.rootPath}</p>
              </div>

              <div className="project-workspaces">
                {rows.map((workspace) => (
                  <button
                    className={
                      workspace.id === selectedWorkspaceId
                        ? "workspace-chip active"
                        : "workspace-chip"
                    }
                    key={workspace.id}
                    type="button"
                    onClick={() => onSelectWorkspace(workspace.id)}
                  >
                    {workspace.name}
                  </button>
                ))}
              </div>

              <div className="project-stats">
                <span>{project.mainBranch}</span>
                <span>{changedFiles} changed</span>
                <span>{activeSessions.length} sessions</span>
              </div>

              <button
                className="open-chat"
                type="button"
                onClick={() => openProject(primaryWorkspace?.id)}
              >
                Open chat
              </button>
            </article>
          );
        })}
      </section>
    </div>
  );
}
