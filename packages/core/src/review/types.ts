export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  path: string;
  kind: ChangeKind;
  additions: number;
  deletions: number;
}

export interface ReviewSnapshot {
  workspaceId: string;
  baseBranch: string;
  files: ChangedFile[];
  artifactPaths: string[];
}

/** A slice of a file, enough to check a claim made about it. */
export interface FileWindow {
  /**
   * The cited line, when the file has one. Null when the citation named no
   * line, or named one past the end — a stale citation must not highlight an
   * unrelated line as though it were the claim.
   */
  focusLine: number | null;
  lines: string[];
  path: string;
  /** 1-based line number of `lines[0]`. */
  startLine: number;
  /** Lines in the whole file, so the window can be placed within it. */
  totalLines: number;
}

export interface ReviewRuntime {
  getReviewSnapshot(workspaceId: string): Promise<ReviewSnapshot>;
  /**
   * Undo one file's worth of an agent's edit by reverse-applying its patch.
   *
   * Rejects rather than forces. If the file has moved on since the agent wrote
   * it, the patch no longer describes it and applying it anyway would corrupt
   * whatever came after, so the host refuses and the message is shown.
   */
  revertFileChange(
    workspacePath: string,
    relativePath: string,
    patch: string
  ): Promise<void>;
  /**
   * Read the lines a citation points at. Rejects for a path that leaves the
   * workspace, a file that is gone, and a binary — each of which the reader
   * needs told rather than shown as an empty window.
   */
  peekFile(
    workspacePath: string,
    relativePath: string,
    line?: number
  ): Promise<FileWindow>;
}
