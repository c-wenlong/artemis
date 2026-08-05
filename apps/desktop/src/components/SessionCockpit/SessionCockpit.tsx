import type { AgentSessionSummary, WorkspaceSummary } from "@artemis/core";
import "./SessionCockpit.css";

interface SessionCockpitProps {
  sessions: AgentSessionSummary[];
  workspaces: WorkspaceSummary[];
}

export function SessionCockpit({ sessions, workspaces }: SessionCockpitProps) {
  const workspaceName = (workspaceId: string) =>
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    "Unknown workspace";

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <article className="session-row" key={session.id}>
          <div className="session-main">
            <div className="session-title-line">
              <h3>{session.title}</h3>
              <span className={`session-status session-${session.status}`}>
                {session.status}
              </span>
            </div>
            <p>
              {session.harness} in {workspaceName(session.workspaceId)}
            </p>
            <pre>{session.terminalPreview}</pre>
          </div>
          {session.attentionReason ? (
            <aside className="attention-box">
              <strong>Attention</strong>
              <span>{session.attentionReason}</span>
            </aside>
          ) : null}
        </article>
      ))}
    </div>
  );
}
