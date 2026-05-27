import { type AsrProviderId, type DictationModeId } from "./asr";

export interface TranscriptEntry {
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
}

export interface TranscriptionResult {
  entry: TranscriptEntry;
  promptContext: string | null;
}
