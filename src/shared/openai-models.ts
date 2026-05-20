import { type DictationModeId } from "./asr";

export const OPENAI_REALTIME_WHISPER_MODEL_ID = "gpt-realtime-whisper" as const;
export const OPENAI_TRANSCRIBE_MODEL_ID = "gpt-4o-transcribe" as const;
export const OPENAI_MINI_TRANSCRIBE_MODEL_ID = "gpt-4o-mini-transcribe" as const;

export const openAiModeModelIds: Record<Extract<DictationModeId, `openai.${string}`>, string> = {
  "openai.realtime": OPENAI_REALTIME_WHISPER_MODEL_ID,
  "openai.accuracy": OPENAI_TRANSCRIBE_MODEL_ID,
  "openai.economy": OPENAI_MINI_TRANSCRIBE_MODEL_ID
};

export function getOpenAiModelIdForMode(modeId: DictationModeId): string | null {
  if (!isOpenAiModeId(modeId)) {
    return null;
  }

  return openAiModeModelIds[modeId];
}

function isOpenAiModeId(modeId: DictationModeId): modeId is keyof typeof openAiModeModelIds {
  return modeId in openAiModeModelIds;
}

export function isKnownOpenAiTranscriptionModel(modelId: string): boolean {
  return Object.values(openAiModeModelIds).includes(modelId);
}
