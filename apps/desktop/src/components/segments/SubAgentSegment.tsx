import { useEffect, useRef, useState } from "react";
import type { SubAgentGroup } from "../../chat/activityGroups";
import "./SubAgentSegment.css";

/**
 * One sub-agent's work, behind its name.
 *
 * A harness that fans work out renders, without this, as an undifferentiated
 * run of tool calls: thirty rows with nothing to say that half belong to an
 * agent reading files and half to one running tests. The name is what makes the
 * shape legible, and the harness already knows it.
 *
 * The chip is the whole presence in the main thread. Everything the agent
 * actually did lives in the panel, because a delegated run is not the reader's
 * work — it is someone else's, summarised, available on request. Inlining it
 * would recreate the problem the milestone exists to fix.
 */

const STATUS_LABEL = {
  running: "running",
  completed: "done",
  errored: "failed"
} as const;

/** First identifying value from a call's input — the path, the command. */
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

export function SubAgentSegment({ group }: { group: SubAgentGroup }) {
  const [open, setOpen] = useState(group.hasFailure);
  const wasFailing = useRef(group.hasFailure);

  // Open on the transition into failure, not only at mount — mid-run is exactly
  // when a call fails, and a group seeded shut would stay shut around the error.
  // Still only a default: the reader can close it again.
  useEffect(() => {
    if (group.hasFailure && !wasFailing.current) setOpen(true);
    wasFailing.current = group.hasFailure;
  }, [group.hasFailure]);

  return (
    <div className="sub-agent" data-active={group.isActive}>
      <button
        aria-expanded={open}
        className="sub-agent-chip"
        data-testid="sub-agent-chip"
        data-tone={group.tone}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span aria-hidden="true" className="sub-agent-dot" />
        <span className="sub-agent-name">{group.agent.name}</span>
        <span className="sub-agent-label">{group.label}</span>
        {group.summary ? (
          <span className="sub-agent-summary mono">{group.summary}</span>
        ) : null}
      </button>

      {open ? (
        <div className="sub-agent-panel" data-testid="sub-agent-panel">
          {group.blocks.map((block) => {
            const summary = callSummary(block.input);
            return (
              <div className="sub-agent-call" key={block.id}>
                <span className="sub-agent-call-name mono">{block.name}</span>
                {summary ? (
                  <span className="sub-agent-call-summary mono">{summary}</span>
                ) : null}
                <span
                  className="sub-agent-call-status"
                  data-status={block.status}
                >
                  {STATUS_LABEL[block.status]}
                </span>
                {block.output ? (
                  <pre className="sub-agent-call-pre mono">{block.output}</pre>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
