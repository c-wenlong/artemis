import type { ChatBlock, ChatMessage } from "@artemis/core";
import "./MessageList.css";

/**
 * Minimal typed rendering of a transcript.
 *
 * M1's job is the stream; M3 replaces this with the SegmentCard / SegmentRow
 * vocabulary from docs/UI_DIRECTION.md — collapsible tool cards, activity
 * grouping, markdown. What matters here is that every block kind already has
 * its own element and `data-testid`, so M3 swaps presentation without touching
 * the data path.
 */

function Block({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case "text":
      return (
        <p className="block-text" data-testid="block-text">
          {block.text}
        </p>
      );

    case "reasoning":
      return (
        <details className="block-reasoning" data-testid="block-reasoning">
          <summary className="block-reasoning-summary">Thinking</summary>
          <p className="block-reasoning-body">{block.text}</p>
        </details>
      );

    case "tool_call":
      return (
        <div
          className="block-tool"
          data-status={block.status}
          data-testid="block-tool_call"
        >
          <div className="block-tool-header">
            <span className="block-tool-name mono">{block.name}</span>
            <span className="block-tool-status">{block.status}</span>
          </div>
          {block.input ? (
            <pre className="block-tool-detail mono">{block.input}</pre>
          ) : null}
          {block.output ? (
            <pre className="block-tool-detail mono">{block.output}</pre>
          ) : null}
        </div>
      );

    case "error":
      return (
        <p className="block-error" data-testid="block-error">
          {block.message}
        </p>
      );

    default:
      return null;
  }
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="message-list">
      {messages.map((message) => (
        <article
          className="message"
          data-role={message.role}
          data-testid={`message-${message.role}`}
          key={message.id}
        >
          {message.blocks.map((block) => (
            <Block block={block} key={block.id} />
          ))}
        </article>
      ))}
    </div>
  );
}
