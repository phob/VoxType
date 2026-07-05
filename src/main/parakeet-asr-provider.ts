import { app } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { type SherpaRuntimeBackend } from "../shared/sherpa-runtimes";
import { type ResolvedParakeetBundle } from "./sherpa-model-service";

const execFileAsync = promisify(execFile);

export interface ParakeetHotwords {
  filePath: string;
  score: number;
  bpeVocabPath: string;
}

export interface ParakeetTranscribeInput {
  audioBytes: Uint8Array;
  executablePath: string;
  bundle: ResolvedParakeetBundle;
  backend: SherpaRuntimeBackend;
  hotwords?: ParakeetHotwords | null;
}

// Drives `sherpa-onnx-offline.exe` — structurally identical to the whisper.cpp
// CLI invocation in transcription-service.ts. Greedy decoding by default; the
// hotword flags are only added when decode-time biasing is explicitly enabled.
export class ParakeetAsrProvider {
  async transcribe(input: ParakeetTranscribeInput): Promise<{ text: string }> {
    const workDirectory = join(app.getPath("temp"), "voxtype");
    const id = randomUUID();
    const audioPath = join(workDirectory, `${id}.wav`);

    await mkdir(workDirectory, { recursive: true });
    await writeFile(audioPath, input.audioBytes);

    const args = buildParakeetArgs({
      bundle: input.bundle,
      backend: input.backend,
      hotwords: input.hotwords ?? null,
      audioPath
    });

    try {
      const { stdout, stderr } = await execFileAsync(input.executablePath, args);
      const text = parseSherpaTranscript(stdout, stderr, audioPath);

      return { text };
    } catch (error) {
      throw new Error(formatParakeetError(error, input.executablePath), { cause: error });
    } finally {
      await rm(audioPath, { force: true });
    }
  }
}

export function buildParakeetArgs(options: {
  bundle: ResolvedParakeetBundle;
  backend: SherpaRuntimeBackend;
  hotwords: ParakeetHotwords | null;
  audioPath: string;
}): string[] {
  const args = [
    `--encoder=${options.bundle.encoder}`,
    `--decoder=${options.bundle.decoder}`,
    `--joiner=${options.bundle.joiner}`,
    `--tokens=${options.bundle.tokens}`,
    "--model-type=nemo_transducer"
  ];

  // CUDA is opt-in. On CPU the default provider is used, so we pass nothing.
  if (options.backend === "cuda") {
    args.push("--provider=cuda", "--num-threads=1");
  }

  // Decode-time hotword biasing is experimental and needs bpe.vocab; only added
  // when a resolved hotwords descriptor is supplied.
  if (options.hotwords) {
    args.push(
      "--decoding-method=modified_beam_search",
      `--hotwords-file=${options.hotwords.filePath}`,
      `--hotwords-score=${String(options.hotwords.score)}`,
      "--modeling-unit=bpe",
      `--bpe-vocab=${options.hotwords.bpeVocabPath}`
    );
  }

  args.push(options.audioPath);

  return args;
}

// sherpa-onnx-offline prints the input path followed by the recognition result
// (JSON on recent builds, plain text on older ones) terminated by a "----"
// separator. Handle both shapes; verify the exact format during Step 0.4 and
// tighten if needed.
export function parseSherpaTranscript(
  stdout: string,
  stderr: string,
  audioPath: string
): string {
  for (const source of [stdout, stderr]) {
    const fromJson = extractJsonText(source);

    if (fromJson !== null) {
      return normalize(fromJson);
    }
  }

  for (const source of [stdout, stderr]) {
    const fromBlock = extractResultBlock(source, audioPath);

    if (fromBlock !== null) {
      return normalize(fromBlock);
    }
  }

  return "";
}

function extractJsonText(source: string): string | null {
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line.startsWith("{") || !line.includes("\"text\"")) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(line);

      if (typeof parsed === "object" && parsed !== null && "text" in parsed) {
        const value = parsed.text;

        if (typeof value === "string") {
          return value;
        }
      }
    } catch {
      // Not a JSON result line; keep scanning.
    }
  }

  return null;
}

function extractResultBlock(source: string, audioPath: string): string | null {
  const lines = source.split(/\r?\n/);
  const baseName = audioPath.split(/[\\/]/).pop() ?? audioPath;
  const startIndex = lines.findIndex(
    (line) => line.trim() === audioPath.trim() || line.trim().endsWith(baseName)
  );

  if (startIndex === -1) {
    return null;
  }

  const collected: string[] = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (/^-{3,}$/.test(line)) {
      break;
    }

    if (line) {
      collected.push(line);
    }
  }

  return collected.length > 0 ? collected.join(" ") : null;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatParakeetError(error: unknown, executable: string): string {
  const stderr =
    typeof (error as { stderr?: unknown } | null)?.stderr === "string"
      ? (error as { stderr: string }).stderr
      : "";

  // The sherpa-onnx CUDA build ships onnxruntime_providers_cuda.dll but NOT
  // NVIDIA's CUDA/cuDNN runtime DLLs, so on a machine without the CUDA 12.x
  // Toolkit + cuDNN 9.x on PATH it fails to load a dependency (Error 126).
  const missingDll =
    /depends on "([^"]+\.dll)" which is missing/i.exec(stderr)?.[1] ??
    (/error 126|providers_cuda\.dll/i.test(stderr) ? "a CUDA/cuDNN runtime library" : null);

  if (missingDll) {
    return [
      `Parakeet could not start on the CUDA backend: ${missingDll} is missing.`,
      "The sherpa-onnx CUDA runtime does not bundle NVIDIA's CUDA/cuDNN libraries.",
      "Install the NVIDIA CUDA Toolkit 12.x and cuDNN 9.x and put their bin folders on PATH,",
      "or switch the Parakeet backend to CPU in VoxType settings."
    ].join(" ");
  }

  const detail = error instanceof Error ? error.message : String(error);

  return [
    `Could not run Parakeet engine "${executable}".`,
    "If you selected the CUDA backend, ensure an NVIDIA GPU with CUDA 12.x + cuDNN 9.x runtime libraries is available, or switch the Parakeet backend to CPU.",
    detail
  ].join(" ");
}
