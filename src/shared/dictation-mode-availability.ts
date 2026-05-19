import { getDictationMode, isCloudDictationMode, type DictationModeId } from "./asr";
import { type AppSettings } from "./settings";

export type DictationModeAvailability = {
  modeId: DictationModeId;
  selectable: boolean;
  reason: string | null;
};

export function getDictationModeAvailability(input: {
  modeId: DictationModeId;
  settings: AppSettings;
  hasOpenAiApiKey: boolean;
  realtimeStreamingReady: boolean;
  allOpenAiModesReadyForRelease: boolean;
}): DictationModeAvailability {
  const mode = getDictationMode(input.modeId);

  if (input.settings.offlineMode && isCloudDictationMode(mode.id)) {
    return { modeId: mode.id, selectable: false, reason: "disabled in Offline Mode" };
  }

  if (mode.providerId === "openai" && !input.allOpenAiModesReadyForRelease) {
    return {
      modeId: mode.id,
      selectable: false,
      reason: "Cloud Dictation is available after all OpenAI modes are ready"
    };
  }

  if (mode.id === "openai.realtime" && !input.realtimeStreamingReady) {
    return {
      modeId: mode.id,
      selectable: false,
      reason: "Realtime streaming is not available yet"
    };
  }

  if (mode.providerId === "openai" && !input.hasOpenAiApiKey) {
    return {
      modeId: mode.id,
      selectable: true,
      reason: "API key required before recording"
    };
  }

  return { modeId: mode.id, selectable: true, reason: null };
}
