import { useId, useState, type ReactNode } from "react";
import "./SegmentCard.css";

export type SegmentTone = "default" | "destructive" | "primary";

interface SegmentCardProps {
  header: ReactNode;
  /** Absent means there is nothing to expand and no toggle is rendered. */
  children?: ReactNode;
  /** Always visible beneath the header, open or closed. */
  collapsedPreview?: ReactNode;
  /** Trailing control outside the toggle, e.g. a copy button. */
  headerAction?: ReactNode;
  defaultOpen?: boolean;
  tone?: SegmentTone;
  className?: string;
}

/**
 * Chip→card shell for a top-level segment. Ported from Traycer's
 * `segments/segment-card.tsx`; the rules below are theirs and each one earns
 * its place in a transcript with thirty tool calls in it.
 *
 * - The whole header is the click target. A separate chevron is a smaller
 *   target for the same action.
 * - No body means no toggle at all, rather than a chevron that reveals
 *   nothing.
 * - Three tones only. More would turn colour into decoration; here it still
 *   means state.
 */
export function SegmentCard({
  header,
  children,
  collapsedPreview,
  headerAction,
  defaultOpen = false,
  tone = "default",
  className
}: SegmentCardProps) {
  const expandable = children !== undefined && children !== null;
  const [open, setOpen] = useState(defaultOpen && expandable);
  const bodyId = useId();

  return (
    <div
      className={["segment-card", className].filter(Boolean).join(" ")}
      data-expandable={expandable}
      data-testid="segment-card"
      data-tone={tone}
    >
      <div className="segment-card-head">
        {expandable ? (
          <button
            aria-controls={bodyId}
            aria-expanded={open}
            className="segment-card-trigger"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden className="segment-card-chevron" data-open={open}>
              ›
            </span>
            <span className="segment-card-header">{header}</span>
          </button>
        ) : (
          <div className="segment-card-trigger segment-card-trigger--static">
            {/* Keeps a static header aligned with its expandable siblings. */}
            <span aria-hidden className="segment-card-chevron segment-card-chevron--hidden" />
            <span className="segment-card-header">{header}</span>
          </div>
        )}
        {headerAction}
      </div>

      {collapsedPreview ? (
        <div className="segment-card-preview">{collapsedPreview}</div>
      ) : null}

      {expandable && open ? (
        <div className="segment-card-body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
