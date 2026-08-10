import type { ChatMessage } from "@artemis/core";
import type { TurnRecord } from "../../chat/reduce";
import { BlockSegment } from "../segments/BlockSegments";
import { StreamingFooter, TurnFooter } from "../segments/TurnFooters";
import "./MessageList.css";

interface MessageListProps {
  messages: ChatMessage[];
  turns: Record<string, TurnRecord>;
  /** Whether a turn is actually streaming right now. */
  isStreaming?: boolean;
}

/**
 * A transcript as typed segments.
 *
 * Dispatch lives in `BlockSegment`; this owns the per-turn framing — the user's
 * prompt as a bordered box, and the footer that closes a turn.
 */
export function MessageList({
  messages,
  turns,
  isStreaming = false
}: MessageListProps) {
  const lastTurnId = messages.at(-1)?.turnId;

  return (
    <div className="message-list">
      {messages.map((message) => {
        const turn = turns[message.turnId];
        // The footer belongs to the assistant half of a turn.
        if (message.role !== "assistant") {
          return (
            <article
              className="message"
              data-role={message.role}
              data-testid={`message-${message.role}`}
              key={message.id}
            >
              {message.blocks.map((block) => (
                <BlockSegment block={block} key={block.id} />
              ))}
            </article>
          );
        }

        // A live heartbeat requires the session to actually be streaming, not
        // merely a turn record that says "running". A log whose terminal event
        // was never written replays as an unfinished turn, and animating a
        // ticking timer for work that stopped hours ago is a lie.
        const isLive = isStreaming && message.turnId === lastTurnId;
        const isFinished = turn?.status === "completed" || turn?.status === "failed";

        return (
          <article
            className="message"
            data-role={message.role}
            data-testid="message-assistant"
            key={message.id}
          >
            {message.blocks.map((block) => (
              <BlockSegment block={block} key={block.id} />
            ))}

            {isLive ? <StreamingFooter turnId={message.turnId} /> : null}
            {!isLive && isFinished ? (
              <TurnFooter completedAt={turn?.completedAt} startedAt={turn?.startedAt} />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
