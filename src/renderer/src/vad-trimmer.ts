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
  | "vadPreservedPauseMs"
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

const JOIN_CROSSFADE_MS = 12;

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

  const ranges = mergeNearbyRanges(
    segments.map((segment) => segmentToRange(segment, sampleRate, samples.length)),
    sampleRate,
    options.vadPreservedPauseMs
  );
  const trimmed = concatenateRanges(samples, ranges, sampleRate);
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

function mergeNearbyRanges(
  ranges: SampleRange[],
  sampleRate: number,
  preservedPauseMs: number
): SampleRange[] {
  const mergeGapSamples = Math.round((sampleRate * preservedPauseMs) / 1000);
  const merged: SampleRange[] = [];

  for (const range of ranges
    .filter((candidate) => candidate.end > candidate.start)
    .sort((first, second) => first.start - second.start)) {
    const previous = merged[merged.length - 1];

    if (previous && range.start - previous.end <= mergeGapSamples) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

function concatenateRanges(
  samples: Float32Array,
  ranges: SampleRange[],
  sampleRate: number
): Float32Array {
  if (ranges.length === 0) {
    return new Float32Array(0);
  }

  const chunks = ranges.map((range) => samples.slice(range.start, range.end));
  const crossfadeSamples = Math.round((sampleRate * JOIN_CROSSFADE_MS) / 1000);
  const output: number[] = [];

  for (const chunk of chunks) {
    appendChunk(output, chunk, crossfadeSamples);
  }

  return Float32Array.from(output);
}

function appendChunk(output: number[], chunk: Float32Array, crossfadeSamples: number): void {
  if (chunk.length === 0) {
    return;
  }

  if (output.length === 0 || crossfadeSamples <= 0) {
    for (const sample of chunk) {
      output.push(sample);
    }
    return;
  }

  const fadeSamples = Math.min(crossfadeSamples, output.length, chunk.length);

  for (let index = 0; index < fadeSamples; index += 1) {
    const weight = (index + 1) / (fadeSamples + 1);
    const outputIndex = output.length - fadeSamples + index;

    output[outputIndex] = output[outputIndex] * (1 - weight) + chunk[index] * weight;
  }

  for (let index = fadeSamples; index < chunk.length; index += 1) {
    output.push(chunk[index]);
  }
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
