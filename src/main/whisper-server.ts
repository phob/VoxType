// Keeps whisper.cpp's `whisper-server` (shipped in the same release zip as whisper-cli) warm on
// localhost, so a dictation does not pay the model load (~1 s for large-v3-turbo on CUDA) every time.
// Decoding matches whisper-cli: beam search 5 / best-of 5, non-speech tokens suppressed, one request
// per speech chunk so decoder context never carries across chunks.
// Electron-free so the E2E harnesses drive exactly the same code as the app.
import { type SpeechChunk } from "./speech-audio";
import { encodePcm16Wav } from "./wav-pcm";
import { LocalServerProcess, type LocalServerState } from "./local-server-process";
import { combineChunkOutputs, minTextTokenProbability, type WhisperChunkOutput, type WhisperChunkTranscription } from "./whisper-cli-transcriber";

const dictationStartupWaitMs = 20_000;

export interface WhisperServerConfig {
  executable: string;
  modelPath: string;
}

export class WhisperServer {
  private readonly process: LocalServerProcess;
  private baseUrl: string | null = null;

  constructor(idleStopMs: number | null = null) {
    this.process = new LocalServerProcess(idleStopMs);
  }

  get state(): LocalServerState {
    return this.process.state;
  }

  async ensure(config: WhisperServerConfig): Promise<void> {
    this.baseUrl = await this.process.ensure(JSON.stringify([config.executable, config.modelPath]), () => ({
      name: "whisper-server",
      executable: config.executable,
      args: (port) => [
        "-m", config.modelPath,
        "--host", "127.0.0.1",
        "--port", String(port),
        "-bs", "5",
        "-bo", "5",
        "-sns",
        "-l", "auto"
      ],
      healthPath: "/health"
    }));
  }

  async transcribeChunks(
    config: WhisperServerConfig,
    input: { chunks: SpeechChunk[]; prompt: string | null; language: string }
  ): Promise<WhisperChunkTranscription> {
    // A dictation should not wait on a server that is stuck loading; the caller falls back to whisper-cli.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.ensure(config),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("whisper-server did not become ready in time.")), dictationStartupWaitMs);
      })
    ]).finally(() => clearTimeout(timer));
    const outputs: WhisperChunkOutput[] = [];

    for (const chunk of input.chunks) {
      outputs.push(await this.inference(encodePcm16Wav(chunk.samples, chunk.sampleRateHz, 1), input.language, input.prompt));
    }

    return combineChunkOutputs(input.chunks, outputs, input.prompt);
  }

  stop(): void {
    this.process.stop();
  }

  private async inference(wav: Uint8Array, language: string, prompt: string | null): Promise<WhisperChunkOutput> {
    if (!this.baseUrl) {
      throw new Error("whisper-server is not running.");
    }

    const form = new FormData();
    // Copy into a plain ArrayBuffer-backed view; Blob does not accept a view over a SharedArrayBuffer type.
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "chunk.wav");
    form.append("response_format", "verbose_json");
    form.append("language", language);
    if (prompt) {
      form.append("prompt", prompt);
    }

    const response = await fetch(`${this.baseUrl}/inference`, { method: "POST", body: form });
    if (!response.ok) {
      throw new Error(`whisper-server returned ${String(response.status)}: ${(await response.text()).slice(0, 300)}`);
    }

    return parseVerboseJson(await response.json());
  }
}

function parseVerboseJson(body: unknown): WhisperChunkOutput {
  if (!isRecord(body) || !Array.isArray(body.segments)) {
    throw new Error("whisper-server returned a response without segments.");
  }

  return {
    language: typeof body.language === "string" ? body.language : null,
    segments: arrayOf(body.segments).filter(isRecord).map((segment) => ({
      startMs: Math.round(numberOr(segment.start, 0) * 1000),
      endMs: Math.round(numberOr(segment.end, 0) * 1000),
      text: typeof segment.text === "string" ? segment.text : "",
      minTokenProbability: minTextTokenProbability(
        arrayOf(segment.words)
          .filter(isRecord)
          .map((word) => ({
            text: typeof word.word === "string" ? word.word : undefined,
            p: typeof word.probability === "number" ? word.probability : undefined
          }))
      )
    }))
  };
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
