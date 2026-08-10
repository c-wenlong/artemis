import type { ChatBlock } from "@artemis/core";
import { Markdown } from "./Markdown";
import { SegmentCard } from "./SegmentCard";
import "./BlockSegments.css";

/**
 * One renderer per block kind. Nothing falls through to raw text — a block the
 * app cannot name is a bug worth seeing, not something to paper over.
 */

export function TextSegment({ text }: { text: string }) {
  return (
    <div className="segment-text" data-testid="segment-text">
      <Markdown>{text}</Markdown>
    </div>
  );
}

/**
 * Reasoning is collapsed by default and rendered quietly. It is context for the
 * answer, not the answer, and a transcript that leads with the model's
 * deliberation buries what the user asked for.
 */
export function ReasoningSegment({ text }: { text: string }) {
  return (
    <div className="segment-reasoning" data-testid="segment-reasoning">
      <SegmentCard header={<span className="segment-muted">Thought for a moment</span>}>
        <div className="segment-reasoning-body">
          <Markdown>{text}</Markdown>
        </div>
      </SegmentCard>
    </div>
  );
}

/** First line of a tool's input, enough to say what it did without opening. */
function toolSummary(block: Extract<ChatBlock, { type: "tool_call" }>): string | null {
  const raw = block.input?.trim();
  if (!raw) return null;

  // Tool input is usually JSON; show the most identifying value rather than
  // the whole object, which is unreadable at one line.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed as Record<string, unknown>);
      const first = values.find((value) => typeof value === "string") as
        | string
        | undefined;
      if (first) return first.split("\n")[0]!.slice(0, 80);
    }
  } catch {
    // Not JSON — fall through to the raw first line.
  }
  return raw.split("\n")[0]!.slice(0, 80);
}

const TOOL_STATUS_LABEL = {
  running: "running",
  completed: "done",
  errored: "failed"
} as const;

export function ToolSegment({
  block
}: {
  block: Extract<ChatBlock, { type: "tool_call" }>;
}) {
  const summary = toolSummary(block);
  const hasDetail = Boolean(block.input || block.output);

  return (
    <div
      className="segment-tool"
      data-status={block.status}
      data-testid="segment-tool_call"
    >
      <SegmentCard
        header={
          <>
            <span className="segment-tool-name mono">{block.name}</span>
            {summary ? (
              <span className="segment-tool-summary mono">{summary}</span>
            ) : null}
            <span className="segment-tool-status">
              {TOOL_STATUS_LABEL[block.status]}
            </span>
          </>
        }
        tone={block.status === "errored" ? "destructive" : "default"}
      >
        {hasDetail ? (
          <div className="segment-tool-detail">
            {block.input ? (
              <>
                <p className="segment-tool-label">input</p>
                <pre className="segment-tool-pre mono">{block.input}</pre>
              </>
            ) : null}
            {block.output ? (
              <>
                <p className="segment-tool-label">output</p>
                <pre className="segment-tool-pre mono">{block.output}</pre>
              </>
            ) : null}
          </div>
        ) : undefined}
      </SegmentCard>
    </div>
  );
}

export function ErrorSegment({ message }: { message: string }) {
  return (
    <div className="segment-error" data-testid="segment-error">
      <SegmentCard
        header={<span className="segment-error-message">{message}</span>}
        tone="destructive"
      />
    </div>
  );
}

export function BlockSegment({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case "text":
      return <TextSegment text={block.text} />;
    case "reasoning":
      return <ReasoningSegment text={block.text} />;
    case "tool_call":
      return <ToolSegment block={block} />;
    case "error":
      return <ErrorSegment message={block.message} />;
    default:
      return null;
  }
}
