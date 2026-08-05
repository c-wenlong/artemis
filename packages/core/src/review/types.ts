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
}
