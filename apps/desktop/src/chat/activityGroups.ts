import type { ChatBlock } from "@artemis/core";

type ToolBlock = Extract<ChatBlock, { type: "tool_call" }>;

export interface ActivityGroup {
  id: string;
  blocks: ToolBlock[];
  /** True while any call in the run is still going. */
  isActive: boolean;
  failureCount: number;
  hasFailure: boolean;
  /** Header line: "Ran 3 tools", "Running 2 tools", "Ran 3 tools, 2 failed". */
  label: string;
  /** Distinct tool names, capped: "bash · read · grep". */
  summary: string;
}

export type TimelineItem =
  | { kind: "block"; block: ChatBlock }
  | { kind: "group"; group: ActivityGroup };

/** Beyond this the header stops being a summary and starts being a list. */
const MAX_NAMES = 3;

function isTool(block: ChatBlock): block is ToolBlock {
  return block.type === "tool_call";
}

function summarise(blocks: ToolBlock[]): string {
  const names: string[] = [];
  for (const block of blocks) {
    if (!names.includes(block.name)) names.push(block.name);
  }
  if (names.length <= MAX_NAMES) return names.join(" · ");
  const shown = names.slice(0, MAX_NAMES).join(" · ");
  return `${shown} · +${names.length - MAX_NAMES} more`;
}

function describe(blocks: ToolBlock[], isActive: boolean, failures: number): string {
  // Past tense once finished — Superset's register. A transcript reads as a
  // record of what happened, not a status board.
  const verb = isActive ? "Running" : "Ran";
  const base = `${verb} ${blocks.length} tools`;
  return failures > 0 ? `${base}, ${failures} failed` : base;
}

function toGroup(blocks: ToolBlock[]): ActivityGroup {
  const failureCount = blocks.filter((block) => block.status === "errored").length;
  const isActive = blocks.some((block) => block.status === "running");
  return {
    id: `group-${blocks[0]!.id}`,
    blocks,
    isActive,
    failureCount,
    hasFailure: failureCount > 0,
    label: describe(blocks, isActive, failureCount),
    summary: summarise(blocks)
  };
}

/**
 * Fold a message's blocks into a render timeline, collapsing consecutive tool
 * calls into one group.
 *
 * This is what makes a thirty-call turn readable: the mechanics fold into a
 * line, and the prose the user actually asked for stays in view. Ported in
 * spirit from Traycer's `chat-activity-groups.ts`.
 *
 * Two rules from that source are worth stating:
 *
 * - **Reasoning is promoted out.** Groups carry only operational work. Since
 *   reasoning renders inline, it also splits an adjacent run — folding across it
 *   would put the group's second half before reasoning that preceded it.
 * - **A run of one is not a group.** Same information, one more layer to open.
 */
export function buildTimeline(blocks: ChatBlock[]): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  let run: ToolBlock[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      timeline.push({ kind: "block", block: run[0]! });
    } else {
      timeline.push({ kind: "group", group: toGroup(run) });
    }
    run = [];
  };

  for (const block of blocks) {
    if (isTool(block)) {
      run.push(block);
      continue;
    }
    flush();
    timeline.push({ kind: "block", block });
  }
  flush();

  return timeline;
}
