// Runs whisper.cpp's CLI over speech chunks in a single process (the model loads once). Each chunk
// is its own input file, so whisper.cpp resets decoder context between chunks and every chunk is
// decoded with the same initial prompt inside one 30 s window.
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { type SpeechChunk } from "./speech-audio";
import { encodePcm16Wav } from "./wav-pcm";
import { filterWhisperSegments, type FilteredSegment, type WhisperSegment } from "./whisper-output-filter";

const execFileAsync = promisify(execFile);

export interface WhisperChunkTranscription {
  /** Joined Whisper output before filtering. */
  rawText: string;
  /** Joined output after removing non-speech text. */
  text: string;
  removed: FilteredSegment[];
  detectedLanguages: string[];
}

export async function transcribeChunksWithWhisperCli(input: {
  executable: string;
  modelPath: string;
  chunks: SpeechChunk[];
  prompt: string | null;
  language: string;
  workDirectory: string;
  id: string;
}): Promise<WhisperChunkTranscription> {
  await mkdir(input.workDirectory, { recursive: true });
  const bases = input.chunks.map((_, index) => join(input.workDirectory, `${input.id}-${String(index)}`));
  const args = ["-m", input.modelPath, "-np", "-ojf", "-sns", "--language", input.language];

  if (input.prompt) {
    args.push("--prompt", input.prompt);
  }

  try {
    for (const [index, chunk] of input.chunks.entries()) {
      await writeFile(`${bases[index]}.wav`, encodePcm16Wav(chunk.samples, chunk.sampleRateHz, 1));
      args.push("-f", `${bases[index]}.wav`, "-of", bases[index]);
    }

    await execFileAsync(input.executable, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });

    const rawParts: string[] = [];
    const parts: string[] = [];
    const removed: FilteredSegment[] = [];
    const detectedLanguages: string[] = [];

    for (const [index, chunk] of input.chunks.entries()) {
      const output = parseWhisperJson(await readFile(`${bases[index]}.json`, "utf8"));
      const filtered = filterWhisperSegments(output.segments, { speechSpansMs: chunk.speechSpansMs, prompt: input.prompt });
      rawParts.push(output.segments.map((segment) => segment.text.trim()).join(" "));
      parts.push(filtered.text);
      removed.push(...filtered.removed);
      if (output.language) {
        detectedLanguages.push(output.language);
      }
    }

    return {
      rawText: joinText(rawParts),
      text: joinText(parts),
      removed,
      detectedLanguages
    };
  } finally {
    await Promise.all(
      bases.flatMap((base) => [rm(`${base}.wav`, { force: true }), rm(`${base}.json`, { force: true })])
    );
  }
}

function parseWhisperJson(json: string): { language: string | null; segments: WhisperSegment[] } {
  const parsed = JSON.parse(json) as {
    result?: { language?: string };
    transcription?: Array<{
      offsets?: { from?: number; to?: number };
      text?: string;
      tokens?: Array<{ text?: string; p?: number }>;
    }>;
  };

  return {
    language: parsed.result?.language ?? null,
    segments: (parsed.transcription ?? []).map((segment) => ({
      startMs: segment.offsets?.from ?? 0,
      endMs: segment.offsets?.to ?? 0,
      text: segment.text ?? "",
      minTokenProbability: minTextTokenProbability(segment.tokens ?? [])
    }))
  };
}

// Special tokens ([_BEG_], [_TT_123], ...) carry no text and have unrelated probabilities.
function minTextTokenProbability(tokens: Array<{ text?: string; p?: number }>): number | null {
  const probabilities = tokens
    .filter((token) => typeof token.p === "number" && token.text && !token.text.startsWith("[_") && token.text.trim())
    .map((token) => token.p as number);

  return probabilities.length > 0 ? Math.min(...probabilities) : null;
}

function joinText(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
