export const insertionModes = ["clipboard", "keyboard", "chunked"] as const;
export const writingStyles = ["default", "chat", "professional"] as const;

export type InsertionMode = (typeof insertionModes)[number];
export type WritingStyle = (typeof writingStyles)[number];

export type AppProfile = {
  id: string;
  displayName: string;
  processName: string;
  processPath: string | null;
  insertionMode: InsertionMode;
  writingStyle: WritingStyle;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  modelDirectory: string;
  activeModelId: string;
  whisperExecutablePath: string;
  showWindowHotkey: string;
  dictationToggleHotkey: string;
  insertionMode: InsertionMode;
  offlineMode: boolean;
  autoMuteSystemAudio: boolean;
  restoreClipboard: boolean;
  remoteTypingDelayMs: number;
  remoteTypingChunkSize: number;
  appProfiles: AppProfile[];
};

export type SettingsPatch = Partial<AppSettings>;

export function isInsertionMode(value: unknown): value is InsertionMode {
  return typeof value === "string" && insertionModes.includes(value as InsertionMode);
}

export function isWritingStyle(value: unknown): value is WritingStyle {
  return typeof value === "string" && writingStyles.includes(value as WritingStyle);
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
    showWindowHotkey:
      typeof input.showWindowHotkey === "string" && input.showWindowHotkey.trim().length > 0
        ? input.showWindowHotkey
        : defaults.showWindowHotkey,
    dictationToggleHotkey:
      typeof input.dictationToggleHotkey === "string" &&
      input.dictationToggleHotkey.trim().length > 0
        ? input.dictationToggleHotkey
        : defaults.dictationToggleHotkey,
    insertionMode: isInsertionMode(input.insertionMode)
      ? input.insertionMode
      : defaults.insertionMode,
    offlineMode:
      typeof input.offlineMode === "boolean" ? input.offlineMode : defaults.offlineMode,
    autoMuteSystemAudio:
      typeof input.autoMuteSystemAudio === "boolean"
        ? input.autoMuteSystemAudio
        : defaults.autoMuteSystemAudio,
    restoreClipboard:
      typeof input.restoreClipboard === "boolean"
        ? input.restoreClipboard
        : defaults.restoreClipboard,
    remoteTypingDelayMs:
      typeof input.remoteTypingDelayMs === "number" &&
      Number.isFinite(input.remoteTypingDelayMs)
        ? clamp(Math.round(input.remoteTypingDelayMs), 0, 1000)
        : defaults.remoteTypingDelayMs,
    remoteTypingChunkSize:
      typeof input.remoteTypingChunkSize === "number" &&
      Number.isFinite(input.remoteTypingChunkSize)
        ? clamp(Math.round(input.remoteTypingChunkSize), 1, 250)
        : defaults.remoteTypingChunkSize,
    appProfiles: sanitizeAppProfiles(input.appProfiles)
  };
}

export function createAppProfile(input: {
  processName: string | null;
  processPath?: string | null;
  title?: string;
}): AppProfile {
  const processName = normalizeProcessName(input.processName);
  const now = new Date().toISOString();
  const defaults = getProfileDefaults(processName);

  return {
    id: processName,
    displayName: defaults.displayName ?? displayNameFromProcess(processName, input.title),
    processName,
    processPath: typeof input.processPath === "string" ? input.processPath : null,
    insertionMode: defaults.insertionMode,
    writingStyle: defaults.writingStyle,
    createdAt: now,
    updatedAt: now
  };
}

export function findAppProfile(
  profiles: AppProfile[],
  processName: string | null
): AppProfile | null {
  const normalized = normalizeProcessName(processName);
  return profiles.find((profile) => profile.processName === normalized) ?? null;
}

function sanitizeAppProfiles(value: unknown): AppProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const profiles: AppProfile[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const processName = normalizeProcessName(item.processName);

    if (seen.has(processName)) {
      continue;
    }

    seen.add(processName);
    profiles.push({
      id: typeof item.id === "string" && item.id.trim() ? item.id : processName,
      displayName:
        typeof item.displayName === "string" && item.displayName.trim()
          ? item.displayName.trim()
          : displayNameFromProcess(processName),
      processName,
      processPath: typeof item.processPath === "string" ? item.processPath : null,
      insertionMode: isInsertionMode(item.insertionMode) ? item.insertionMode : "clipboard",
      writingStyle: isWritingStyle(item.writingStyle) ? item.writingStyle : "default",
      createdAt:
        typeof item.createdAt === "string" && item.createdAt.trim()
          ? item.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof item.updatedAt === "string" && item.updatedAt.trim()
          ? item.updatedAt
          : new Date().toISOString()
    });
  }

  return profiles.sort((first, second) => first.displayName.localeCompare(second.displayName));
}

function getProfileDefaults(processName: string): {
  displayName?: string;
  insertionMode: InsertionMode;
  writingStyle: WritingStyle;
} {
  if (["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"].includes(processName)) {
    return {
      displayName: browserDisplayName(processName),
      insertionMode: "clipboard",
      writingStyle: "chat"
    };
  }

  if (["mstsc.exe", "teamviewer.exe", "anydesk.exe"].includes(processName)) {
    return {
      displayName: remoteDisplayName(processName),
      insertionMode: "chunked",
      writingStyle: "default"
    };
  }

  if (
    ["windowsterminal.exe", "wt.exe", "cmd.exe", "powershell.exe", "pwsh.exe"].includes(
      processName
    )
  ) {
    return {
      displayName: terminalDisplayName(processName),
      insertionMode: "keyboard",
      writingStyle: "default"
    };
  }

  if (["outlook.exe", "olk.exe"].includes(processName)) {
    return {
      displayName: "Outlook",
      insertionMode: "clipboard",
      writingStyle: "professional"
    };
  }

  return {
    insertionMode: "clipboard",
    writingStyle: "default"
  };
}

function browserDisplayName(processName: string): string {
  const names: Record<string, string> = {
    "chrome.exe": "Chrome",
    "msedge.exe": "Microsoft Edge",
    "firefox.exe": "Firefox",
    "brave.exe": "Brave"
  };

  return names[processName] ?? displayNameFromProcess(processName);
}

function remoteDisplayName(processName: string): string {
  const names: Record<string, string> = {
    "mstsc.exe": "Remote Desktop",
    "teamviewer.exe": "TeamViewer",
    "anydesk.exe": "AnyDesk"
  };

  return names[processName] ?? displayNameFromProcess(processName);
}

function terminalDisplayName(processName: string): string {
  const names: Record<string, string> = {
    "windowsterminal.exe": "Windows Terminal",
    "wt.exe": "Windows Terminal",
    "cmd.exe": "Command Prompt",
    "powershell.exe": "PowerShell",
    "pwsh.exe": "PowerShell"
  };

  return names[processName] ?? displayNameFromProcess(processName);
}

function displayNameFromProcess(processName: string, title?: string): string {
  if (processName === "unknown.exe" && title?.trim()) {
    return title.trim();
  }

  return processName.replace(/\.exe$/i, "");
}

function normalizeProcessName(processName: unknown): string {
  return typeof processName === "string" && processName.trim()
    ? processName.trim().toLowerCase()
    : "unknown.exe";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
