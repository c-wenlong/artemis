export type WorkspaceStatus =
  | "ready"
  | "creating"
  | "running"
  | "needs-attention"
  | "error"
  | "archived";

export interface ProjectRef {
  id: string;
  name: string;
  rootPath: string;
  mainBranch: string;
}

export interface WorkspaceSummary {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  worktreePath: string;
  status: WorkspaceStatus;
  activeSessionIds: string[];
  changedFileCount: number;
  lastActivityAt: string;
}

/** The harness and model a workspace was last used with. */
export interface LaunchPreset {
  harnessId: string;
  model: string | null;
}

export interface WorkspaceRuntime {
  listProjects(): Promise<ProjectRef[]>;
  listWorkspaces(projectId?: string): Promise<WorkspaceSummary[]>;
  /** Create a git worktree for `branch`, returning the workspace it becomes. */
  createWorkspace(projectId: string, branch: string): Promise<WorkspaceSummary>;
  /**
   * Remove a worktree. Rejects when it holds uncommitted work unless `force`
   * is set — discarding someone's changes has to be asked for, never inferred.
   */
  deleteWorkspace(workspaceId: string, force: boolean): Promise<void>;
  getLaunchPreset(workspaceId: string): Promise<LaunchPreset | null>;
  saveLaunchPreset(
    workspaceId: string,
    harnessId: string,
    model: string | null
  ): Promise<void>;
}
