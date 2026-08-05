import type { HarnessKind } from "../catalog/types";

export type AgentSessionStatus =
  | "queued"
  | "running"
  | "waiting"
  | "complete"
  | "failed"
  | "stopped";

export interface AgentSessionSummary {
  id: string;
  workspaceId: string;
  harness: HarnessKind;
  title: string;
  status: AgentSessionStatus;
  startedAt: string;
  lastEventAt: string;
  attentionReason?: string;
  terminalPreview: string;
}

export interface AgentLaunchRequest {
  harnessId: string;
  prompt: string;
  startPath?: string;
  workspaceId: string;
  workspacePath: string;
}

export interface AgentLaunchResult {
  args: string[];
  command: string;
  completedAt: string;
  cwd: string;
  error?: string;
  exitCode?: number;
  ok: boolean;
  startedAt: string;
  stderr: string;
  stdout: string;
  timedOut?: boolean;
}

export interface AgentRuntime {
  listSessions(workspaceId?: string): Promise<AgentSessionSummary[]>;
  launchAgent(request: AgentLaunchRequest): Promise<AgentLaunchResult>;
}
