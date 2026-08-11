import { parseUnifiedDiff } from "../../chat/diff";
import "./DiffView.css";

/**
 * A file's diff, as the harness reported it.
 *
 * Line numbers are shown on both sides because the question a reader asks of a
 * diff is "where", and a hunk without them only answers "what". The marker
 * column carries the +/- as text as well as colour — the diff must be readable
 * without relying on hue alone.
 */
export function DiffView({ patch }: { patch: string }) {
  const hunks = parseUnifiedDiff(patch);
  if (hunks.length === 0) return null;

  return (
    <div className="diff-view" data-testid="diff-view">
      {hunks.map((hunk) => (
        <div className="diff-hunk" key={hunk.header}>
          <div className="diff-hunk-header mono">{hunk.header}</div>
          {hunk.lines.map((line, index) => (
            <div
              className="diff-line mono"
              data-kind={line.kind}
              data-testid="diff-line"
              key={`${hunk.header}-${index}`}
            >
              <span className="diff-gutter">{line.oldNumber ?? ""}</span>
              <span className="diff-gutter">{line.newNumber ?? ""}</span>
              <span aria-hidden className="diff-marker">
                {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
              </span>
              <span className="diff-text">{line.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
