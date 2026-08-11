/**
 * How much of a turn the transcript renders.
 *
 * `full` shows every tool call; `output` shows the answer and folds the
 * mechanics behind the turn header. Which is right depends on whether you are
 * debugging the agent or reading its conclusion, so it is a setting rather than
 * a default — and it doubles as a lever over how much of a long tool run stays
 * in view.
 */
export type TranscriptVerbosity = "full" | "output";

export interface RuntimeSettings {
  opencodeDefaultModel?: string;
  opencodeExecutablePath?: string;
  /**
   * Root directory scanned for projects and workspace config mentions.
   * Explicit because the previous implicit root — whatever sat above the app
   * directory — made the inventory scan unbounded and slow to first paint.
   */
  scanRoot?: string;
  /**
   * Chosen app-icon variant. Applies to the running app's dock icon; the
   * bundled icon is fixed at build time.
   */
  appIconId?: string;
  /**
   * Absent means `full`. A settings file written before this shipped must not
   * silently start hiding the user's tool output.
   */
  transcriptVerbosity?: TranscriptVerbosity;
  /**
   * Let Artemis shell out to Quiver's `swe` CLI for MCP reconciliation.
   *
   * Off unless chosen. Reading Quiver's JSON files costs nothing and is always
   * on; running its Python is a different bargain, and one the user should make
   * deliberately.
   */
  quiverCliEnabled?: boolean;
}

/** An app-icon variant offered in Settings → Appearance. */
export interface AppIcon {
  id: string;
  label: string;
}

export interface RuntimeSettingsRuntime {
  getRuntimeSettings(): Promise<RuntimeSettings>;
  updateRuntimeSettings(settings: RuntimeSettings): Promise<RuntimeSettings>;
  listAppIcons(): Promise<AppIcon[]>;
  /** Applies to the running app and remembers the choice. */
  setAppIcon(iconId: string): Promise<void>;
}
