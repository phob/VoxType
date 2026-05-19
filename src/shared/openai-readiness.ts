import { type DictationModeId } from "./asr";

export type OpenAiModeImplementationReadiness = {
  fileAccuracyReady: boolean;
  fileEconomyReady: boolean;
  realtimeReady: boolean;
};

export const currentOpenAiModeImplementationReadiness: OpenAiModeImplementationReadiness = {
  fileAccuracyReady: true,
  fileEconomyReady: true,
  realtimeReady: false
};

export function areAllOpenAiModesReadyForRelease(
  readiness: OpenAiModeImplementationReadiness
): boolean {
  return readiness.fileAccuracyReady && readiness.fileEconomyReady && readiness.realtimeReady;
}

export function isOpenAiModeImplemented(
  modeId: DictationModeId,
  readiness: OpenAiModeImplementationReadiness
): boolean {
  switch (modeId) {
    case "openai.accuracy":
      return readiness.fileAccuracyReady;
    case "openai.economy":
      return readiness.fileEconomyReady;
    case "openai.realtime":
      return readiness.realtimeReady;
    default:
      return true;
  }
}
