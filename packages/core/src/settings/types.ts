export interface RuntimeSettings {
  opencodeDefaultModel?: string;
  opencodeExecutablePath?: string;
}

export interface RuntimeSettingsRuntime {
  getRuntimeSettings(): Promise<RuntimeSettings>;
  updateRuntimeSettings(settings: RuntimeSettings): Promise<RuntimeSettings>;
}
