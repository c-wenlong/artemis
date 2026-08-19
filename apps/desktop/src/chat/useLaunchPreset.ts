import { useCallback, useEffect, useRef, useState } from "react";
import type { HarnessAsset, WorkspaceSummary } from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";

interface UseLaunchPresetOptions {
  host: ArtemisHostClient;
  workspace: WorkspaceSummary | null;
  readyHarnesses: HarnessAsset[];
  defaultModel: string;
}

export interface LaunchPresetController {
  harnessId: string | null;
  model: string;
  setHarnessId(harnessId: string): void;
  setModel(model: string): void;
}

/** opencode when it is available, since it is the one that streams. */
function preferredHarness(ready: HarnessAsset[]): string | null {
  return ready.find((harness) => harness.id === "opencode")?.id ?? ready[0]?.id ?? null;
}

/**
 * The harness and model for the selected workspace, remembered across restarts.
 *
 * Two rules keep this honest, and both were learned by getting them wrong:
 *
 * 1. **Choosing is a user action; loading is not.** Only the exported setters
 *    write a preset. The loader calls the internal setters, so merely opening a
 *    workspace can never overwrite what was stored. An earlier version gated
 *    saving on the load having *finished*, which silently discarded a model
 *    typed in the first moments after opening.
 *
 * 2. **A reload happens when the workspace changes, and only then.** The effect
 *    deliberately does not depend on `defaultModel` or on the harness array's
 *    identity. When it did, settings arriving a tick later re-ran the load,
 *    which reset the "user has chosen" flag and overwrote what had just been
 *    typed.
 */
export function useLaunchPreset({
  host,
  workspace,
  readyHarnesses,
  defaultModel
}: UseLaunchPresetOptions): LaunchPresetController {
  const [harnessId, setHarnessIdState] = useState<string | null>(null);
  const [model, setModelState] = useState("");
  const touched = useRef(false);

  // Read inside the effect without making it a dependency; see rule 2.
  const latest = useRef({ readyHarnesses, defaultModel });
  latest.current = { readyHarnesses, defaultModel };

  const workspaceId = workspace?.id ?? null;
  const harnessesReady = readyHarnesses.length > 0;

  useEffect(() => {
    if (!workspaceId || !harnessesReady) return;
    let active = true;
    touched.current = false;

    // Resolve the default immediately, before asking the host for a stored
    // preset. Waiting for that round-trip left the UI briefly claiming "No
    // harness is ready", not slow, but wrong: one is ready, the choice between
    // them simply is not settled yet.
    setHarnessIdState(
      (current) => current ?? preferredHarness(latest.current.readyHarnesses)
    );

    void (async () => {
      let preset: { harnessId: string; model: string | null } | null = null;
      try {
        preset = await host.getLaunchPreset(workspaceId);
      } catch {
        // No stored preset is the normal case, including in browser mode.
      }
      // Someone who started typing while this was in flight has said more about
      // what they want than the stored preset has.
      if (!active || touched.current) return;

      const { readyHarnesses: ready, defaultModel: fallbackModel } = latest.current;
      // A preset naming a harness that is no longer installed is stale, not a
      // reason to select something unusable.
      const stored = preset?.harnessId;
      const usable = stored && ready.some((harness) => harness.id === stored);

      setHarnessIdState(usable ? stored! : preferredHarness(ready));
      setModelState(preset?.model ?? fallbackModel);
    })();

    return () => {
      active = false;
    };
  }, [harnessesReady, host, workspaceId]);

  const persist = useCallback(
    (nextHarnessId: string | null, nextModel: string) => {
      if (!workspaceId || !nextHarnessId) return;
      void host
        .saveLaunchPreset(workspaceId, nextHarnessId, nextModel.trim() || null)
        .catch(() => {
          // A preset that fails to save is not worth interrupting anyone over.
        });
    },
    [host, workspaceId]
  );

  const setHarnessId = useCallback(
    (next: string) => {
      touched.current = true;
      setHarnessIdState(next);
      persist(next, model);
    },
    [model, persist]
  );

  const setModel = useCallback(
    (next: string) => {
      touched.current = true;
      setModelState(next);
      // A preset row needs a harness. Typing a model before one has resolved
      // is still a choice worth keeping, so fall back to the default rather
      // than dropping the save.
      persist(harnessId ?? preferredHarness(latest.current.readyHarnesses), next);
    },
    [harnessId, persist]
  );

  return { harnessId, model, setHarnessId, setModel };
}
