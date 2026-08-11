import { useEffect, useRef, type ReactNode } from "react";
import type { ChatMessage } from "@artemis/core";
import type { TurnRecord } from "../../chat/reduce";
import { MessageList } from "./MessageList";
import "./Conversation.css";

interface ConversationProps {
  /** Label of the harness the next turn will go to. */
  harnessLabel: string | null;
  messages?: ChatMessage[];
  turns?: Record<string, TurnRecord>;
  isStreaming?: boolean;
  /** Start a new session carrying everything up to a turn. */
  onFork?(turnId: string): void;
  /** Reverse one file's edit. */
  onRevert?(file: { patch?: string; path: string }): Promise<void>;
  children?: ReactNode;
}

/**
 * The reading surface. A narrow, centred column — Cursor Web's proportions —
 * because this is prose first and a control panel second.
 *
 * M3 fills it with typed segment renderers; M2 establishes the column, the
 * scroll region, and the empty state.
 */
export function Conversation({
  harnessLabel,
  messages = [],
  turns = {},
  isStreaming = false,
  onFork,
  onRevert,
  children
}: ConversationProps) {
  const isEmpty = messages.length === 0 && (children === undefined || children === null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Follow the stream. `block: "end"` rather than smooth scrolling: during a
  // fast turn this fires many times a second and animating each one lags.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <div aria-label="Conversation" className="conversation" role="log">
      <div className="conversation-column" data-testid="conversation-column">
        {messages.length > 0 ? (
          <MessageList
            isStreaming={isStreaming}
            messages={messages}
            onFork={onFork}
            onRevert={onRevert}
            turns={turns}
          />
        ) : null}
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
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
