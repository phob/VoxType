// The app's local dictation path, shared by the E2E harnesses: native helper (resample + per-frame VAD)
// -> speech segments -> chunks -> whisper-cli -> output filter, or -> pause-shortened WAV -> Parakeet.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ParakeetAsrProvider } from "../../src/main/parakeet-asr-provider";
import { composeSpeechWav, decodeMonoPcm, defaultSpeechChunking, planSpeechChunks, type SpeechChunkingOptions } from "../../src/main/speech-audio";
import { transcribeChunksWithWhisperCli } from "../../src/main/whisper-cli-transcriber";
import { WhisperServer } from "../../src/main/whisper-server";
import { buildWhisperPromptContext } from "../../src/shared/prompt-context";
import { defaultSpeechSegmentation, detectSpeechSegments, type SpeechSegmentationOptions } from "../../src/shared/speech-segments";

export interface PipelineResult {
  speechDetected: boolean;
  text: string;
  audioSentMs: number;
  whisperCalls: number;
  chunks: number;
  whisperMs: number;
  totalMs: number;
  notes: string[];
}

export type AsrEngine = "whisper" | "parakeet";

export interface PipelineContext {
  engine: AsrEngine;
  /** whisper-cli.exe, or sherpa-onnx-offline.exe for Parakeet. */
  whisperCli: string;
  /** ggml model file, or the Parakeet bundle directory. */
  whisperModel: string;
  vadModel: string;
  workDir: string;
  /** Warm whisper-server next to whisper-cli, as the app uses; null runs whisper-cli per call. */
  whisperServer: { server: WhisperServer; executable: string } | null;
}

export interface PipelineInput {
  id: string;
  path: string;
  promptTerms?: string[];
  /** Whisper language code; "auto" detects. */
  language?: string;
  segmentation?: SpeechSegmentationOptions;
  chunking?: SpeechChunkingOptions;
}

export const e2eOutDir = resolve("native/windows-helper/target/e2e");

export function createPipelineContext(workDir: string, engine: AsrEngine = "whisper"): PipelineContext {
  if (engine === "parakeet") {
    return {
      engine,
      whisperCli: resolveSherpaOffline(),
      whisperModel: process.env.VOXTYPE_PARAKEET_BUNDLE ?? join(appDataDir(), "models", "sherpa", "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"),
      vadModel: resolve("resources/models/silero_vad_v4.onnx"),
      workDir,
      whisperServer: null
    };
  }

  const whisperCli = resolveWhisperCli();
  const serverExecutable = join(dirname(whisperCli), "whisper-server.exe");
  const useServer = !process.argv.includes("--whisper-cli") && existsSync(serverExecutable);

  return {
    engine,
    whisperServer: useServer ? { server: new WhisperServer(), executable: serverExecutable } : null,
    whisperCli,
    whisperModel: process.env.VOXTYPE_WHISPER_MODEL ?? join(appDataDir(), "models", "ggml-large-v3-turbo.bin"),
    vadModel: resolve("resources/models/silero_vad_v4.onnx"),
    workDir
  };
}

export async function currentPipeline(input: PipelineInput, ctx: PipelineContext): Promise<PipelineResult> {
  const startedAt = performance.now();
  const helperOut = join(ctx.workDir, `${input.id}.current.wav`);
  const metadata = runHelper(resolve("native/windows-helper/target/release/voxtype-windows-helper.exe"), [
    "process-wav", input.path, helperOut, "--vad-model", ctx.vadModel
  ]);
  const audio = decodeMonoPcm(new Uint8Array(readFileSync(helperOut)));
  const segments = detectSpeechSegments(
    {
      sampleRateHz: audio.sampleRateHz,
      frameSamples: Number(metadata.vadFrameSamples),
      probabilities: new Uint8Array(Buffer.from(String(metadata.vadProbabilities), "base64"))
    },
    audio.samples.length,
    input.segmentation ?? defaultSpeechSegmentation
  );

  if (segments.length === 0) {
    return { speechDetected: false, text: "", audioSentMs: 0, whisperCalls: 0, chunks: 0, whisperMs: 0, totalMs: performance.now() - startedAt, notes: [] };
  }

  if (ctx.engine === "parakeet") {
    return parakeetPipeline(input, ctx, audio, segments, startedAt);
  }

  const chunks = planSpeechChunks(audio, segments, input.chunking ?? defaultSpeechChunking);
  const whisperStartedAt = performance.now();
  const prompt = input.promptTerms ? buildWhisperPromptContext(input.promptTerms, []) : null;
  const language = input.language ?? "auto";
  const result = ctx.whisperServer
    ? await ctx.whisperServer.server.transcribeChunks({ executable: ctx.whisperServer.executable, modelPath: ctx.whisperModel }, { chunks, prompt, language })
    : await transcribeChunksWithWhisperCli({
        executable: ctx.whisperCli,
        modelPath: ctx.whisperModel,
        chunks,
        prompt,
        language,
        workDirectory: ctx.workDir,
        id: input.id
      });

  return {
    speechDetected: true,
    text: result.text,
    audioSentMs: chunks.reduce((sum, chunk) => sum + (chunk.samples.length / chunk.sampleRateHz) * 1000, 0),
    whisperCalls: 1,
    chunks: chunks.length,
    whisperMs: performance.now() - whisperStartedAt,
    totalMs: performance.now() - startedAt,
    notes: [
      `segments ${String(segments.length)}`,
      ...result.removed.map((item) => `filtered ${item.reason}: "${item.text}"`),
      ...(result.rawText !== result.text ? [`raw: ${result.rawText}`] : [])
    ]
  };
}

// Same as the app's Parakeet path: one pause-shortened WAV, greedy decoding, no hotwords (off by default).
async function parakeetPipeline(
  input: PipelineInput,
  ctx: PipelineContext,
  audio: ReturnType<typeof decodeMonoPcm>,
  segments: ReturnType<typeof detectSpeechSegments>,
  startedAt: number
): Promise<PipelineResult> {
  const wavBytes = composeSpeechWav(audio, segments, input.chunking ?? defaultSpeechChunking);
  if (!wavBytes) {
    return { speechDetected: false, text: "", audioSentMs: 0, whisperCalls: 0, chunks: 0, whisperMs: 0, totalMs: performance.now() - startedAt, notes: [] };
  }

  const decodeStartedAt = performance.now();
  const result = await new ParakeetAsrProvider().transcribe({
    audioBytes: wavBytes,
    executablePath: ctx.whisperCli,
    bundle: {
      encoder: join(ctx.whisperModel, "encoder.int8.onnx"),
      decoder: join(ctx.whisperModel, "decoder.int8.onnx"),
      joiner: join(ctx.whisperModel, "joiner.int8.onnx"),
      tokens: join(ctx.whisperModel, "tokens.txt"),
      bpeVocab: null
    },
    backend: "cpu",
    hotwords: null,
    workDirectory: ctx.workDir
  });

  return {
    speechDetected: true,
    text: result.text,
    audioSentMs: ((wavBytes.length - 44) / 2 / 16_000) * 1000,
    whisperCalls: 1,
    chunks: 1,
    whisperMs: performance.now() - decodeStartedAt,
    totalMs: performance.now() - startedAt,
    notes: [`segments ${String(segments.length)}`]
  };
}

function resolveSherpaOffline(): string {
  if (process.env.VOXTYPE_SHERPA_OFFLINE) {
    return process.env.VOXTYPE_SHERPA_OFFLINE;
  }
  const found = findFiles(join(appDataDir(), "runtimes", "sherpa-onnx"), "sherpa-onnx-offline.exe").find((path) => path.includes("cpu"));
  if (!found) {
    throw new Error("No CPU sherpa-onnx-offline.exe found; set VOXTYPE_SHERPA_OFFLINE.");
  }
  return found;
}

function runHelper(helper: string, args: string[]): { samples: number; rawSamples: number; speechFrames: number } & Record<string, unknown> {
  const result = spawnSync(helper, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  if (result.status !== 0) {
    throw new Error(`helper ${args[0]} failed: ${line} ${result.stderr}`);
  }
  return JSON.parse(line);
}

// ---------- scoring helpers ----------

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-–—/]/g, " ")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function wordErrorRate(reference: string[], hypothesis: string[]): number {
  const previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (reference[row - 1] === hypothesis[column - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return reference.length > 0 ? previous[hypothesis.length] / reference.length : hypothesis.length;
}

// ---------- environment ----------

export function appDataDir(): string {
  return join(process.env.APPDATA ?? "", "voxtype");
}

export function findFiles(root: string, fileName: string, maxDepth = 6): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || !existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path, depth + 1);
      } else if (entry.toLowerCase() === fileName.toLowerCase()) {
        found.push(path);
      }
    }
  };
  walk(root, 0);
  return found;
}

function resolveWhisperCli(): string {
  if (process.env.VOXTYPE_WHISPER_CLI) {
    return process.env.VOXTYPE_WHISPER_CLI;
  }
  const found = findFiles(join(appDataDir(), "runtimes"), "whisper-cli.exe");
  const preferred = found.find((path) => path.includes("cuda-12")) ?? found[0];
  if (!preferred) {
    throw new Error("No whisper-cli.exe found; set VOXTYPE_WHISPER_CLI.");
  }
  return preferred;
}

export function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

export function argValues(name: string): string[] {
  return process.argv.flatMap((value, index) => (value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []));
}

export function tryGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
