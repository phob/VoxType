import { dictationModes } from "../../../shared/asr";
import {
  type AppProfile,
  type InsertionMode,
  type ProfileWhisperLanguage,
  type RealtimeLatencyPreset,
  type WhisperLanguage
} from "../../../shared/settings";

export type ReleaseTab =
  | "general"
  | "hotkeys"
  | "models"
  | "profiles"
  | "dictionary"
  | "history"
  | "cloud"
  | "settings";

export type ReleaseModelFilter = "all" | "installed" | "available";

export type DevTab =
  | "dictation"
  | "models"
  | "insertion"
  | "profiles"
  | "dictionary"
  | "ocr"
  | "settings"
  | "logs";

export interface SelectOption<T> {
  label: string;
  meta?: string;
  value: T;
}

export const insertionModeOptions: SelectOption<InsertionMode>[] = [
  { label: "Clipboard paste", value: "clipboard" },
  { label: "Direct typing", value: "keyboard" },
  { label: "Remote-safe typing", value: "chunked" },
  { label: "Remote clipboard", value: "remoteClipboard" }
];

export const writingStyleOptions: SelectOption<AppProfile["writingStyle"]>[] = [
  { label: "Default", value: "default" },
  { label: "Chat", value: "chat" },
  { label: "Professional", value: "professional" }
];

export const whisperLanguageOptions: SelectOption<WhisperLanguage>[] = [
  { label: "Auto", value: "auto" },
  { label: "English", meta: "EN", value: "en" },
  { label: "German", meta: "DE", value: "de" },
  { label: "French", meta: "FR", value: "fr" },
  { label: "Spanish", meta: "ES", value: "es" },
  { label: "Italian", meta: "IT", value: "it" },
  { label: "Portuguese", meta: "PT", value: "pt" },
  { label: "Dutch", meta: "NL", value: "nl" },
  { label: "Polish", meta: "PL", value: "pl" },
  { label: "Russian", meta: "RU", value: "ru" },
  { label: "Japanese", meta: "JA", value: "ja" },
  { label: "Korean", meta: "KO", value: "ko" },
  { label: "Chinese", meta: "ZH", value: "zh" }
];

export const profileWhisperLanguageOptions: SelectOption<ProfileWhisperLanguage>[] = [
  { label: "Inherit", value: "inherit" },
  ...whisperLanguageOptions
];

export const realtimeLatencyPresetOptions: SelectOption<RealtimeLatencyPreset>[] = [
  { label: "Fast", meta: "lower preview latency", value: "fast" },
  { label: "Balanced", meta: "recommended", value: "balanced" },
  { label: "Accurate", meta: "longer turn timing", value: "accurate" }
];

export const profileDictationModeOptions: SelectOption<AppProfile["dictationModeId"]>[] = [
  { label: "Inherit", value: "inherit" },
  ...dictationModes.map((mode) => ({
    label: mode.label,
    meta: mode.secondaryText,
    value: mode.id
  }))
];

export const profileCloudPromptPackOcrOptions: SelectOption<AppProfile["cloudPromptPackOcrEnabled"]>[] = [
  { label: "Inherit", meta: "use global Cloud Prompt Pack OCR setting", value: "inherit" },
  { label: "Allow", meta: "include selected OCR terms in cloud Prompt Pack", value: true },
  { label: "Block", meta: "never include OCR terms for this profile", value: false }
];

export const devTabs: { id: DevTab; label: string }[] = [
  { id: "dictation", label: "Dictation" },
  { id: "models", label: "Models" },
  { id: "insertion", label: "Insertion" },
  { id: "profiles", label: "Profiles" },
  { id: "dictionary", label: "Dictionary" },
  { id: "ocr", label: "OCR" },
  { id: "settings", label: "Settings" },
  { id: "logs", label: "Logs" }
];
