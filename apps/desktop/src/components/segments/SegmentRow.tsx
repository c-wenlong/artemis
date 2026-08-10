import { useId, useState, type ReactNode } from "react";
import "./SegmentRow.css";

interface SegmentRowProps {
  header: ReactNode;
  children?: ReactNode;
  /** Always visible beneath the row — a streaming heartbeat, typically. */
  footer?: ReactNode;
  tone?: "default" | "destructive";
  className?: string;
}

/**
 * Bare collapsible row for activity nested inside a segment. Ported from
 * Traycer's `segments/segment-row.tsx`.
 *
 * No border and no background: the parent already establishes the hierarchy,
 * and a box inside a box reads as two levels of importance when there is only
 * one. This is the difference between a readable stack of tool calls and a
 * wall of nested cards.
 */
export function SegmentRow({
  header,
  children,
  footer,
  tone = "default",
  className
}: SegmentRowProps) {
  const expandable = children !== undefined && children !== null;
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div
      className={["segment-row", className].filter(Boolean).join(" ")}
      data-testid="segment-row"
      data-tone={tone}
    >
      {expandable ? (
        <button
          aria-controls={bodyId}
          aria-expanded={open}
          className="segment-row-trigger"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden className="segment-row-chevron" data-open={open}>
            ›
          </span>
          <span className="segment-row-header">{header}</span>
        </button>
      ) : (
        <div className="segment-row-trigger segment-row-trigger--static">
          {/* Chevron-width spacer so a static row lines up with its siblings. */}
          <span
            aria-hidden
            className="segment-row-chevron segment-row-chevron--hidden"
            data-testid="segment-row-spacer"
          />
          <span className="segment-row-header">{header}</span>
        </div>
      )}

      {expandable && open ? (
        <div className="segment-row-body" id={bodyId}>
          {children}
        </div>
      ) : null}

      {footer ? <div className="segment-row-footer">{footer}</div> : null}
    </div>
  );
}
