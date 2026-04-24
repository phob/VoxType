export const insertionModes = ["clipboard", "keyboard", "chunked"] as const;

export type InsertionMode = (typeof insertionModes)[number];

export type AppSettings = {
  modelDirectory: string;
  activeModelId: string;
  whisperExecutablePath: string;
  insertionMode: InsertionMode;
  offlineMode: boolean;
  restoreClipboard: boolean;
  remoteTypingDelayMs: number;
};

export type SettingsPatch = Partial<AppSettings>;

export function isInsertionMode(value: unknown): value is InsertionMode {
  return typeof value === "string" && insertionModes.includes(value as InsertionMode);
}

export function sanitizeSettings(
  value: unknown,
  defaults: AppSettings
): AppSettings {
  const input = isRecord(value) ? value : {};

  return {
    modelDirectory:
      typeof input.modelDirectory === "string" && input.modelDirectory.trim().length > 0
        ? input.modelDirectory
        : defaults.modelDirectory,
    activeModelId:
      typeof input.activeModelId === "string" && input.activeModelId.trim().length > 0
        ? input.activeModelId
        : defaults.activeModelId,
    whisperExecutablePath:
      typeof input.whisperExecutablePath === "string"
        ? input.whisperExecutablePath
        : defaults.whisperExecutablePath,
    insertionMode: isInsertionMode(input.insertionMode)
      ? input.insertionMode
      : defaults.insertionMode,
    offlineMode:
      typeof input.offlineMode === "boolean" ? input.offlineMode : defaults.offlineMode,
    restoreClipboard:
      typeof input.restoreClipboard === "boolean"
        ? input.restoreClipboard
        : defaults.restoreClipboard,
    remoteTypingDelayMs:
      typeof input.remoteTypingDelayMs === "number" &&
      Number.isFinite(input.remoteTypingDelayMs)
        ? clamp(Math.round(input.remoteTypingDelayMs), 0, 1000)
        : defaults.remoteTypingDelayMs
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
