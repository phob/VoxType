export type OpenAiModeImplementationReadiness = {
  fileAccuracyReady: boolean;
  fileEconomyReady: boolean;
  realtimeReady: boolean;
};

export const currentOpenAiModeImplementationReadiness: OpenAiModeImplementationReadiness = {
  fileAccuracyReady: true,
  fileEconomyReady: true,
  realtimeReady: false
};

export function areAllOpenAiModesReadyForRelease(
  readiness: OpenAiModeImplementationReadiness
): boolean {
  return readiness.fileAccuracyReady && readiness.fileEconomyReady && readiness.realtimeReady;
}
