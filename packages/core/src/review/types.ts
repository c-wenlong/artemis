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
}
