import { getDictationMode, isCloudDictationMode, type DictationModeId } from "./asr";
import { getOpenAiModeImplementationStatus, type OpenAiModeImplementationReadiness } from "./openai-readiness";
import { type AppSettings } from "./settings";

export type DictationModeAvailabilityReasonCode =
  | "offline"
  | "mode_not_implemented"
  | "release_gated"
  | "realtime_not_ready"
  | "api_key_required";

export type DictationModeAvailability = {
  modeId: DictationModeId;
  selectable: boolean;
  reason: string | null;
  reasonCode: DictationModeAvailabilityReasonCode | null;
};

export function getDictationModeAvailability(input: {
  modeId: DictationModeId;
  settings: AppSettings;
  hasOpenAiApiKey: boolean;
  realtimeStreamingReady: boolean;
  allOpenAiModesReadyForRelease: boolean;
  openAiReadiness: OpenAiModeImplementationReadiness;
}): DictationModeAvailability {
  const mode = getDictationMode(input.modeId);

  if (input.settings.offlineMode && isCloudDictationMode(mode.id)) {
    return { modeId: mode.id, selectable: false, reason: "disabled in Offline Mode", reasonCode: "offline" };
  }

  if (mode.providerId === "openai") {
    const implementation = getOpenAiModeImplementationStatus(mode.id, input.openAiReadiness);

    if (!implementation.implemented) {
      return {
        modeId: mode.id,
        selectable: false,
        reason: implementation.reason ?? `${mode.label} is not implemented yet`,
        reasonCode: "mode_not_implemented"
      };
    }
  }

  if (mode.providerId === "openai" && !input.allOpenAiModesReadyForRelease) {
    return {
      modeId: mode.id,
      selectable: false,
      reason: "Cloud Dictation is available after all OpenAI modes are ready",
      reasonCode: "release_gated"
    };
  }

  if (mode.id === "openai.realtime" && !input.realtimeStreamingReady) {
    return {
      modeId: mode.id,
      selectable: false,
      reason: "Realtime streaming is not available yet",
      reasonCode: "realtime_not_ready"
    };
  }

  if (mode.providerId === "openai" && !input.hasOpenAiApiKey) {
    return {
      modeId: mode.id,
      selectable: true,
      reason: "API key required before recording",
      reasonCode: "api_key_required"
    };
  }

  return { modeId: mode.id, selectable: true, reason: null, reasonCode: null };
}
