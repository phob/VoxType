import { NonRealTimeVAD } from "@ricky0123/vad-web";
import sileroVadModelUrl from "@ricky0123/vad-web/dist/silero_vad_legacy.onnx?url";
import ortWasmModuleUrl from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { type AppSettings } from "../../../shared/settings";

export type VadTrimOptions = Pick<
  AppSettings,
  | "vadEnabled"
  | "vadPositiveSpeechThreshold"
  | "vadNegativeSpeechThreshold"
  | "vadMinSpeechMs"
  | "vadPreSpeechPadMs"
  | "vadRedemptionMs"
>;

export type VadTrimStats = {
  enabled: boolean;
  model: "silero-legacy";
  speechSegments: number;
  originalDurationMs: number;
  trimmedDurationMs: number;
  removedDurationMs: number;
  speechDetected: boolean;
  skippedReason?: string;
};

type SpeechSegment = {
  audio: Float32Array;
  start: number;
  end: number;
};

type SampleRange = {
  start: number;
  end: number;
};

export async function trimSilenceWithVad(
  samples: Float32Array,
  sampleRate: number,
  options: VadTrimOptions
): Promise<{ samples: Float32Array; stats: VadTrimStats }> {
  const originalDurationMs = samplesToMs(samples.length, sampleRate);

  if (!options.vadEnabled || samples.length === 0) {
    return {
      samples,
      stats: createStats({
        enabled: options.vadEnabled,
        speechSegments: samples.length > 0 ? 1 : 0,
        originalDurationMs,
        trimmedDurationMs: originalDurationMs,
        speechDetected: samples.length > 0
      })
    };
  }

  const vad = await NonRealTimeVAD.new({
    modelURL: sileroVadModelUrl,
    modelFetcher: async (path) => {
      const response = await fetch(path);

      if (!response.ok) {
        throw new Error(`Failed to load Silero VAD model: ${response.status}`);
      }

      return response.arrayBuffer();
    },
    positiveSpeechThreshold: options.vadPositiveSpeechThreshold,
    negativeSpeechThreshold: Math.min(
      options.vadNegativeSpeechThreshold,
      options.vadPositiveSpeechThreshold - 0.01
    ),
    minSpeechMs: options.vadMinSpeechMs,
    preSpeechPadMs: options.vadPreSpeechPadMs,
    redemptionMs: options.vadRedemptionMs,
    submitUserSpeechOnPause: true,
    ortConfig: (ort) => {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = {
        mjs: ortWasmModuleUrl,
        wasm: ortWasmUrl
      };
    }
  });
  const segments: SpeechSegment[] = [];

  for await (const segment of vad.run(samples, sampleRate)) {
    segments.push(segment);
  }

  if (segments.length === 0) {
    return {
      samples: new Float32Array(0),
      stats: createStats({
        enabled: true,
        speechSegments: 0,
        originalDurationMs,
        trimmedDurationMs: 0,
        speechDetected: false,
        skippedReason: "No speech detected by Silero VAD."
      })
    };
  }

  const ranges = segments
    .map((segment) => segmentToRange(segment, sampleRate, samples.length))
    .filter((candidate) => candidate.end > candidate.start)
    .sort((first, second) => first.start - second.start);
  const trimmed = trimToSpeechEnvelope(samples, ranges);
  const trimmedDurationMs = samplesToMs(trimmed.length, sampleRate);

  return {
    samples: trimmed,
    stats: createStats({
      enabled: true,
      speechSegments: segments.length,
      originalDurationMs,
      trimmedDurationMs,
      speechDetected: true
    })
  };
}

function segmentToRange(
  segment: SpeechSegment,
  sampleRate: number,
  sampleCount: number
): SampleRange {
  const end = clamp(msToSamples(segment.end, sampleRate), 0, sampleCount);
  const startFromTimestamp = clamp(msToSamples(segment.start, sampleRate), 0, end);
  const startFromAudioLength = clamp(end - segment.audio.length, 0, end);

  return {
    start: Math.min(startFromTimestamp, startFromAudioLength),
    end
  };
}

function trimToSpeechEnvelope(samples: Float32Array, ranges: SampleRange[]): Float32Array {
  if (ranges.length === 0) {
    return new Float32Array(0);
  }

  const start = ranges[0].start;
  const end = ranges[ranges.length - 1].end;

  return samples.slice(start, end);
}

function createStats(input: Omit<VadTrimStats, "model" | "removedDurationMs">): VadTrimStats {
  return {
    ...input,
    model: "silero-legacy",
    removedDurationMs: Math.max(0, input.originalDurationMs - input.trimmedDurationMs)
  };
}

function samplesToMs(samples: number, sampleRate: number): number {
  return Math.round((samples / sampleRate) * 1000);
}

function msToSamples(milliseconds: number, sampleRate: number): number {
  return Math.round((milliseconds * sampleRate) / 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
