import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import "@xterm/xterm/css/xterm.css";
import "./TerminalView.css";

interface TerminalViewProps {
  host: ArtemisHostClient;
  terminalId: string;
}

/**
 * One xterm instance bound to one host-side PTY.
 *
 * Deliberately thin: xterm owns rendering and escape-sequence parsing, the host
 * owns the process, and this only carries bytes between them. The one piece of
 * real logic is the reconnect: subscribing returns the backlog, which is
 * written in a single call rather than replayed chunk by chunk.
 */
export function TerminalView({ host, terminalId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono") ||
        "monospace",
      fontSize: 12,
      // Read from the theme so the terminal is not the one surface that
      // ignores the design tokens.
      theme: readTheme(),
      scrollback: 5000
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);

    let disposed = false;

    const syncSize = () => {
      try {
        fit.fit();
      } catch {
        // Fitting before layout settles throws; the observer fires again.
        return;
      }
      void host.resizeTerminal(terminalId, terminal.cols, terminal.rows);
    };

    const typed = terminal.onData((data) => {
      void host.writeTerminal(terminalId, data);
    });

    void (async () => {
      const backlog = await host.subscribeTerminal(terminalId, (chunk) => {
        if (!disposed) terminal.write(chunk);
      });
      if (disposed) return;
      if (backlog) terminal.write(backlog);
      syncSize();
    })();

    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      typed.dispose();
      // Detach, do not close: the process outlives this view, which is the
      // point of the PTY living in the host.
      void host.unsubscribeTerminal(terminalId);
      terminal.dispose();
    };
  }, [host, terminalId]);

  return <div className="terminal-view" ref={containerRef} />;
}

function readTheme() {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    background: value("--surface-base", "#ffffff"),
    foreground: value("--text-primary", "#000000"),
    cursor: value("--text-primary", "#000000"),
    selectionBackground: value("--accent-muted", "#dddddd")
  };
}
