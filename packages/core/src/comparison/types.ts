/**
 * One prompt run against several harnesses at once.
 *
 * The wedge: three agents, three isolated worktrees, three diffs, keep one.
 * Isolation is the experiment: two harnesses sharing a checkout overwrite each
 * other and the comparison means nothing, so every entry has its own worktree
 * branched from the same commit.
 */
export interface ComparisonEntry {
  branch: string;
  /** Why this harness has nowhere to run. The others carry on regardless. */
  error?: string;
  harnessId: string;
  /** Absent when the worktree could not be created. */
  path?: string;
  /** Stable id for this entry's workspace, and what names the winner. */
  workspaceId: string;
}

export interface Comparison {
  entries: ComparisonEntry[];
  id: string;
  projectId: string;
  prompt: string;
}

export interface ComparisonRuntime {
  /** Create a worktree per harness, all branched from head. */
  startComparison(
    projectId: string,
    prompt: string,
    harnessIds: string[]
  ): Promise<Comparison>;
  /**
   * Keep one entry and discard the rest.
   *
   * This destroys the losers' uncommitted work, which is the point of a
   * comparison and cannot be undone. The host refuses a winner it does not
   * recognise rather than reading it as "discard everything".
   */
  resolveComparison(run: Comparison, winnerWorkspaceId: string): Promise<void>;
  /** Discard every entry, when none of the answers is worth keeping. */
  abandonComparison(run: Comparison): Promise<void>;
}
