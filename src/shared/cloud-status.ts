import { getDictationMode, isCloudDictationMode, type DictationModeId } from "./asr";
import { type AppProfile, type AppSettings } from "./settings";

export type CloudDictationReadiness = {
  modeId: DictationModeId;
  cloud: boolean;
  ready: boolean;
  reason: string | null;
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
    return { modeId, cloud, ready: true, reason: null };
  }

  if (input.settings.offlineMode) {
    return { modeId, cloud, ready: false, reason: "Cloud Dictation is disabled while Offline Mode is on." };
  }

  if (!input.settings.cloudDictationConsentAccepted) {
    return { modeId, cloud, ready: false, reason: "Cloud Dictation requires one-time consent." };
  }

  if (!input.hasApiKey) {
    return { modeId, cloud, ready: false, reason: "Add an OpenAI API key before recording." };
  }

  return { modeId, cloud, ready: true, reason: `${getDictationMode(modeId).label} ready.` };
}
