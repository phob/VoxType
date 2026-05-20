import { isCloudDictationMode, type DictationModeId } from "./asr";

export interface CloudFailurePolicy {
  allowAutomaticLocalFallback: false;
  userMessage: string;
}

export function getCloudFailurePolicy(modeId: DictationModeId): CloudFailurePolicy {
  if (!isCloudDictationMode(modeId)) {
    return {
      allowAutomaticLocalFallback: false,
      userMessage: "Local dictation failed."
    };
  }

  return {
    allowAutomaticLocalFallback: false,
    userMessage:
      "Cloud Dictation failed. VoxType will not automatically retry with local dictation because that could change privacy and accuracy expectations."
  };
}
