import { type DictationModeId } from "./asr";
import { currentCloudReleaseSmokeTestChecklist, isCloudReleaseSmokeTestComplete } from "./cloud-release-smoke-test";

export interface OpenAiModeImplementationReadiness {
  fileAccuracyReady: boolean;
  fileEconomyReady: boolean;
  realtimeSessionIpcReady: boolean;
  realtimeRendererLifecycleReady: boolean;
  realtimeNativePcmStreamingReady: boolean;
  releaseSmokeTested: boolean;
  realtimeReady: boolean;
}

export const currentOpenAiModeImplementationReadiness = createOpenAiModeImplementationReadiness({
  fileAccuracyReady: true,
  fileEconomyReady: true,
  realtimeSessionIpcReady: true,
  realtimeRendererLifecycleReady: true,
  realtimeNativePcmStreamingReady: true,
  releaseSmokeTested: isCloudReleaseSmokeTestComplete(currentCloudReleaseSmokeTestChecklist)
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
      return readiness.realtimeSessionIpcReady &&
        readiness.realtimeRendererLifecycleReady &&
        readiness.realtimeNativePcmStreamingReady;
    default:
      return true;
  }
}
