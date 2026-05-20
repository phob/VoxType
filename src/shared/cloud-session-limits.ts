import { isCloudDictationMode, type DictationModeId } from "./asr";
import { type AppSettings } from "./settings";

export interface CloudSessionLimitState {
  cloud: boolean;
  elapsedMs: number;
  shouldWarn: boolean;
  shouldStop: boolean;
  warningMessage: string | null;
}

export function getCloudSessionLimitState(input: {
  settings: AppSettings;
  modeId: DictationModeId;
  startedAtMs: number;
  nowMs: number;
}): CloudSessionLimitState {
  const cloud = isCloudDictationMode(input.modeId);
  const elapsedMs = Math.max(0, input.nowMs - input.startedAtMs);

  if (!cloud) {
    return { cloud, elapsedMs, shouldWarn: false, shouldStop: false, warningMessage: null };
  }

  const maxSessionMs = input.settings.cloudSessionMaxMs;
  const unlimited = maxSessionMs === null;
  const shouldStop = maxSessionMs !== null && elapsedMs >= maxSessionMs;
  const shouldWarn = !shouldStop && elapsedMs >= input.settings.cloudSessionWarnMs;

  return {
    cloud,
    elapsedMs,
    shouldWarn,
    shouldStop,
    warningMessage: shouldStop
      ? "Cloud Dictation reached the maximum session duration and will finalize now."
      : shouldWarn
        ? "Cloud Dictation has been active for more than 5 minutes."
        : null
  };
}
