/**
 * Terminal sessions.
 *
 * The PTY lives in the host process, not the window: a webview reload drops the
 * subscriber, not the terminal. That is why `listTerminals` exists: on reload
 * the UI adopts what is already running rather than starting over.
 */
export interface TerminalSpec {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  title: string;
}

export interface TerminalSession {
  id: string;
  title: string;
  command: string;
  cwd: string;
  isRunning: boolean;
  startedAt: string;
}

/** Receives output as it arrives. */
export type TerminalOutputListener = (chunk: string) => void;

export interface TerminalRuntime {
  openTerminal(spec: TerminalSpec): Promise<TerminalSession>;
  listTerminals(): Promise<TerminalSession[]>;
  /**
   * Attach a listener; resolves with everything buffered so far.
   *
   * The backlog comes back from the call rather than through the listener so it
   * can be written to the emulator in one go: replaying a hundred kilobytes
   * chunk by chunk makes a reconnect visibly crawl.
   */
  subscribeTerminal(
    terminalId: string,
    onOutput: TerminalOutputListener
  ): Promise<string>;
  unsubscribeTerminal(terminalId: string): Promise<void>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void>;
  closeTerminal(terminalId: string): Promise<void>;
}
