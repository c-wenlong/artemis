import { createHttpHostClient } from "@artemis/host-service/client";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import { createTauriHostClient } from "./tauriHostClient";

/**
 * True when the page is running inside the Tauri webview rather than a browser.
 * Tauri v2 injects `__TAURI_INTERNALS__` before any app code runs.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Resolve the host for the current runtime.
 *
 * Tauri is the product; the HTTP client exists so `pnpm dev:web` can still run
 * the UI against the TypeScript reference host in a plain browser. That path is
 * a development convenience, not a shipping surface: see M0 in MILESTONES.md.
 */
export function createHostClient(): ArtemisHostClient {
  return isTauri() ? createTauriHostClient() : createHttpHostClient();
}

export { isTauri };
