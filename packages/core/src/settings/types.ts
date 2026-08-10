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
