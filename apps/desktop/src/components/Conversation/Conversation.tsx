import type { ReactNode } from "react";
import "./Conversation.css";

interface ConversationProps {
  /** Label of the harness the next turn will go to. */
  harnessLabel: string | null;
  children?: ReactNode;
}

/**
 * The reading surface. A narrow, centred column — Cursor Web's proportions —
 * because this is prose first and a control panel second.
 *
 * M3 fills it with typed segment renderers; M2 establishes the column, the
 * scroll region, and the empty state.
 */
export function Conversation({ harnessLabel, children }: ConversationProps) {
  const isEmpty = children === undefined || children === null;

  return (
    <div aria-label="Conversation" className="conversation" role="log">
      <div className="conversation-column" data-testid="conversation-column">
        {isEmpty ? (
          <div className="conversation-empty" data-testid="conversation-empty">
            <p className="conversation-empty-title">
              {harnessLabel ?? "No harness"} is ready.
            </p>
            <p className="conversation-empty-body">
              Messages, reasoning, and tool activity render here as structured
              blocks. Terminal output stays behind the runtime boundary.
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
