import { useEffect, useRef, useState } from "react";
import type { ActivityGroup } from "../../chat/activityGroups";
import { SegmentCard } from "./SegmentCard";
import { SegmentRow } from "./SegmentRow";
import "./ActivityGroupSegment.css";

/** Ticking seconds for a run in progress. */
function GroupElapsed() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const mountedAt = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.round((Date.now() - mountedAt) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="group-elapsed mono" data-testid="group-elapsed">
      {seconds}s
    </span>
  );
}

const STATUS_LABEL = {
  running: "running",
  completed: "done",
  errored: "failed"
} as const;

/** First identifying value from a call's input: the path, the command. */
function callSummary(input: string | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const first = Object.values(parsed as Record<string, unknown>).find(
        (value) => typeof value === "string"
      ) as string | undefined;
      if (first) return first.split("\n")[0]!.slice(0, 60);
    }
  } catch {
    // Not JSON.
  }
  return raw.split("\n")[0]!.slice(0, 60);
}

/**
 * A run of consecutive tool calls, folded into one line.
 *
 * The group is the card; each call inside is a borderless row. That is the
 * whole point of having two primitives: nesting cards inside cards would make
 * a run of thirty calls look like thirty separate events of equal weight.
 *
 * A group holding a failure opens itself. Collapsing an error out of sight is
 * how a bug survives a code review.
 */
export function ActivityGroupSegment({ group }: { group: ActivityGroup }) {
  const [open, setOpen] = useState(group.hasFailure);
  const wasFailing = useRef(group.hasFailure);

  // Open on the transition into failure, not just at mount. Mid-run is exactly
  // when a call fails, and `defaultOpen` would have left the group folded shut
  // around the error. Still only a default: the reader can close it again.
  useEffect(() => {
    if (group.hasFailure && !wasFailing.current) setOpen(true);
    wasFailing.current = group.hasFailure;
  }, [group.hasFailure]);

  return (
    <div
      className="activity-group"
      data-active={group.isActive}
      data-testid="activity-group"
    >
      <SegmentCard
        onOpenChange={setOpen}
        open={open}
        header={
          <>
            <span className="activity-group-label">{group.label}</span>
            <span className="activity-group-summary mono">{group.summary}</span>
            {group.isActive ? <GroupElapsed /> : null}
          </>
        }
        tone={group.hasFailure ? "destructive" : "default"}
      >
        <div className="activity-group-rows">
          {group.blocks.map((block) => {
            const summary = callSummary(block.input);
            const hasDetail = Boolean(block.input || block.output);

            return (
              <SegmentRow
                header={
                  <>
                    <span className="activity-call-name mono">{block.name}</span>
                    {summary ? (
                      <span className="activity-call-summary mono">{summary}</span>
                    ) : null}
                    <span
                      className="activity-call-status"
                      data-status={block.status}
                    >
                      {STATUS_LABEL[block.status]}
                    </span>
                  </>
                }
                key={block.id}
                tone={block.status === "errored" ? "destructive" : "default"}
              >
                {hasDetail ? (
                  <div className="activity-call-detail">
                    {block.input ? (
                      <pre className="activity-call-pre mono">{block.input}</pre>
                    ) : null}
                    {block.output ? (
                      <pre className="activity-call-pre mono">{block.output}</pre>
                    ) : null}
                  </div>
                ) : undefined}
              </SegmentRow>
            );
          })}
        </div>
      </SegmentCard>
    </div>
  );
}
