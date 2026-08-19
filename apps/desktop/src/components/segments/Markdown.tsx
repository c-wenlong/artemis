import { Children, Fragment, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { parseFileRefs } from "../../chat/fileRefs";
import { FileChip } from "./FileChip";
import "./Markdown.css";

/**
 * Markdown for assistant prose.
 *
 * Model output is untrusted input: it arrives from a harness that will happily
 * relay whatever the model wrote. `react-markdown` does not render raw HTML
 * unless `rehype-raw` is added, and it is deliberately not added: embedded
 * markup renders as text.
 *
 * Streaming means this is called on partial documents, including unterminated
 * code fences. `react-markdown` handles that by treating the rest as a block,
 * which reads correctly as the fence fills in.
 */

/**
 * Replace file references inside rendered text with chips.
 *
 * react-markdown has no hook for text nodes, so this maps the children of the
 * elements that actually contain prose. Anything inside `code` never reaches
 * here, which is the point: a path in a shell command is part of the command,
 * not a citation.
 */
function chipped(children: ReactNode, known?: ReadonlySet<string>): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const parts = parseFileRefs(child, known);
    if (parts.length === 1 && parts[0]!.kind === "text") return child;

    return parts.map((part, index) =>
      part.kind === "ref" ? (
        <FileChip key={index} line={part.line} path={part.path} />
      ) : (
        <Fragment key={index}>{part.value}</Fragment>
      )
    );
  });
}

interface MarkdownProps {
  children: string;
  /** Files this turn touched, which makes a bare filename safe to chip. */
  known?: ReadonlySet<string>;
}

export function Markdown({ children, known }: MarkdownProps) {
  if (!children.trim()) return null;

  const prose = (content: ReactNode) => chipped(content, known);

  return (
    <div className="markdown" data-testid="markdown">
      <ReactMarkdown
        components={{
          a: ({ children: content, href }) => (
            <a href={href} rel="noopener noreferrer" target="_blank">
              {content}
            </a>
          ),
          // Inline code is a pill; fenced code is a block and keeps its `pre`.
          // The distinction is `className`, which only fenced code carries.
          code: ({ children: content, className }) =>
            className ? (
              <code className={className}>{content}</code>
            ) : (
              <code className="code-pill mono" data-testid="code-pill">
                {content}
              </code>
            ),
          em: ({ children: content }) => <em>{prose(content)}</em>,
          /*
           * An image is described, never fetched.
           *
           * Rendering `<img src="https://…">` makes a request the moment the
           * transcript paints, with no click and no warning. A model that has
           * just read the repository can put anything it found into that URL,
           * so displaying an answer would be enough to send it somewhere. The
           * reference is shown instead, so nothing is hidden and nothing is
           * loaded.
           */
          img: ({ alt, src }) => (
            <span className="markdown-image" data-testid="markdown-image">
              <span className="markdown-image-label">Image</span>
              {alt ? <span className="markdown-image-alt">{alt}</span> : null}
              {typeof src === "string" && src ? (
                <span className="markdown-image-src mono">{src}</span>
              ) : null}
            </span>
          ),
          h1: ({ children: content }) => <h1>{prose(content)}</h1>,
          h2: ({ children: content }) => <h2>{prose(content)}</h2>,
          h3: ({ children: content }) => <h3>{prose(content)}</h3>,
          li: ({ children: content }) => <li>{prose(content)}</li>,
          p: ({ children: content }) => <p>{prose(content)}</p>,
          pre: ({ children: content }) => (
            <pre className="markdown-pre" data-testid="code-block">
              {content}
            </pre>
          ),
          strong: ({ children: content }) => <strong>{prose(content)}</strong>
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
