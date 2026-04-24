import { type AppSettings } from "../../../shared/settings";

export type PcmRecorder = {
  stop: () => Promise<PcmRecordingResult>;
};

export type PcmRecordingResult = {
  wavBytes: Uint8Array;
  vad: VadTrimStats;
};

export type VadTrimStats = {
  enabled: boolean;
  model: "silero-v4-native";
  speechSegments: number;
  originalDurationMs: number;
  trimmedDurationMs: number;
  removedDurationMs: number;
  speechDetected: boolean;
  skippedReason?: string;
};

export async function startNativePcmRecorder(settings?: AppSettings | null): Promise<PcmRecorder> {
  await window.voxtype.windowsHelper.startRecording({
    vadEnabled: settings?.vadEnabled ?? true,
    vadPositiveSpeechThreshold: settings?.vadPositiveSpeechThreshold ?? 0.3,
    vadPreSpeechPadMs: settings?.vadPreSpeechPadMs ?? 450,
    vadRedemptionMs: settings?.vadRedemptionMs ?? 450
  });

  return {
    stop: async () => {
      const result = await window.voxtype.windowsHelper.stopRecording();
      const originalDurationMs = samplesToMs(result.rawSamples, result.sampleRate);
      const trimmedDurationMs = samplesToMs(result.samples, result.sampleRate);
      const speechDetected = !result.vadEnabled || result.speechFrames > 0;

      return {
        wavBytes: result.wavBytes,
        vad: {
          enabled: result.vadEnabled,
          model: "silero-v4-native",
          speechSegments: result.vadEnabled ? result.speechFrames : result.samples > 0 ? 1 : 0,
          originalDurationMs,
          trimmedDurationMs,
          removedDurationMs: Math.max(0, originalDurationMs - trimmedDurationMs),
          speechDetected,
          skippedReason: speechDetected ? undefined : "No speech detected by native Silero VAD."
        }
      };
    }
  };
}

function samplesToMs(samples: number, sampleRate: number): number {
  if (sampleRate <= 0) {
    return 0;
  }

  return Math.round((samples / sampleRate) * 1000);
}
