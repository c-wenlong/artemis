import type { WorkspaceStatus } from "@artemis/core";
import "./StatusDot.css";

const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  ready: "ready",
  creating: "creating",
  running: "running",
  "needs-attention": "needs attention",
  error: "error",
  archived: "archived"
};

interface StatusDotProps {
  status: WorkspaceStatus;
  /** Prefixes the accessible label, e.g. "artemis: ready". */
  subject: string;
}

/**
 * Workspace state as a dot rather than a text badge: Superset's pattern. Idle,
 * running, and needs-attention become legible in peripheral vision, and a rail
 * of twenty workspaces stays scannable. The label carries the same information
 * for anyone who is not reading colour.
 */
export function StatusDot({ status, subject }: StatusDotProps) {
  return (
    <span
      aria-label={`${subject}: ${STATUS_LABEL[status]}`}
      className="status-dot"
      data-status={status}
      role="img"
    />
  );
}
