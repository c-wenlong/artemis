import type {
  AgentSessionSummary,
  AssetInventorySnapshot,
  HarnessAsset,
  ProjectRef,
  ReviewSnapshot,
  WorkspaceSummary
} from "@artemis/core";
import { execFileSync } from "node:child_process";
import {
  reviewSnapshotFor,
  seedInventory,
  seedProjects,
  seedSessions,
  seedWorkspaces
} from "../seed.ts";
import { scanHarnesses } from "./scanners/harnessScanner.ts";

export interface NodeSnapshotOptions {
  workspaceRoot: string;
  pathEnv?: string;
  homeDir?: string;
}

export function getNodeInventorySnapshot(
  options: NodeSnapshotOptions
): AssetInventorySnapshot {
  return {
    ...seedInventory,
    capturedAt: new Date().toISOString(),
    harnesses: scanHarnesses({
      includeWorkspaceMentions: true,
      includeVersions: true,
      workspaceRoot: options.workspaceRoot,
      pathEnv: options.pathEnv,
      homeDir: options.homeDir
    })
  };
}

export function listNodeHarnesses(
  options: NodeSnapshotOptions & {
    includeVersions?: boolean;
    includeWorkspaceMentions?: boolean;
  }
): HarnessAsset[] {
  return scanHarnesses({
    includeVersions: options.includeVersions,
    includeWorkspaceMentions: options.includeWorkspaceMentions,
    workspaceRoot: options.workspaceRoot,
    pathEnv: options.pathEnv,
    homeDir: options.homeDir
  });
}

export function listNodeProjects(workspaceRoot: string): ProjectRef[] {
  return seedProjects.map((project) => ({
    ...project,
    rootPath: workspaceRoot
  }));
}

export function listNodeWorkspaces(projectId?: string): WorkspaceSummary[] {
  const workspaces = projectId
    ? seedWorkspaces.filter((workspace) => workspace.projectId === projectId)
    : seedWorkspaces;
  return workspaces.map((workspace) => ({
    ...workspace,
    branch: readGitBranch(workspace.worktreePath) ?? workspace.branch,
    changedFileCount:
      readGitChangedFileCount(workspace.worktreePath) ?? workspace.changedFileCount
  }));
}

export function listNodeSessions(workspaceId?: string): AgentSessionSummary[] {
  return workspaceId
    ? seedSessions.filter((session) => session.workspaceId === workspaceId)
    : seedSessions;
}

export function getNodeReviewSnapshot(workspaceId: string): ReviewSnapshot {
  return reviewSnapshotFor(workspaceId);
}

function readGitBranch(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000
    }).trim();
  } catch {
    return undefined;
  }
}

function readGitChangedFileCount(cwd: string): number | undefined {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000
    }).trim();
    return output ? output.split(/\r?\n/).length : 0;
  } catch {
    return undefined;
  }
}
