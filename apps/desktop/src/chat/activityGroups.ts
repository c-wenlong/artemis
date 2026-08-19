import type { AgentRef, ChatBlock } from "@artemis/core";

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

/**
 * A run of calls made by one sub-agent.
 *
 * Deliberately not an `ActivityGroup` with an extra field. The two read
 * differently and behave differently: an activity group is a fold of the main
 * thread's own mechanics and opens in place, whereas this is another agent's
 * work and opens in a panel. Sharing the type would mean every consumer
 * branching on whether `agent` happens to be set.
 */
export interface SubAgentGroup {
  agent: AgentRef;
  blocks: ToolBlock[];
  id: string;
  failureCount: number;
  hasFailure: boolean;
  /** True while any of this agent's calls is still going. */
  isActive: boolean;
  /** "started working", "ran 4 tools", "ran 4 tools, 1 failed". */
  label: string;
  /** Distinct tool names, capped: "read · grep · bash". */
  summary: string;
  /**
   * Which of a fixed set of accents to render in. Derived from the agent id so
   * one agent keeps its colour across a transcript and two agents in a turn do
   * not collide.
   */
  tone: number;
}

export type TimelineItem =
  | { kind: "block"; block: ChatBlock }
  | { kind: "group"; group: ActivityGroup }
  | { kind: "agent"; group: SubAgentGroup };

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
  // Past tense once finished: Superset's register. A transcript reads as a
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
 *   reasoning renders inline, it also splits an adjacent run: folding across it
 *   would put the group's second half before reasoning that preceded it.
 * - **A run of one is not a group.** Same information, one more layer to open.
 */
/** How many accents the stylesheet defines for sub-agent chips. */
const TONES = 6;

/**
 * A stable accent per agent, from its id.
 *
 * Hashed rather than assigned by order of appearance so that the same agent
 * keeps its colour wherever it appears in a transcript: including after a
 * reload, where order of appearance would be recomputed from a different
 * starting point. Collisions past `TONES` agents are accepted: the name is what
 * identifies the agent, and the colour only has to make a fan-out scannable.
 */
function toneFor(agentId: string): number {
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = (hash * 31 + agentId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % TONES;
}

function toAgentGroup(blocks: ToolBlock[], agent: AgentRef): SubAgentGroup {
  const failureCount = blocks.filter((block) => block.status === "errored").length;
  const isActive = blocks.some((block) => block.status === "running");
  // "started working" while running, because the count is still climbing and a
  // number that changes every second reads as noise rather than progress.
  const label = isActive
    ? "started working"
    : failureCount > 0
      ? `ran ${blocks.length} tools, ${failureCount} failed`
      : `ran ${blocks.length} tools`;

  return {
    agent,
    blocks,
    id: `agent-${agent.id}-${blocks[0]!.id}`,
    failureCount,
    hasFailure: failureCount > 0,
    isActive,
    label,
    summary: summarise(blocks),
    tone: toneFor(agent.id)
  };
}

export function buildTimeline(blocks: ChatBlock[]): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  let run: ToolBlock[] = [];
  // The agent the current run belongs to; undefined means the main thread.
  let runAgent: AgentRef | undefined;

  const flush = () => {
    if (run.length === 0) return;
    if (runAgent) {
      // A delegated run of one is still a group. Unlike a lone tool call, the
      // fact that another agent did it is information the row cannot carry.
      timeline.push({ kind: "agent", group: toAgentGroup(run, runAgent) });
    } else if (run.length === 1) {
      timeline.push({ kind: "block", block: run[0]! });
    } else {
      timeline.push({ kind: "group", group: toGroup(run) });
    }
    run = [];
    runAgent = undefined;
  };

  for (const block of blocks) {
    if (isTool(block)) {
      // Identity, not name: a fan-out of three `explore` workers is three
      // agents, and folding them together would report it as one.
      if (block.agent?.id !== runAgent?.id) flush();
      run.push(block);
      runAgent = block.agent;
      continue;
    }
    flush();
    timeline.push({ kind: "block", block });
  }
  flush();

  return timeline;
}
