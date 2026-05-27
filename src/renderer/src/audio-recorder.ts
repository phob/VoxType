import { type AppSettings } from "../../shared/settings";
import { type NativeRecordingDiagnostics } from "../../shared/windows-helper";

export interface PcmRecorder {
  stop: () => Promise<PcmRecordingResult>;
}

export interface PcmRecordingResult {
  wavBytes: Uint8Array;
  captureMode: "sharedCapture" | "exclusiveCapture";
  vad: VadTrimStats;
  diagnostics: NativeRecordingDiagnostics;
}

export interface VadTrimStats {
  enabled: boolean;
  model: "silero-v4-native";
  speechSegments: number;
  originalDurationMs: number;
  trimmedDurationMs: number;
  removedDurationMs: number;
  speechDetected: boolean;
  skippedReason?: string;
}

export async function startNativePcmRecorder(
  settings?: AppSettings | null,
  options: { realtimePcm16Enabled?: boolean } = {}
): Promise<PcmRecorder> {
  const developerMode = settings?.developerModeEnabled === true;

  await window.voxtype.windowsHelper.startRecording({
    captureMode: developerMode ? settings.recorderCaptureMode : "sharedCapture",
    inputDeviceId: settings?.recordingInputDeviceId ?? "default",
    vadEnabled: developerMode ? settings.vadEnabled : true,
    realtimePcm16Enabled: options.realtimePcm16Enabled ?? false,
    vadPositiveSpeechThreshold: settings?.vadPositiveSpeechThreshold ?? 0.3,
    vadPreSpeechPadMs: settings?.vadPreSpeechPadMs ?? 450,
    vadRedemptionMs: settings?.vadRedemptionMs ?? 450,
    vadPreservedPauseMs: settings?.vadPreservedPauseMs ?? 2000
  });

  return {
    stop: async () => {
      const result = await window.voxtype.windowsHelper.stopRecording();
      const originalDurationMs = samplesToMs(result.rawSamples, result.sampleRate);
      const trimmedDurationMs = samplesToMs(result.samples, result.sampleRate);
      const speechDetected = !result.vadEnabled || result.speechFrames > 0;

      return {
        wavBytes: result.wavBytes,
        captureMode: result.captureMode,
        diagnostics: result.diagnostics,
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
