import { useCallback, useState } from "react";
import type { Comparison, RuntimeEvent } from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import { reduceEvents, type Transcript } from "./reduce";

export type EntryStatus = "idle" | "running" | "done" | "failed";

export interface EntryState {
  status: EntryStatus;
  transcript: Transcript;
  error?: string;
}

export interface ComparisonController {
  run: Comparison | null;
  /** Per entry, keyed by workspace id. */
  states: Record<string, EntryState>;
  error: string | null;
  isStarting: boolean;
  start(projectId: string, prompt: string, harnessIds: string[]): Promise<void>;
  keep(winnerWorkspaceId: string): Promise<boolean>;
  discardAll(): Promise<boolean>;
  clearError(): void;
}

const EMPTY: Transcript = { messages: [], status: "idle", turns: {} };

/**
 * One prompt, several harnesses, running at once.
 *
 * The host creates a worktree per harness; this fans the prompt out across
 * them and folds each stream into its own transcript. They run concurrently
 * because the point is to compare answers, and running them in series would
 * take as long as the slowest three put together.
 *
 * A harness that fails keeps its place with a status rather than disappearing:
 * "this one could not do it" is a comparison result.
 */
export function useComparison(host: ArtemisHostClient): ComparisonController {
  const [run, setRun] = useState<Comparison | null>(null);
  const [states, setStates] = useState<Record<string, EntryState>>({});
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setStarting] = useState(false);

  const start = useCallback(
    async (projectId: string, prompt: string, harnessIds: string[]) => {
      setStarting(true);
      setError(null);
      let started: Comparison;
      try {
        started = await host.startComparison(projectId, prompt, harnessIds);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStarting(false);
        return;
      }

      setRun(started);
      setStates(
        Object.fromEntries(
          started.entries.map((entry) => [
            entry.workspaceId,
            {
              error: entry.error,
              status: entry.error ? ("failed" as const) : ("running" as const),
              transcript: EMPTY
            }
          ])
        )
      );
      setStarting(false);

      const update = (id: string, patch: Partial<EntryState>) =>
        setStates((current) => ({
          ...current,
          [id]: { ...current[id]!, ...patch }
        }));

      await Promise.all(
        started.entries
          .filter((entry) => !entry.error && entry.path)
          .map(async (entry) => {
            try {
              const session = await host.createChatSession({
                harnessId: entry.harnessId,
                workspaceId: entry.workspaceId,
                workspacePath: entry.path!
              });
              await host.streamChatMessage(session.id, { prompt }, (events: RuntimeEvent[]) =>
                setStates((current) => {
                  const previous = current[entry.workspaceId];
                  if (!previous) return current;
                  return {
                    ...current,
                    [entry.workspaceId]: {
                      ...previous,
                      transcript: reduceEvents(previous.transcript, events)
                    }
                  };
                })
              );
              update(entry.workspaceId, { status: "done" });
            } catch (cause) {
              // One harness failing is a result, not an error for the run.
              update(entry.workspaceId, {
                error: cause instanceof Error ? cause.message : String(cause),
                status: "failed"
              });
            }
          })
      );
    },
    [host]
  );

  const keep = useCallback(
    async (winnerWorkspaceId: string) => {
      if (!run) return false;
      try {
        await host.resolveComparison(run, winnerWorkspaceId);
        setRun(null);
        setStates({});
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    [host, run]
  );

  const discardAll = useCallback(async () => {
    if (!run) return false;
    try {
      await host.abandonComparison(run);
      setRun(null);
      setStates({});
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, [host, run]);

  return {
    run,
    states,
    error,
    isStarting,
    start,
    keep,
    discardAll,
    clearError: () => setError(null)
  };
}
