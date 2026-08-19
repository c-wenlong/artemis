import { useEffect, useRef, type ReactNode } from "react";
import type { ChatMessage, TranscriptVerbosity } from "@artemis/core";
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
  /** How much of a finished turn to render. */
  verbosity?: TranscriptVerbosity;
  /**
   * Set when the chosen harness has no adapter. It is not broken: Artemis
   * simply cannot parse it into segments, and a terminal runs it properly.
   */
  onOpenInTerminal?(): void;
  children?: ReactNode;
}

/**
 * The reading surface. A narrow, centred column: Cursor Web's proportions,
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
  verbosity,
  onOpenInTerminal,
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
            verbosity={verbosity}
          />
        ) : null}
        {isEmpty && onOpenInTerminal ? (
          <div className="conversation-empty" data-testid="dock-only-notice">
            <p className="conversation-empty-title">
              {harnessLabel ?? "This harness"} runs in a terminal.
            </p>
            <p className="conversation-empty-body">
              Artemis renders a transcript for the harnesses it can parse.
              This one it cannot, so it runs for real in the dock instead of
              being shown half-rendered here.
            </p>
            <button
              className="settings-save"
              onClick={onOpenInTerminal}
              type="button"
            >
              Open in terminal
            </button>
          </div>
        ) : isEmpty ? (
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
