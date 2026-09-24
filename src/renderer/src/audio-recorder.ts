import { type AppSettings } from "../../shared/settings";
import {
  defaultSpeechSegmentation,
  speechDurationMs,
  type SpeechSegment
} from "../../shared/speech-segments";
import { type NativeRecordingDiagnostics } from "../../shared/windows-helper";

export interface PcmRecorder {
  stop: () => Promise<PcmRecordingResult>;
}

export interface PcmRecordingResult {
  wavBytes: Uint8Array;
  speechSegments: SpeechSegment[] | null;
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
  options: { isDeveloperBuild?: boolean; realtimePcm16Enabled?: boolean } = {}
): Promise<PcmRecorder> {
  const allowVadToggle = options.isDeveloperBuild === true;

  await window.voxtype.windowsHelper.startRecording({
    captureMode: settings?.recorderCaptureMode ?? "sharedCapture",
    inputDeviceId: settings?.recordingInputDeviceId ?? "default",
    vadEnabled: allowVadToggle ? (settings?.vadEnabled ?? true) : true,
    realtimePcm16Enabled: options.realtimePcm16Enabled ?? false,
    speechSegmentation: defaultSpeechSegmentation
  });

  return {
    stop: async () => {
      const result = await window.voxtype.windowsHelper.stopRecording();
      const originalDurationMs = samplesToMs(result.rawSamples, result.sampleRate);
      const segments = result.speechSegments;
      const trimmedDurationMs = segments ? speechDurationMs(segments, result.sampleRate) : originalDurationMs;
      const speechDetected = !segments || segments.length > 0;

      return {
        wavBytes: result.wavBytes,
        speechSegments: segments,
        captureMode: result.captureMode,
        diagnostics: result.diagnostics,
        vad: {
          enabled: result.vadEnabled,
          model: "silero-v4-native",
          speechSegments: segments ? segments.length : result.samples > 0 ? 1 : 0,
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
