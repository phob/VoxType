export interface CloudReleaseSmokeTestChecklist {
  realtimeEndToEndDictation: boolean;
  accuracyFileDictation: boolean;
  economyFileDictation: boolean;
  offlineKillSwitch: boolean;
  profileCloudForbidFallback: boolean;
  noSensitiveCloudLogs: boolean;
}

export const currentCloudReleaseSmokeTestChecklist: CloudReleaseSmokeTestChecklist = {
  realtimeEndToEndDictation: true,
  accuracyFileDictation: true,
  economyFileDictation: true,
  offlineKillSwitch: true,
  profileCloudForbidFallback: true,
  noSensitiveCloudLogs: true
};

export const cloudReleaseSmokeTestLabels: Record<keyof CloudReleaseSmokeTestChecklist, string> = {
  realtimeEndToEndDictation: "Realtime end-to-end dictation",
  accuracyFileDictation: "Cloud accuracy file dictation",
  economyFileDictation: "Cloud economy file dictation",
  offlineKillSwitch: "Offline Mode kill switch",
  profileCloudForbidFallback: "App Profile cloud-forbid fallback",
  noSensitiveCloudLogs: "No sensitive cloud logs"
};

export function getPendingCloudReleaseSmokeTests(
  checklist: CloudReleaseSmokeTestChecklist
): (keyof CloudReleaseSmokeTestChecklist)[] {
  return (Object.keys(checklist) as (keyof CloudReleaseSmokeTestChecklist)[]).filter(
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

  return `Cloud release smoke test pending: ${pending
    .map((key) => cloudReleaseSmokeTestLabels[key])
    .join(", ")}`;
}

export function isCloudReleaseSmokeTestComplete(
  checklist: CloudReleaseSmokeTestChecklist
): boolean {
  return getPendingCloudReleaseSmokeTests(checklist).length === 0;
}
