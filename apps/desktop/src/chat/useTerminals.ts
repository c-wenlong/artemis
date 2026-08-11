import { useCallback, useEffect, useState } from "react";
import type { HarnessAsset, TerminalSession, WorkspaceSummary } from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";

interface UseTerminalsOptions {
  host: ArtemisHostClient;
  workspace: WorkspaceSummary | null;
  harness: HarnessAsset | null;
}

export interface TerminalsController {
  terminals: TerminalSession[];
  activeId: string | null;
  isVisible: boolean;
  error: string | null;
  /** Show the dock, opening a terminal if there is nothing to show. */
  open(): Promise<void>;
  /** Always starts another terminal, whatever the dock is showing. */
  openNew(): Promise<void>;
  hide(): void;
  select(terminalId: string): void;
  close(terminalId: string): Promise<void>;
}

/** Falls back to a login shell when no harness is selected. */
function commandFor(harness: HarnessAsset | null): { command: string; title: string } {
  if (harness?.executablePath) {
    return { command: harness.executablePath, title: harness.label };
  }
  // Empty means "the platform's shell", which the host resolves because it is
  // the half that knows the operating system. This used to be `/bin/zsh`, which
  // does not exist on Windows — the dock could not open a shell there at all.
  return { command: "", title: "shell" };
}

/**
 * Terminals belong to the host, so this adopts whatever is already running
 * rather than assuming the list starts empty. After a window reload that is the
 * difference between finding your agent still working and starting it again.
 */
export function useTerminals({
  host,
  workspace,
  harness
}: UseTerminalsOptions): TerminalsController {
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isVisible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const existing = await host.listTerminals();
        if (!active || existing.length === 0) return;
        setTerminals(existing);
        setActiveId((current) => current ?? existing[existing.length - 1]!.id);
      } catch {
        // No terminals is a normal answer, including in browser mode.
      }
    })();
    return () => {
      active = false;
    };
  }, [host]);

  const openNew = useCallback(async () => {
    setError(null);
    const { command, title } = commandFor(harness);
    try {
      const session = await host.openTerminal({
        args: [],
        cols: 80,
        command,
        cwd: workspace?.worktreePath ?? ".",
        rows: 24,
        title
      });
      setTerminals((current) => [...current, session]);
      setActiveId(session.id);
      setVisible(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [harness, host, workspace]);

  // The dock toggle. Showing a hidden dock that already has terminals is not a
  // request for another one.
  const open = useCallback(async () => {
    if (terminals.length > 0) {
      setVisible(true);
      return;
    }
    await openNew();
  }, [openNew, terminals.length]);

  const close = useCallback(
    async (terminalId: string) => {
      await host.closeTerminal(terminalId);
      setTerminals((current) => {
        const remaining = current.filter((terminal) => terminal.id !== terminalId);
        setActiveId((active) =>
          active === terminalId ? (remaining.at(-1)?.id ?? null) : active
        );
        // The dock with no tabs is an empty panel taking up half the window.
        if (remaining.length === 0) setVisible(false);
        return remaining;
      });
    },
    [host]
  );

  return {
    terminals,
    activeId,
    isVisible,
    error,
    open,
    openNew,
    hide: () => setVisible(false),
    select: setActiveId,
    close
  };
}
