import { getDictationMode, isCloudDictationMode, type DictationModeId } from "./asr";
import { type AppProfile, type AppSettings } from "./settings";

export type CloudDictationReadinessReasonCode =
  | "local_ready"
  | "offline_mode"
  | "consent_required"
  | "api_key_required"
  | "cloud_ready";

export type CloudDictationReadiness = {
  modeId: DictationModeId;
  cloud: boolean;
  ready: boolean;
  reason: string | null;
  reasonCode: CloudDictationReadinessReasonCode;
};

export function resolveEffectiveDictationModeId(
  settings: AppSettings,
  profile: AppProfile | null
): DictationModeId {
  return profile?.dictationModeId && profile.dictationModeId !== "inherit"
    ? profile.dictationModeId
    : settings.dictationModeId;
}

export function getCloudDictationReadiness(input: {
  settings: AppSettings;
  profile: AppProfile | null;
  hasApiKey: boolean;
}): CloudDictationReadiness {
  const requestedModeId = resolveEffectiveDictationModeId(input.settings, input.profile);
  const modeId =
    input.profile?.forbidCloudDictation && isCloudDictationMode(requestedModeId)
      ? "local.balanced"
      : requestedModeId;
  const cloud = isCloudDictationMode(modeId);

  if (!cloud) {
    return { modeId, cloud, ready: true, reason: null, reasonCode: "local_ready" };
  }

  if (input.settings.offlineMode) {
    return {
      modeId,
      cloud,
      ready: false,
      reason: "Cloud Dictation is disabled while Offline Mode is on.",
      reasonCode: "offline_mode"
    };
  }

  if (!input.settings.cloudDictationConsentAccepted) {
    return {
      modeId,
      cloud,
      ready: false,
      reason: "Cloud Dictation requires one-time consent.",
      reasonCode: "consent_required"
    };
  }

  if (!input.hasApiKey) {
    return {
      modeId,
      cloud,
      ready: false,
      reason: "Add an OpenAI API key before recording.",
      reasonCode: "api_key_required"
    };
  }

  return {
    modeId,
    cloud,
    ready: true,
    reason: `${getDictationMode(modeId).label} ready.`,
    reasonCode: "cloud_ready"
  };
}
