import { type RealtimeLatencyPreset } from "./settings";

export type OpenAiRealtimeVadConfig = {
  type: "server_vad";
  threshold: number;
  prefix_padding_ms: number;
  silence_duration_ms: number;
};

export function getOpenAiRealtimeVadConfig(
  preset: RealtimeLatencyPreset,
  developerThresholdOverride: number | null = null
): OpenAiRealtimeVadConfig {
  const override = sanitizeDeveloperVadThresholdOverride(developerThresholdOverride);
  const config = (() => {
    switch (preset) {
    case "fast":
      return {
        type: "server_vad",
        threshold: 0.55,
        prefix_padding_ms: 250,
        silence_duration_ms: 450
      };
    case "accurate":
      return {
        type: "server_vad",
        threshold: 0.45,
        prefix_padding_ms: 500,
        silence_duration_ms: 900
      };
    case "balanced":
    default:
      return {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 350,
        silence_duration_ms: 650
      };
    }
  })();

  return override === null ? config : { ...config, threshold: override };
}

function sanitizeDeveloperVadThresholdOverride(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(Math.max(value, 0.05), 0.95);
}
