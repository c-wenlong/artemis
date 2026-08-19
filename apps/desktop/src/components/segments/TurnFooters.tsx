import { useEffect, useState } from "react";
import { workingVerb } from "./workingVerb";
import "./TurnFooters.css";

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/**
 * Live heartbeat for a running turn: a verb and a ticking elapsed.
 *
 * Both Superset and Traycer show elapsed time on an active turn, and the reason
 * is that an agent can be silent for a long stretch while a tool runs. Without
 * this the app looks hung.
 */
export function StreamingFooter({ turnId }: { turnId: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // Measured from when this footer appeared, not from the event's timestamp.
    // That timestamp is the host's clock, and a turn only ever gets a live
    // footer at the moment it starts streaming, so the two agree in the case
    // that matters, and counting locally cannot produce "44m" out of a clock
    // difference or a stale record.
    const mountedAt = Date.now();
    const tick = () => setElapsed(Date.now() - mountedAt);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [turnId]);

  return (
    <p className="turn-footer turn-footer--streaming" data-testid="streaming-footer">
      <span aria-hidden className="turn-footer-pulse" />
      <span>{workingVerb(turnId)}…</span>
      <span className="turn-footer-elapsed mono">{formatDuration(elapsed)}</span>
    </p>
  );
}
