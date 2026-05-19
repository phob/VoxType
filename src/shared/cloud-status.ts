import { getDictationMode, isCloudDictationMode, type DictationModeId } from "./asr";
import { type AppProfile, type AppSettings } from "./settings";

export const profileCloudFallbackModeId = "local.balanced" satisfies DictationModeId;

export type CloudDictationReadinessReasonCode =
  | "local_ready"
  | "offline_mode"
  | "consent_required"
  | "api_key_required"
  | "cloud_ready";

export type CloudDictationReadiness = {
  requestedModeId: DictationModeId;
  modeId: DictationModeId;
  cloud: boolean;
  ready: boolean;
  reason: string | null;
  reasonCode: CloudDictationReadinessReasonCode;
  profileForbidsCloud: boolean;
  fallbackModeId: DictationModeId | null;
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
  return getCloudDictationReadinessForMode({
    ...input,
    requestedModeId: resolveEffectiveDictationModeId(input.settings, input.profile)
  });
}

export function getCloudDictationReadinessForMode(input: {
  settings: AppSettings;
  profile: AppProfile | null;
  hasApiKey: boolean;
  requestedModeId: DictationModeId;
}): CloudDictationReadiness {
  const requestedModeId = input.requestedModeId;
  const profileForbidsCloud = Boolean(
    input.profile?.forbidCloudDictation && isCloudDictationMode(requestedModeId)
  );
  const modeId = profileForbidsCloud ? profileCloudFallbackModeId : requestedModeId;
  const fallbackModeId = profileForbidsCloud ? modeId : null;
  const cloud = isCloudDictationMode(modeId);

  if (!cloud) {
    return {
      requestedModeId,
      modeId,
      cloud,
      ready: true,
      reason: profileForbidsCloud
        ? "This App Profile forbids Cloud Dictation; using Local balanced instead."
        : null,
      reasonCode: "local_ready",
      profileForbidsCloud,
      fallbackModeId
    };
  }

  if (input.settings.offlineMode) {
    return {
      requestedModeId,
      modeId,
      cloud,
      ready: false,
      reason: "Cloud Dictation is disabled while Offline Mode is on.",
      reasonCode: "offline_mode",
      profileForbidsCloud,
      fallbackModeId
    };
  }

  if (!input.settings.cloudDictationConsentAccepted) {
    return {
      requestedModeId,
      modeId,
      cloud,
      ready: false,
      reason: "Cloud Dictation requires one-time consent.",
      reasonCode: "consent_required",
      profileForbidsCloud,
      fallbackModeId
    };
  }

  if (!input.hasApiKey) {
    return {
      requestedModeId,
      modeId,
      cloud,
      ready: false,
      reason: "Add an OpenAI API key before recording.",
      reasonCode: "api_key_required",
      profileForbidsCloud,
      fallbackModeId
    };
  }

  return {
    requestedModeId,
    modeId,
    cloud,
    ready: true,
    reason: `${getDictationMode(modeId).label} ready.`,
    reasonCode: "cloud_ready",
    profileForbidsCloud,
    fallbackModeId
  };
}
