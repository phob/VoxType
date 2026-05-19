export type CloudReleaseSmokeTestChecklist = {
  realtimeEndToEndDictation: boolean;
  accuracyFileDictation: boolean;
  economyFileDictation: boolean;
  offlineKillSwitch: boolean;
  profileCloudForbidFallback: boolean;
  noSensitiveCloudLogs: boolean;
};

export const currentCloudReleaseSmokeTestChecklist: CloudReleaseSmokeTestChecklist = {
  realtimeEndToEndDictation: false,
  accuracyFileDictation: false,
  economyFileDictation: false,
  offlineKillSwitch: false,
  profileCloudForbidFallback: false,
  noSensitiveCloudLogs: false
};

export function isCloudReleaseSmokeTestComplete(
  checklist: CloudReleaseSmokeTestChecklist
): boolean {
  return Object.values(checklist).every((passed) => passed);
}
