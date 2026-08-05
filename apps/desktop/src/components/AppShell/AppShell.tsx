import { useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type {
  AgentSessionSummary,
  ProjectRef,
  WorkspaceSummary
} from "@artemis/core";
import "./AppShell.css";

export type AppSection =
  | "workbench"
  | "projects"
  | "chat"
  | "review"
  | "settings";

interface AppShellProps {
  activeSection: AppSection;
  children: React.ReactNode;
  isLoading: boolean;
  projects: ProjectRef[];
  selectedWorkspace: WorkspaceSummary | null;
  sessions: AgentSessionSummary[];
  workspaces: WorkspaceSummary[];
  onSectionChange(section: AppSection): void;
}

const sections: Array<{ icon: string; id: AppSection; label: string }> = [
  { icon: ">", id: "workbench", label: "Workbench" },
  { icon: "P", id: "projects", label: "Projects" },
  { icon: "$", id: "chat", label: "Chat" },
  { icon: "R", id: "review", label: "Review" },
  { icon: "S", id: "settings", label: "Settings" }
];

const sectionMeta: Record<AppSection, { label: string; title: string }> = {
  workbench: { label: "local://workspace", title: "Workbench" },
  projects: { label: "local://projects", title: "Projects" },
  chat: { label: "localhost:4637", title: "Chat" },
  review: { label: "workspace review", title: "Review" },
  settings: { label: "configuration", title: "Settings" }
};

export function AppShell({
  activeSection,
  children,
  isLoading,
  projects,
  selectedWorkspace,
  sessions,
  workspaces,
  onSectionChange
}: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(176);
  const waitingSessions = sessions.filter(
    (session) => session.status === "waiting"
  ).length;
  const meta = sectionMeta[activeSection];

  function beginSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setSidebarWidth(Math.min(300, Math.max(132, nextWidth)));
    }

    function stopResize() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  }

  return (
    <div
      className="app-shell"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <h1>Artemis</h1>
            <p>Coding Orchestrator</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {sections.map((section) => (
            <button
              className={section.id === activeSection ? "active" : ""}
              key={section.id}
              type="button"
              onClick={() => onSectionChange(section.id)}
            >
              <span className="nav-icon" aria-hidden="true">
                {section.icon}
              </span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-summary">
          <span>{projects.length} project</span>
          <span>{workspaces.length} checkout</span>
          <span>{waitingSessions} needs attention</span>
        </div>
        <button
          aria-label="Resize sidebar"
          className="sidebar-resizer"
          type="button"
          onPointerDown={beginSidebarResize}
        />
      </aside>

      <main className="main-surface">
        <header className="topbar">
          <div>
            <p className="section-label">{meta.label}</p>
            <h2>{meta.title === "Review" ? selectedWorkspace?.name ?? meta.title : meta.title}</h2>
          </div>
          <div className="runtime-state">
            <span className={isLoading ? "pulse-dot loading" : "pulse-dot"} />
            {isLoading ? "Syncing local state" : "Local host ready"}
          </div>
        </header>
        <section className={`content-region content-${activeSection}`}>
          {children}
        </section>
      </main>
    </div>
  );
}
