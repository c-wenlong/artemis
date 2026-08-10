import ReactMarkdown from "react-markdown";
import "./Markdown.css";

/**
 * Markdown for assistant prose.
 *
 * Model output is untrusted input — it arrives from a harness that will happily
 * relay whatever the model wrote. `react-markdown` does not render raw HTML
 * unless `rehype-raw` is added, and it is deliberately not added: embedded
 * markup renders as text.
 *
 * Streaming means this is called on partial documents, including unterminated
 * code fences. `react-markdown` handles that by treating the rest as a block,
 * which reads correctly as the fence fills in.
 */
export function Markdown({ children }: { children: string }) {
  if (!children.trim()) return null;

  return (
    <div className="markdown" data-testid="markdown">
      <ReactMarkdown
        components={{
          a: ({ children: content, href }) => (
            <a href={href} rel="noopener noreferrer" target="_blank">
              {content}
            </a>
          ),
          pre: ({ children: content }) => (
            <pre className="markdown-pre" data-testid="code-block">
              {content}
            </pre>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
