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

export interface WorkspaceRuntime {
  listProjects(): Promise<ProjectRef[]>;
  listWorkspaces(projectId?: string): Promise<WorkspaceSummary[]>;
}
