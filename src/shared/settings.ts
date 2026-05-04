export const insertionModes = [
  "clipboard",
  "remoteClipboard",
  "keyboard",
  "chunked",
  "windowsMessaging"
] as const;
export const writingStyles = ["default", "chat", "professional"] as const;
export const recordingCoordinationModes = ["none", "muteCaptureSession", "sendHotkey"] as const;
export const recorderCaptureModes = [
  "sharedCapture",
  "exclusiveCapturePreferred",
  "exclusiveCaptureRequired"
] as const;
export const ocrTermModes = ["strict", "balanced", "broad"] as const;
export const whisperRuntimePreferences = ["auto", "cpu", "cuda", "vulkan"] as const;
export const whisperLanguages = [
  "auto",
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "pl",
  "ru",
  "ja",
  "ko",
  "zh"
] as const;
export const profileWhisperLanguages = ["inherit", ...whisperLanguages] as const;

export type InsertionMode = (typeof insertionModes)[number];
export type WritingStyle = (typeof writingStyles)[number];
export type RecordingCoordinationMode = (typeof recordingCoordinationModes)[number];
export type RecorderCaptureMode = (typeof recorderCaptureModes)[number];
export type OcrTermMode = (typeof ocrTermModes)[number];
export type WhisperRuntimePreference = (typeof whisperRuntimePreferences)[number];
export type WhisperLanguage = (typeof whisperLanguages)[number];
export type ProfileWhisperLanguage = (typeof profileWhisperLanguages)[number];

export type AppProfile = {
  id: string;
  displayName: string;
  processName: string;
  processPath: string | null;
  insertionMode: InsertionMode;
  writingStyle: WritingStyle;
  recordingCoordinationMode: RecordingCoordinationMode;
  recordingStartHotkey: string;
  recordingStopHotkey: string;
  postTranscriptionHotkey: string;
  whisperLanguage: ProfileWhisperLanguage;
  neverSuspendDictationInFullscreen: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  modelDirectory: string;
  activeModelId: string;
  whisperExecutablePath: string;
  whisperRuntimeBackend: WhisperRuntimePreference;
  whisperLanguage: WhisperLanguage;
  whisperPromptOverride: string;
  showWindowHotkey: string;
  dictationToggleHotkey: string;
  dictationHoldHotkey: string;
  insertionMode: InsertionMode;
  recordingInputDeviceId: string;
  recorderCaptureMode: RecorderCaptureMode;
  ocrTermMode: OcrTermMode;
  recordingCoordinationMode: RecordingCoordinationMode;
  recordingStartHotkey: string;
  recordingStopHotkey: string;
  offlineMode: boolean;
  startMinimized: boolean;
  startWithWindows: boolean;
  developerModeEnabled: boolean;
  suspendDictationHotkeysInFullscreenApps: boolean;
  autoMuteSystemAudio: boolean;
  restoreClipboard: boolean;
  vadEnabled: boolean;
  vadPositiveSpeechThreshold: number;
  vadNegativeSpeechThreshold: number;
  vadMinSpeechMs: number;
  vadPreSpeechPadMs: number;
  vadRedemptionMs: number;
  vadPreservedPauseMs: number;
  remoteClipboardPasteDelayMs: number;
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

export function isRecordingCoordinationMode(
  value: unknown
): value is RecordingCoordinationMode {
  return (
    typeof value === "string" &&
    recordingCoordinationModes.includes(value as RecordingCoordinationMode)
  );
}

export function isRecorderCaptureMode(value: unknown): value is RecorderCaptureMode {
  return typeof value === "string" && recorderCaptureModes.includes(value as RecorderCaptureMode);
}

export function isOcrTermMode(value: unknown): value is OcrTermMode {
  return typeof value === "string" && ocrTermModes.includes(value as OcrTermMode);
}

export function isWhisperRuntimePreference(value: unknown): value is WhisperRuntimePreference {
  return (
    typeof value === "string" &&
    whisperRuntimePreferences.includes(value as WhisperRuntimePreference)
  );
}

export function isWhisperLanguage(value: unknown): value is WhisperLanguage {
  return typeof value === "string" && whisperLanguages.includes(value as WhisperLanguage);
}

export function isProfileWhisperLanguage(value: unknown): value is ProfileWhisperLanguage {
  return (
    typeof value === "string" &&
    profileWhisperLanguages.includes(value as ProfileWhisperLanguage)
  );
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
    whisperRuntimeBackend: isWhisperRuntimePreference(input.whisperRuntimeBackend)
      ? input.whisperRuntimeBackend
      : defaults.whisperRuntimeBackend,
    whisperLanguage: isWhisperLanguage(input.whisperLanguage)
      ? input.whisperLanguage
      : defaults.whisperLanguage,
    whisperPromptOverride:
      typeof input.whisperPromptOverride === "string"
        ? input.whisperPromptOverride.slice(0, 2000)
        : defaults.whisperPromptOverride,
    showWindowHotkey:
      typeof input.showWindowHotkey === "string"
        ? input.showWindowHotkey
        : defaults.showWindowHotkey,
    dictationToggleHotkey:
      typeof input.dictationToggleHotkey === "string"
        ? input.dictationToggleHotkey
        : defaults.dictationToggleHotkey,
    dictationHoldHotkey:
      typeof input.dictationHoldHotkey === "string"
        ? input.dictationHoldHotkey
        : defaults.dictationHoldHotkey,
    insertionMode: isInsertionMode(input.insertionMode)
      ? input.insertionMode
      : defaults.insertionMode,
    recordingInputDeviceId:
      typeof input.recordingInputDeviceId === "string" && input.recordingInputDeviceId.trim()
        ? input.recordingInputDeviceId.slice(0, 240)
        : defaults.recordingInputDeviceId,
    recorderCaptureMode: isRecorderCaptureMode(input.recorderCaptureMode)
      ? input.recorderCaptureMode
      : defaults.recorderCaptureMode,
    ocrTermMode: isOcrTermMode(input.ocrTermMode)
      ? input.ocrTermMode
      : defaults.ocrTermMode,
    recordingCoordinationMode: isRecordingCoordinationMode(input.recordingCoordinationMode)
      ? input.recordingCoordinationMode
      : defaults.recordingCoordinationMode,
    recordingStartHotkey:
      typeof input.recordingStartHotkey === "string"
        ? input.recordingStartHotkey
        : defaults.recordingStartHotkey,
    recordingStopHotkey:
      typeof input.recordingStopHotkey === "string"
        ? input.recordingStopHotkey
        : defaults.recordingStopHotkey,
    offlineMode:
      typeof input.offlineMode === "boolean" ? input.offlineMode : defaults.offlineMode,
    startMinimized:
      typeof input.startMinimized === "boolean"
        ? input.startMinimized
        : defaults.startMinimized,
    startWithWindows:
      typeof input.startWithWindows === "boolean"
        ? input.startWithWindows
        : defaults.startWithWindows,
    developerModeEnabled:
      typeof input.developerModeEnabled === "boolean"
        ? input.developerModeEnabled
        : defaults.developerModeEnabled,
    suspendDictationHotkeysInFullscreenApps:
      typeof input.suspendDictationHotkeysInFullscreenApps === "boolean"
        ? input.suspendDictationHotkeysInFullscreenApps
        : defaults.suspendDictationHotkeysInFullscreenApps,
    autoMuteSystemAudio:
      typeof input.autoMuteSystemAudio === "boolean"
        ? input.autoMuteSystemAudio
        : defaults.autoMuteSystemAudio,
    restoreClipboard:
      typeof input.restoreClipboard === "boolean"
        ? input.restoreClipboard
        : defaults.restoreClipboard,
    vadEnabled:
      typeof input.vadEnabled === "boolean" ? input.vadEnabled : defaults.vadEnabled,
    vadPositiveSpeechThreshold:
      typeof input.vadPositiveSpeechThreshold === "number" &&
      Number.isFinite(input.vadPositiveSpeechThreshold)
        ? clamp(input.vadPositiveSpeechThreshold, 0.05, 0.95)
        : defaults.vadPositiveSpeechThreshold,
    vadNegativeSpeechThreshold:
      typeof input.vadNegativeSpeechThreshold === "number" &&
      Number.isFinite(input.vadNegativeSpeechThreshold)
        ? clamp(input.vadNegativeSpeechThreshold, 0.01, 0.9)
        : defaults.vadNegativeSpeechThreshold,
    vadMinSpeechMs:
      typeof input.vadMinSpeechMs === "number" && Number.isFinite(input.vadMinSpeechMs)
        ? clamp(Math.round(input.vadMinSpeechMs), 50, 5000)
        : defaults.vadMinSpeechMs,
    vadPreSpeechPadMs:
      typeof input.vadPreSpeechPadMs === "number" &&
      Number.isFinite(input.vadPreSpeechPadMs)
        ? clamp(Math.round(input.vadPreSpeechPadMs), 0, 1000)
        : defaults.vadPreSpeechPadMs,
    vadRedemptionMs:
      typeof input.vadRedemptionMs === "number" && Number.isFinite(input.vadRedemptionMs)
        ? clamp(Math.round(input.vadRedemptionMs), 50, 5000)
        : defaults.vadRedemptionMs,
    vadPreservedPauseMs:
      typeof input.vadPreservedPauseMs === "number" &&
      Number.isFinite(input.vadPreservedPauseMs)
        ? clamp(Math.round(input.vadPreservedPauseMs), 0, 2000)
        : defaults.vadPreservedPauseMs,
    remoteClipboardPasteDelayMs:
      typeof input.remoteClipboardPasteDelayMs === "number" &&
      Number.isFinite(input.remoteClipboardPasteDelayMs)
        ? clamp(Math.round(input.remoteClipboardPasteDelayMs), 0, 5000)
        : defaults.remoteClipboardPasteDelayMs,
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
    recordingCoordinationMode: defaults.recordingCoordinationMode,
    recordingStartHotkey: defaults.recordingStartHotkey ?? "",
    recordingStopHotkey: defaults.recordingStopHotkey ?? "",
    postTranscriptionHotkey: "",
    whisperLanguage: defaults.whisperLanguage,
    neverSuspendDictationInFullscreen: false,
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
      insertionMode: sanitizeProfileInsertionMode(processName, item.insertionMode),
      writingStyle: isWritingStyle(item.writingStyle) ? item.writingStyle : "default",
      recordingCoordinationMode: isRecordingCoordinationMode(item.recordingCoordinationMode)
        ? item.recordingCoordinationMode
        : "none",
      recordingStartHotkey:
        typeof item.recordingStartHotkey === "string" ? item.recordingStartHotkey : "",
      recordingStopHotkey:
        typeof item.recordingStopHotkey === "string" ? item.recordingStopHotkey : "",
      postTranscriptionHotkey:
        typeof item.postTranscriptionHotkey === "string" ? item.postTranscriptionHotkey : "",
      whisperLanguage: isProfileWhisperLanguage(item.whisperLanguage)
        ? item.whisperLanguage
        : "inherit",
      neverSuspendDictationInFullscreen:
        typeof item.neverSuspendDictationInFullscreen === "boolean"
          ? item.neverSuspendDictationInFullscreen
          : false,
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
  recordingCoordinationMode: RecordingCoordinationMode;
  recordingStartHotkey?: string;
  recordingStopHotkey?: string;
  whisperLanguage: ProfileWhisperLanguage;
} {
  if (["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"].includes(processName)) {
    return {
      displayName: browserDisplayName(processName),
      insertionMode: "clipboard",
      writingStyle: "chat",
      recordingCoordinationMode: "none",
      whisperLanguage: "inherit"
    };
  }

  if (["mstsc.exe", "teamviewer.exe", "anydesk.exe"].includes(processName)) {
    return {
      displayName: remoteDisplayName(processName),
      insertionMode: "chunked",
      writingStyle: "default",
      recordingCoordinationMode: "none",
      whisperLanguage: "inherit"
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
      writingStyle: "default",
      recordingCoordinationMode: "none",
      whisperLanguage: "inherit"
    };
  }

  if (["outlook.exe", "olk.exe"].includes(processName)) {
    return {
      displayName: "Outlook",
      insertionMode: "clipboard",
      writingStyle: "professional",
      recordingCoordinationMode: "none",
      whisperLanguage: "inherit"
    };
  }

  if (["discord.exe", "discordptb.exe", "discordcanary.exe"].includes(processName)) {
    return {
      displayName: discordDisplayName(processName),
      insertionMode: "clipboard",
      writingStyle: "chat",
      recordingCoordinationMode: "none",
      whisperLanguage: "inherit"
    };
  }

  return {
    insertionMode: "clipboard",
    writingStyle: "default",
    recordingCoordinationMode: "none",
    whisperLanguage: "inherit"
  };
}

function discordDisplayName(processName: string): string {
  const names: Record<string, string> = {
    "discord.exe": "Discord",
    "discordptb.exe": "Discord PTB",
    "discordcanary.exe": "Discord Canary"
  };

  return names[processName] ?? displayNameFromProcess(processName);
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

function sanitizeProfileInsertionMode(
  processName: string,
  insertionMode: unknown
): InsertionMode {
  if (!isInsertionMode(insertionMode)) {
    return "clipboard";
  }

  if (
    insertionMode === "windowsMessaging" &&
    ["mstsc.exe", "teamviewer.exe", "anydesk.exe"].includes(processName)
  ) {
    return "chunked";
  }

  return insertionMode;
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
