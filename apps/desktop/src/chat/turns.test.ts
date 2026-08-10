import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@artemis/core";
import { emptyTranscript, reduceEvents } from "./reduce";

const at = (seconds: number) =>
  `2026-08-10T12:00:${String(seconds).padStart(2, "0")}.000Z`;

const started = (turnId: string, seconds = 0): RuntimeEvent => ({
  id: `${turnId}-s`,
  sessionId: "s1",
  timestamp: at(seconds),
  turnId,
  harnessId: "opencode",
  workspaceId: "ws",
  type: "turn.started"
});

const completed = (turnId: string, seconds: number): RuntimeEvent => ({
  id: `${turnId}-c`,
  sessionId: "s1",
  timestamp: at(seconds),
  turnId,
  type: "turn.completed"
});

const errored = (turnId: string, seconds: number): RuntimeEvent => ({
  id: `${turnId}-e`,
  sessionId: "s1",
  timestamp: at(seconds),
  turnId,
  message: "stopped",
  type: "turn.errored"
});

/**
 * Turn timing exists so the transcript can show "Worked for 27s" on a finished
 * turn and a live elapsed heartbeat on a running one — both Traycer patterns.
 */
describe("turn timing", () => {
  it("records when a turn started", () => {
    const state = reduceEvents(emptyTranscript(), [started("t1", 3)]);
    expect(state.turns.t1).toMatchObject({ startedAt: at(3), status: "running" });
    expect(state.turns.t1?.completedAt).toBeUndefined();
  });

  it("records when a turn completed", () => {
    const state = reduceEvents(emptyTranscript(), [
      started("t1", 0),
      completed("t1", 27)
    ]);
    expect(state.turns.t1).toMatchObject({
      startedAt: at(0),
      completedAt: at(27),
      status: "completed"
    });
  });

  it("marks a failed turn as failed, not completed", () => {
    const state = reduceEvents(emptyTranscript(), [started("t1", 0), errored("t1", 5)]);
    expect(state.turns.t1?.status).toBe("failed");
    expect(state.turns.t1?.completedAt).toBe(at(5));
  });

  it("tracks each turn separately", () => {
    const state = reduceEvents(emptyTranscript(), [
      started("t1", 0),
      completed("t1", 4),
      started("t2", 10)
    ]);
    expect(state.turns.t1?.status).toBe("completed");
    expect(state.turns.t2?.status).toBe("running");
  });

  it("survives a missing turn.started, which a truncated log can produce", () => {
    const state = reduceEvents(emptyTranscript(), [completed("t1", 9)]);
    expect(state.turns.t1?.status).toBe("completed");
    // No start means no duration to claim, rather than a fabricated zero.
    expect(state.turns.t1?.startedAt).toBeUndefined();
  });
});
