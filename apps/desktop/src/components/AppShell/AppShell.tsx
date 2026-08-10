import type { ReactNode } from "react";
import "./AppShell.css";

interface AppShellProps {
  rail: ReactNode;
  conversation: ReactNode;
  composer: ReactNode;
  /** Right dock — the terminal, once M6 lands. */
  dock?: ReactNode;
}

/**
 * Rail, conversation, composer, optional dock.
 *
 * The previous shell offered five equal-weight destinations, which said all
 * five mattered equally. They do not: the conversation is the app, and
 * everything else is chrome around it.
 *
 * Conversation and composer are separate slots rather than free children so the
 * shell owns the gutter both sides share. When each managed its own padding the
 * two columns disagreed by 2rem and visibly failed to line up.
 */
export function AppShell({ rail, conversation, composer, dock }: AppShellProps) {
  return (
    <div className="app-shell">
      {rail}
      <main className="app-main">
        <div className="app-conversation">{conversation}</div>
        <div className="app-composer">{composer}</div>
      </main>
      {dock ? <aside className="app-dock">{dock}</aside> : null}
    </div>
  );
}
