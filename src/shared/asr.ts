import {
  OPENAI_MINI_TRANSCRIBE_MODEL_ID,
  OPENAI_REALTIME_WHISPER_MODEL_ID,
  OPENAI_TRANSCRIBE_MODEL_ID
} from "./openai-models";
import { type PromptPackCharacterLimit, type PromptPackTermLimit } from "./prompt-pack-limits";
import { type RealtimeLatencyPreset, type WhisperLanguage } from "./settings";

export type AsrProviderId = "local-whisper" | "openai";
export type DictationModeId =
  | "local.fast"
  | "local.balanced"
  | "local.accuracy"
  | "local.custom"
  | "openai.realtime"
  | "openai.accuracy"
  | "openai.economy";

export type DictationModeKind = "file" | "streaming";

export type DictationMode = {
  id: DictationModeId;
  providerId: AsrProviderId;
  kind: DictationModeKind;
  label: string;
  modelId: string;
  secondaryText: string;
  requiresCloudConsent: boolean;
};

export type TranscriptTurnStatus = "provisional" | "final" | "fallback";

export type TranscriptTurn = {
  providerItemId: string;
  provisionalText?: string;
  finalText?: string;
  status: TranscriptTurnStatus;
  firstSeenSequence: number;
};

export type AsrResult = {
  providerId: AsrProviderId;
  modelId: string;
  modeId: DictationModeId;
  providerText: string;
  turns?: TranscriptTurn[];
  durationMs: number;
};

export type PromptPack = {
  terms: string[];
  text: string;
  source: "dictionary" | "dictionary+ocr";
  truncated: boolean;
  termLimit: PromptPackTermLimit;
  characterLimit: PromptPackCharacterLimit;
};

export type FileAsrRequest = {
  audioBytes: Uint8Array;
  mode: DictationMode;
  promptPack: PromptPack | null;
  language: WhisperLanguage;
};

export type StreamingAudioConfig = {
  sampleRateHz: 24000;
  encoding: "pcm16";
  channelCount: 1;
};

export type StreamingAsrRequest = {
  mode: DictationMode;
  language: WhisperLanguage;
  audioConfig: StreamingAudioConfig;
  latencyPreset: RealtimeLatencyPreset;
};

export const openAiRealtimeAudioConfig: StreamingAudioConfig = {
  sampleRateHz: 24000,
  encoding: "pcm16",
  channelCount: 1
};

export interface FileAsrProvider {
  readonly providerId: AsrProviderId;
  transcribeFile(request: FileAsrRequest): Promise<AsrResult>;
}

export interface StreamingAsrProvider {
  readonly providerId: AsrProviderId;
  startStreaming(request: StreamingAsrRequest): Promise<void>;
}

export const dictationModes: DictationMode[] = [
  {
    id: "local.fast",
    providerId: "local-whisper",
    kind: "file",
    label: "Local fast",
    modelId: "base",
    secondaryText: "Whisper base",
    requiresCloudConsent: false
  },
  {
    id: "local.balanced",
    providerId: "local-whisper",
    kind: "file",
    label: "Local balanced",
    modelId: "small",
    secondaryText: "Whisper small",
    requiresCloudConsent: false
  },
  {
    id: "local.accuracy",
    providerId: "local-whisper",
    kind: "file",
    label: "Local accuracy",
    modelId: "large-v3-turbo",
    secondaryText: "Whisper large-v3-turbo",
    requiresCloudConsent: false
  },
  {
    id: "local.custom",
    providerId: "local-whisper",
    kind: "file",
    label: "Local custom",
    modelId: "custom",
    secondaryText: "Exact local Whisper model",
    requiresCloudConsent: false
  },
  {
    id: "openai.realtime",
    providerId: "openai",
    kind: "streaming",
    label: "Realtime cloud",
    modelId: OPENAI_REALTIME_WHISPER_MODEL_ID,
    secondaryText: "OpenAI gpt-realtime-whisper",
    requiresCloudConsent: true
  },
  {
    id: "openai.accuracy",
    providerId: "openai",
    kind: "file",
    label: "Cloud accuracy",
    modelId: OPENAI_TRANSCRIBE_MODEL_ID,
    secondaryText: "OpenAI gpt-4o-transcribe",
    requiresCloudConsent: true
  },
  {
    id: "openai.economy",
    providerId: "openai",
    kind: "file",
    label: "Cloud economy",
    modelId: OPENAI_MINI_TRANSCRIBE_MODEL_ID,
    secondaryText: "OpenAI gpt-4o-mini-transcribe",
    requiresCloudConsent: true
  }
];

export function getDictationMode(id: DictationModeId): DictationMode {
  return dictationModes.find((mode) => mode.id === id) ?? dictationModes[1];
}

export function isDictationModeId(value: unknown): value is DictationModeId {
  return typeof value === "string" && dictationModes.some((mode) => mode.id === value);
}

export function isCloudDictationMode(id: DictationModeId): boolean {
  return getDictationMode(id).providerId === "openai";
}
