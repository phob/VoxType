import { type AsrProviderId, type DictationModeId } from "./asr";

export type TranscriptEntry = {
  id: string;
  text: string;
  rawText?: string;
  correctionsApplied?: string[];
  ocrCorrectionsApplied?: string[];
  promptContext?: string;
  audioFileName?: string;
  audioUnavailableReason?: string;
  providerId?: AsrProviderId;
  dictationModeId?: DictationModeId;
  modelId: string;
  languageHint?: string;
  turnCount?: number;
  turnStatus?: string;
  createdAt: string;
  durationMs: number;
};

export type TranscriptionResult = {
  entry: TranscriptEntry;
  promptContext: string | null;
};
