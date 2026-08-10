export interface RuntimeSettings {
  opencodeDefaultModel?: string;
  opencodeExecutablePath?: string;
  /**
   * Root directory scanned for projects and workspace config mentions.
   * Explicit because the previous implicit root — whatever sat above the app
   * directory — made the inventory scan unbounded and slow to first paint.
   */
  scanRoot?: string;
}

export interface RuntimeSettingsRuntime {
  getRuntimeSettings(): Promise<RuntimeSettings>;
  updateRuntimeSettings(settings: RuntimeSettings): Promise<RuntimeSettings>;
}
