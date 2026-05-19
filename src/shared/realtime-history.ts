import { randomUUID } from "node:crypto";
import { type DictationMode, type TranscriptTurn } from "./asr";
import { getProviderLanguageHint } from "./provider-language";
import { type WhisperLanguage } from "./settings";
import { TranscriptTurnAccumulator } from "./transcript-turns";
import { type TranscriptEntry } from "./transcripts";

export type RealtimeCloudHistoryInput = {
  mode: DictationMode;
  turns: TranscriptTurn[];
  startedAtMs: number;
  endedAtMs: number;
  correctedText?: string | null;
  correctionsApplied?: string[];
  language?: WhisperLanguage;
};

export type RealtimeCloudCorrectionInput = {
  text: string;
  processName?: string | null;
};

export type RealtimeCloudCorrectionResult = {
  text: string;
  correctionsApplied?: string[];
};

export type RealtimeCloudCorrectionApplier = (
  input: RealtimeCloudCorrectionInput
) => Promise<RealtimeCloudCorrectionResult>;

export async function createCorrectedRealtimeCloudHistoryEntry(
  input: RealtimeCloudHistoryInput & {
    processName?: string | null;
    applyCorrections: RealtimeCloudCorrectionApplier;
  }
): Promise<TranscriptEntry> {
  const providerText = composeRealtimeTurns(input.turns);
  const correction = await input.applyCorrections({
    text: providerText,
    processName: input.processName
  });

  return createRealtimeCloudHistoryEntry({
    ...input,
    correctedText: correction.text,
    correctionsApplied: correction.correctionsApplied
  });
}

export function createRealtimeCloudHistoryEntry(
  input: RealtimeCloudHistoryInput
): TranscriptEntry {
  const providerText = normalizeRealtimeProviderText(composeRealtimeTurns(input.turns));
  const text = normalizeRealtimeProviderText(input.correctedText || providerText);

  return {
    id: randomUUID(),
    text,
    rawText: providerText && providerText !== text ? providerText : undefined,
    correctionsApplied:
      input.correctionsApplied && input.correctionsApplied.length > 0
        ? input.correctionsApplied
        : undefined,
    audioUnavailableReason: "Realtime cloud audio playback is not saved",
    providerId: "openai",
    dictationModeId: input.mode.id,
    modelId: input.mode.modelId,
    languageHint: input.language ? getProviderLanguageHint("openai", input.language).parameterValue ?? undefined : undefined,
    turnCount: input.turns.length,
    turnStatus: summarizeRealtimeTurnStatus(input.turns),
    createdAt: new Date(input.startedAtMs).toISOString(),
    durationMs: Math.max(0, Math.round(input.endedAtMs - input.startedAtMs))
  };
}

function normalizeRealtimeProviderText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function composeRealtimeTurns(turns: TranscriptTurn[]): string {
  const accumulator = new TranscriptTurnAccumulator();

  for (const turn of turns) {
    accumulator.apply({
      providerItemId: turn.providerItemId,
      text: turn.finalText ?? turn.provisionalText ?? "",
      final: turn.status === "final" || turn.status === "fallback"
    });
  }

  return accumulator.composeFinalText();
}

function summarizeRealtimeTurnStatus(turns: TranscriptTurn[]): string {
  if (turns.some((turn) => turn.status === "fallback")) {
    return "partial fallback used";
  }

  if (turns.every((turn) => turn.status === "final")) {
    return "final";
  }

  return "incomplete";
}
