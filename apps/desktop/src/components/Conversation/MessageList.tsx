import { useEffect, useState } from "react";
import type { ChatBlock, ChatMessage, TranscriptVerbosity } from "@artemis/core";
import { buildTimeline } from "../../chat/activityGroups";
import { deriveFileEdits, type FileEdit } from "../../chat/fileEdits";
import type { TurnRecord } from "../../chat/reduce";
import { ActivityGroupSegment } from "../segments/ActivityGroupSegment";
import { BlockSegment } from "../segments/BlockSegments";
import { StreamingFooter } from "../segments/TurnFooters";
import {
  CopyButton,
  EditSummaryCard,
  ForkButton,
  MessageTime,
  Truncate,
  TurnHeader
} from "./MessageChrome";
import "./MessageList.css";

interface MessageListProps {
  messages: ChatMessage[];
  turns: Record<string, TurnRecord>;
  /** Whether a turn is actually streaming right now. */
  isStreaming?: boolean;
  /** Start a new session carrying everything up to this turn. */
  onFork?(turnId: string): void;
  /** Reverse one file's edit. Rejects when the host refuses. */
  onRevert?(file: FileEdit): Promise<void>;
  /** How much of a finished turn to render. Defaults to everything. */
  verbosity?: TranscriptVerbosity;
}

/** Prose is the answer; everything else is how it was reached. */
function isProse(block: ChatBlock): boolean {
  return block.type === "text" || block.type === "error";
}

function plainText(blocks: readonly ChatBlock[]): string {
  return blocks
    .filter((block): block is Extract<ChatBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function Timeline({ blocks }: { blocks: ChatMessage["blocks"] }) {
  return (
    <>
      {buildTimeline(blocks).map((item) =>
        item.kind === "group" ? (
          <ActivityGroupSegment group={item.group} key={item.group.id} />
        ) : (
          <BlockSegment block={item.block} key={item.block.id} />
        )
      )}
    </>
  );
}

/**
 * One assistant turn: a header saying how long it took, the answer, a summary
 * of what it changed, and the actions that close it out.
 *
 * The header is what gives the mechanics somewhere to go. Superset and Traycer
 * both lead with the tool trace, and reading either means scrolling past the
 * work to find the answer; folding it away is the difference.
 */
function AssistantTurn({
  isLive,
  message,
  onFork,
  onRevert,
  turn,
  verbosity
}: {
  isLive: boolean;
  message: ChatMessage;
  onFork?(turnId: string): void;
  onRevert?(file: FileEdit): Promise<void>;
  turn?: TurnRecord;
  verbosity: TranscriptVerbosity;
}) {
  // The setting decides where a turn starts; the header still opens any of
  // them. Keyed on the setting rather than seeded once, so changing it in
  // Settings reflows the transcript already on screen instead of applying to
  // the next session only.
  const [override, setOverride] = useState<boolean | null>(null);
  useEffect(() => setOverride(null), [verbosity]);
  const expanded = override ?? verbosity !== "output";

  const prose = message.blocks.filter(isProse);
  const hasActivity = prose.length !== message.blocks.length;
  const edits = deriveFileEdits(message.blocks);
  const isFinished = turn?.status === "completed" || turn?.status === "failed";

  // A bare filename is only safe to chip once something else confirms it is a
  // file. Having been edited this turn is that confirmation.
  const known = new Set(edits?.files.map((file) => file.path) ?? []);

  return (
    <article
      className="message"
      data-role="assistant"
      data-testid="message-assistant"
    >
      {!isLive && isFinished ? (
        <TurnHeader
          completedAt={turn?.completedAt}
          expanded={expanded}
          hasActivity={hasActivity}
          onToggle={() => setOverride(!expanded)}
          startedAt={turn?.startedAt}
        />
      ) : null}

      {expanded || isLive ? (
        <Timeline blocks={message.blocks} />
      ) : (
        prose.map((block) => (
          <BlockSegment block={block} key={block.id} known={known} />
        ))
      )}

      {edits ? <EditSummaryCard onRevert={onRevert} summary={edits} /> : null}

      {isLive ? <StreamingFooter turnId={message.turnId} /> : null}
      {!isLive && isFinished ? (
        <div className="turn-actions" data-testid="turn-actions">
          <CopyButton label="Copy answer" text={plainText(prose)} />
          {onFork ? <ForkButton onFork={() => onFork(message.turnId)} /> : null}
          <MessageTime at={turn?.completedAt} />
        </div>
      ) : null}
    </article>
  );
}

export function MessageList({
  messages,
  turns,
  isStreaming = false,
  onFork,
  onRevert,
  verbosity = "full"
}: MessageListProps) {
  const lastTurnId = messages.at(-1)?.turnId;

  return (
    <div className="message-list">
      {messages.map((message) => {
        const turn = turns[message.turnId];

        if (message.role !== "assistant") {
          const text = plainText(message.blocks);
          return (
            <article
              className="message"
              data-role={message.role}
              data-testid={`message-${message.role}`}
              key={message.id}
            >
              <Truncate text={text}>
                <Timeline blocks={message.blocks} />
              </Truncate>
              <div className="message-meta">
                <MessageTime at={message.createdAt} />
                <CopyButton label="Copy message" text={text} />
              </div>
            </article>
          );
        }

        // A live heartbeat requires the session to actually be streaming, not
        // merely a turn record that says "running". A log whose terminal event
        // was never written replays as an unfinished turn, and animating a
        // ticking timer for work that stopped hours ago is a lie.
        return (
          <AssistantTurn
            isLive={isStreaming && message.turnId === lastTurnId}
            key={message.id}
            message={message}
            onFork={onFork}
            onRevert={onRevert}
            turn={turn}
            verbosity={verbosity}
          />
        );
      })}
    </div>
  );
}
