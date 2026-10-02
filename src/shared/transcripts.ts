import { type AsrProviderId, type DictationModeId } from "./asr";
import { type TranscriptCleanup } from "./llm-cleanup";

export interface TranscriptEntry {
  id: string;
  text: string;
  rawText?: string;
  correctionsApplied?: string[];
  ocrCorrectionsApplied?: string[];
  /** Local LLM cleanup outcome; absent when cleanup was off or skipped for this dictation. */
  cleanup?: TranscriptCleanup;
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
