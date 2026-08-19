import type { TerminalSession } from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import { TerminalView } from "./TerminalView";
import "./TerminalDock.css";

interface TerminalDockProps {
  host: ArtemisHostClient;
  terminals: TerminalSession[];
  activeId: string | null;
  onSelect(terminalId: string): void;
  onClose(terminalId: string): void;
  onHide(): void;
  onNew(): void;
}

/**
 * Tabbed terminals beside the conversation: Superset's arrangement, and the
 * reason it works is that the terminal is a dock rather than the main surface.
 * It is where harnesses without a streaming adapter run, and where you go when
 * you want to type a command yourself.
 *
 * Only the visible tab is mounted. Keeping a dozen xterm instances rendering
 * off-screen costs real frame time, and the PTY keeps running regardless.
 */
export function TerminalDock({
  host,
  terminals,
  activeId,
  onSelect,
  onClose,
  onHide,
  onNew
}: TerminalDockProps) {
  const active = terminals.find((terminal) => terminal.id === activeId) ?? terminals[0];

  return (
    <aside aria-label="Terminal" className="terminal-dock">
      <div className="terminal-dock-bar">
        <div aria-label="Terminals" className="terminal-dock-tabs" role="tablist">
          {terminals.map((terminal) => (
            <button
              aria-selected={terminal.id === active?.id}
              className="terminal-tab"
              data-running={terminal.isRunning}
              key={terminal.id}
              onClick={() => onSelect(terminal.id)}
              role="tab"
              type="button"
            >
              <span className="terminal-tab-name">{terminal.title}</span>
              {terminal.isRunning ? null : (
                <span className="terminal-tab-exited">exited</span>
              )}
            </button>
          ))}
        </div>

        <div className="terminal-dock-actions">
          <button
            aria-label="New terminal"
            className="terminal-dock-action"
            onClick={onNew}
            title="New terminal"
            type="button"
          >
            +
          </button>
          {active ? (
            <button
              aria-label={`Close terminal ${active.title}`}
              className="terminal-dock-action"
              onClick={() => onClose(active.id)}
              title="Close terminal"
              type="button"
            >
              ×
            </button>
          ) : null}
          <button
            aria-label="Collapse dock"
            className="terminal-dock-action"
            onClick={onHide}
            title="Collapse dock"
            type="button"
          >
            ⌄
          </button>
        </div>
      </div>

      <div className="terminal-dock-body">
        {active ? (
          // Keyed by id so switching tabs tears down one view and builds the
          // other rather than reusing an instance bound to the wrong PTY.
          <TerminalView host={host} key={active.id} terminalId={active.id} />
        ) : null}
      </div>
    </aside>
  );
}
