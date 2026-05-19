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

export function getPendingCloudReleaseSmokeTests(
  checklist: CloudReleaseSmokeTestChecklist
): Array<keyof CloudReleaseSmokeTestChecklist> {
  return (Object.keys(checklist) as Array<keyof CloudReleaseSmokeTestChecklist>).filter(
    (key) => !checklist[key]
  );
}

export function formatCloudReleaseSmokeTestStatus(
  checklist: CloudReleaseSmokeTestChecklist
): string {
  const pending = getPendingCloudReleaseSmokeTests(checklist);

  if (pending.length === 0) {
    return "Cloud release smoke test complete";
  }

  return `Cloud release smoke test pending: ${pending.join(", ")}`;
}

export function isCloudReleaseSmokeTestComplete(
  checklist: CloudReleaseSmokeTestChecklist
): boolean {
  return getPendingCloudReleaseSmokeTests(checklist).length === 0;
}
