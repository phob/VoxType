import { type DictationModeId } from "./asr";

export type OpenAiModeImplementationReadiness = {
  fileAccuracyReady: boolean;
  fileEconomyReady: boolean;
  realtimeSessionIpcReady: boolean;
  realtimeRendererLifecycleReady: boolean;
  realtimeNativePcmStreamingReady: boolean;
  releaseSmokeTested: boolean;
  realtimeReady: boolean;
};

export const currentOpenAiModeImplementationReadiness = createOpenAiModeImplementationReadiness({
  fileAccuracyReady: true,
  fileEconomyReady: true,
  realtimeSessionIpcReady: true,
  realtimeRendererLifecycleReady: true,
  realtimeNativePcmStreamingReady: true,
  releaseSmokeTested: false
});

export function createOpenAiModeImplementationReadiness(input: Omit<OpenAiModeImplementationReadiness, "realtimeReady">): OpenAiModeImplementationReadiness {
  return {
    ...input,
    realtimeReady:
      input.realtimeSessionIpcReady &&
      input.realtimeRendererLifecycleReady &&
      input.realtimeNativePcmStreamingReady &&
      input.releaseSmokeTested
  };
}

export function areAllOpenAiModesReadyForRelease(
  readiness: OpenAiModeImplementationReadiness
): boolean {
  return readiness.fileAccuracyReady && readiness.fileEconomyReady && readiness.realtimeReady && readiness.releaseSmokeTested;
}

export function getOpenAiModeImplementationStatus(
  modeId: DictationModeId,
  readiness: OpenAiModeImplementationReadiness
): { implemented: boolean; reason: string | null } {
  if (modeId === "openai.realtime" && !readiness.releaseSmokeTested) {
    return {
      implemented: false,
      reason: "Realtime Cloud Dictation needs release smoke testing before normal UI exposure"
    };
  }

  if (modeId === "openai.realtime" && !readiness.realtimeNativePcmStreamingReady) {
    return {
      implemented: false,
      reason: "Realtime native PCM streaming is not implemented yet"
    };
  }

  return {
    implemented: isOpenAiModeImplemented(modeId, readiness),
    reason: null
  };
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
