// Speech segmentation from per-frame Silero VAD probabilities.
//
// The native helper keeps the full recording and reports one probability per VAD frame; all
// decisions about what counts as speech live here so live recordings, saved audio and the E2E
// corpus go through exactly the same policy.

export interface SpeechSegmentationOptions {
  /** A region only counts as speech if at least one frame reaches this probability. */
  onsetThreshold: number;
  /** Speech boundaries extend in both directions while the probability stays at or above this. */
  offsetThreshold: number;
  /** Regions shorter than this (clicks, coughs, lip smacks) are dropped. */
  minSpeechMs: number;
  /** Regions separated by less than this are one segment. */
  minSilenceMs: number;
  /** Audio kept before the first speech frame of a segment. */
  padBeforeMs: number;
  /** Audio kept after the last speech frame of a segment (word tails decay below the threshold). */
  padAfterMs: number;
}

export const defaultSpeechSegmentation: SpeechSegmentationOptions = {
  onsetThreshold: 0.5,
  offsetThreshold: 0.2,
  minSpeechMs: 250,
  minSilenceMs: 500,
  padBeforeMs: 300,
  padAfterMs: 400
};

export interface VadTrack {
  sampleRateHz: number;
  frameSamples: number;
  /** One probability per frame, quantized to 0..255. */
  probabilities: Uint8Array;
}

/** Sample offsets into the recording. `start`/`end` include padding; `speech*` is the detected core. */
export interface SpeechSegment {
  start: number;
  end: number;
  speechStart: number;
  speechEnd: number;
}

export function detectSpeechSegments(
  track: VadTrack,
  totalSamples: number,
  options: SpeechSegmentationOptions = defaultSpeechSegmentation
): SpeechSegment[] {
  const onset = Math.round(options.onsetThreshold * 255);
  const offset = Math.round(options.offsetThreshold * 255);
  const msToFrames = (ms: number) => Math.round((ms * track.sampleRateHz) / 1000 / track.frameSamples);
  const regions: Array<{ first: number; last: number; confident: boolean }> = [];

  for (let frame = 0; frame < track.probabilities.length; frame += 1) {
    const probability = track.probabilities[frame];

    if (probability < offset) {
      continue;
    }

    const current = regions.at(-1);
    if (current && frame - current.last - 1 < msToFrames(options.minSilenceMs)) {
      current.last = frame;
      current.confident ||= probability >= onset;
    } else {
      regions.push({ first: frame, last: frame, confident: probability >= onset });
    }
  }

  const minSpeechFrames = Math.max(1, msToFrames(options.minSpeechMs));
  const padBefore = Math.round((options.padBeforeMs * track.sampleRateHz) / 1000);
  const padAfter = Math.round((options.padAfterMs * track.sampleRateHz) / 1000);
  const segments: SpeechSegment[] = [];

  for (const region of regions) {
    if (!region.confident || region.last - region.first + 1 < minSpeechFrames) {
      continue;
    }

    const speechStart = region.first * track.frameSamples;
    const speechEnd = Math.min(totalSamples, (region.last + 1) * track.frameSamples);
    const segment = {
      start: Math.max(0, speechStart - padBefore),
      end: Math.min(totalSamples, speechEnd + padAfter),
      speechStart,
      speechEnd
    };
    const previous = segments.at(-1);

    if (previous && segment.start <= previous.end) {
      previous.end = segment.end;
      previous.speechEnd = segment.speechEnd;
    } else {
      segments.push(segment);
    }
  }

  return segments;
}

export function speechDurationMs(segments: SpeechSegment[], sampleRateHz: number): number {
  const samples = segments.reduce((sum, segment) => sum + segment.speechEnd - segment.speechStart, 0);
  return Math.round((samples / sampleRateHz) * 1000);
}
