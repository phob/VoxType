// Turns a full recording plus detected speech segments into the audio a recognizer should see.
//
// Long pauses are shortened to a fixed amount of real room tone (never removed by an energy
// threshold), and Whisper input is split into chunks that fit one 30 s decoding window, so pauses
// can neither starve Whisper into hallucinating nor carry text from one window into the next.
import { type SpeechSegment } from "../shared/speech-segments";
import { encodePcm16Wav, mixToMono, parsePcm16Wav } from "./wav-pcm";

export interface SpeechChunkingOptions {
  /** Upper bound for one Whisper input; Whisper decodes 30 s windows. */
  maxChunkMs: number;
  /** Pauses longer than this are shortened to this much audio (half after, half before). */
  maxKeptGapMs: number;
  /** Crossfade used where a shortened pause is joined. */
  crossfadeMs: number;
}

export const defaultSpeechChunking: SpeechChunkingOptions = {
  maxChunkMs: 25_000,
  maxKeptGapMs: 1_000,
  crossfadeMs: 20
};

export interface MonoPcm {
  sampleRateHz: number;
  samples: Int16Array;
}

export interface SpeechChunk {
  samples: Int16Array;
  sampleRateHz: number;
  /** Detected speech inside this chunk, in chunk-local milliseconds. */
  speechSpansMs: Array<{ startMs: number; endMs: number }>;
}

interface SourceRange {
  from: number;
  to: number;
  crossfade: boolean;
}

export function decodeMonoPcm(wavBytes: Uint8Array): MonoPcm {
  const wav = parsePcm16Wav(wavBytes);

  return {
    sampleRateHz: wav.sampleRateHz,
    samples: mixToMono(wav.samples, wav.channelCount)
  };
}

export function planSpeechChunks(
  audio: MonoPcm,
  segments: SpeechSegment[],
  options: SpeechChunkingOptions = defaultSpeechChunking
): SpeechChunk[] {
  const toSamples = (ms: number) => Math.round((ms * audio.sampleRateHz) / 1000);
  const maxChunk = Number.isFinite(options.maxChunkMs) ? toSamples(options.maxChunkMs) : Number.POSITIVE_INFINITY;
  const maxKeptGap = toSamples(options.maxKeptGapMs);
  const crossfade = toSamples(options.crossfadeMs);
  const pieces = segments.flatMap((segment) => splitLongSegment(audio, segment, maxChunk));
  const chunks: SpeechChunk[] = [];
  let ranges: SourceRange[] = [];
  let pieceGroup: SpeechSegment[] = [];
  let length = 0;

  const flush = () => {
    if (ranges.length > 0) {
      chunks.push(renderChunk(audio, ranges, pieceGroup, crossfade));
    }
    ranges = [];
    pieceGroup = [];
    length = 0;
  };

  for (const piece of pieces) {
    const previous = pieceGroup.at(-1);
    const pieceLength = piece.end - piece.start;

    if (!previous) {
      ranges.push({ from: piece.start, to: piece.end, crossfade: false });
      pieceGroup.push(piece);
      length = pieceLength;
      continue;
    }

    const gap = piece.start - previous.end;
    const keptGap = gap <= maxKeptGap ? gap : maxKeptGap - crossfade;

    if (length + keptGap + pieceLength > maxChunk) {
      flush();
      ranges.push({ from: piece.start, to: piece.end, crossfade: false });
      pieceGroup.push(piece);
      length = pieceLength;
      continue;
    }

    const last = ranges[ranges.length - 1];
    if (gap <= maxKeptGap) {
      last.to = piece.end;
    } else {
      const half = Math.floor(maxKeptGap / 2);
      last.to = previous.end + half;
      ranges.push({ from: piece.start - half, to: piece.end, crossfade: true });
    }
    pieceGroup.push(piece);
    length += keptGap + pieceLength;
  }

  flush();
  return chunks;
}

/** All speech as one WAV with shortened pauses; used for providers that take a single file. */
export function composeSpeechWav(
  audio: MonoPcm,
  segments: SpeechSegment[],
  options: SpeechChunkingOptions = defaultSpeechChunking
): Uint8Array | null {
  const [chunk] = planSpeechChunks(audio, segments, { ...options, maxChunkMs: Number.POSITIVE_INFINITY });

  return chunk ? encodePcm16Wav(chunk.samples, chunk.sampleRateHz, 1) : null;
}

function renderChunk(audio: MonoPcm, ranges: SourceRange[], pieces: SpeechSegment[], crossfade: number): SpeechChunk {
  const total = ranges.reduce((sum, range, index) => sum + range.to - range.from - (index > 0 && range.crossfade ? crossfade : 0), 0);
  const output = new Int16Array(total);
  const rangeOffsets: number[] = [];
  let cursor = 0;

  for (const [index, range] of ranges.entries()) {
    const source = audio.samples.subarray(range.from, range.to);
    const overlap = index > 0 && range.crossfade ? Math.min(crossfade, source.length, cursor) : 0;
    const start = cursor - overlap;

    for (let offset = 0; offset < overlap; offset += 1) {
      const fadeIn = (offset + 1) / (overlap + 1);
      output[start + offset] = Math.round(output[start + offset] * (1 - fadeIn) + source[offset] * fadeIn);
    }
    output.set(source.subarray(overlap), cursor);
    rangeOffsets.push(start);
    cursor = start + source.length;
  }

  const toOutput = (position: number) => {
    const index = ranges.findIndex((range) => position >= range.from && position <= range.to);
    return index >= 0 ? rangeOffsets[index] + position - ranges[index].from : 0;
  };
  const toMs = (samples: number) => Math.round((samples / audio.sampleRateHz) * 1000);

  return {
    samples: output.subarray(0, cursor),
    sampleRateHz: audio.sampleRateHz,
    speechSpansMs: pieces.map((piece) => ({
      startMs: toMs(toOutput(piece.speechStart)),
      endMs: toMs(toOutput(piece.speechEnd))
    }))
  };
}

// Continuous speech longer than one chunk is cut at its quietest 100 ms window in the last 40 %
// of the allowed length. Quietness is relative to the surrounding speech, not an absolute level.
function splitLongSegment(audio: MonoPcm, segment: SpeechSegment, maxChunk: number): SpeechSegment[] {
  const pieces: SpeechSegment[] = [];
  let current = { ...segment };

  while (current.end - current.start > maxChunk) {
    const window = Math.round(audio.sampleRateHz / 10);
    const searchFrom = current.start + Math.floor(maxChunk * 0.6);
    const searchTo = current.start + maxChunk - window;
    let cut = searchTo;
    let quietest = Number.POSITIVE_INFINITY;

    for (let position = searchFrom; position <= searchTo; position += Math.floor(window / 2)) {
      let energy = 0;
      for (let index = position; index < position + window; index += 1) {
        energy += audio.samples[index] * audio.samples[index];
      }
      if (energy < quietest) {
        quietest = energy;
        cut = position + Math.floor(window / 2);
      }
    }

    pieces.push({ start: current.start, end: cut, speechStart: Math.max(current.speechStart, current.start), speechEnd: Math.min(current.speechEnd, cut) });
    current = { start: cut, end: current.end, speechStart: Math.max(current.speechStart, cut), speechEnd: current.speechEnd };
  }

  pieces.push(current);
  return pieces;
}
