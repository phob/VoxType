import {
  type PromptPack,
  type StreamingAsrProvider,
  type StreamingAsrRequest,
  type TranscriptTurn
} from "../shared/asr";
import { classifyOpenAiError, formatOpenAiFriendlyError } from "../shared/openai-errors";
import { OPENAI_REALTIME_WHISPER_MODEL_ID } from "../shared/openai-models";
import { getProviderLanguageHint } from "../shared/provider-language";
import { getOpenAiRealtimeTranscriptionDelay } from "../shared/realtime-latency";
import { TranscriptTurnAccumulator } from "../shared/transcript-turns";
import { OpenAiCredentialStore } from "./openai-credential-store";

const OPENAI_REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_WHISPER_MODEL_ID}`;

export type RealtimePreviewCallback = (turns: TranscriptTurn[]) => void;
export type RealtimeErrorCallback = (error: Error) => void;

export class OpenAiRealtimeAsrProvider implements StreamingAsrProvider {
  readonly providerId = "openai" as const;
  private socket: WebSocket | null = null;
  private readonly turns = new TranscriptTurnAccumulator();
  private finalTranscriptWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private lastError: Error | null = null;

  constructor(
    private readonly credentials: OpenAiCredentialStore,
    private readonly onPreview?: RealtimePreviewCallback,
    private readonly onError?: RealtimeErrorCallback
  ) {}

  async startStreaming(request: StreamingAsrRequest): Promise<void> {
    const apiKey = await this.credentials.getApiKey();

    if (!apiKey) {
      throw new Error("OpenAI API key is required before Realtime Cloud Dictation can start.");
    }

    if (request.mode.modelId !== OPENAI_REALTIME_WHISPER_MODEL_ID) {
      throw new Error(`Unsupported realtime OpenAI model: ${request.mode.modelId}.`);
    }

    if (request.audioConfig.sampleRateHz !== 24000 || request.audioConfig.encoding !== "pcm16") {
      throw new Error("OpenAI realtime requires 24 kHz PCM16 mono audio.");
    }

    await this.openSession(
      apiKey,
      request.promptPack,
      request.language,
      request.latencyPreset
    );
  }

  appendPcm16Audio(pcm16Audio: Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("OpenAI realtime session is not connected.");
    }

    this.socket.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: encodeBase64(pcm16Audio)
    }));
  }

  async commitAudioAndWaitForFinalTranscript(timeoutMs = 10000): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const initialFinalTurnCount = this.finalTurnCount();
    this.throwIfRealtimeFailed();
    this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

    if (this.finalTurnCount() > initialFinalTurnCount) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, timeoutMs);
      const waiter = {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        }
      };
      this.finalTranscriptWaiters.push(waiter);
    });

    this.throwIfRealtimeFailed();

    if (this.finalTurnCount() === initialFinalTurnCount) {
      this.markProvisionalTurnsAsFallback();
    }
  }

  commitAudio(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
  }

  private async openSession(
    apiKey: string,
    promptPack: PromptPack | null,
    language: StreamingAsrRequest["language"],
    latencyPreset: StreamingAsrRequest["latencyPreset"]
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(OPENAI_REALTIME_URL, [
        "realtime",
        `openai-insecure-api-key.${apiKey}`,
        "openai-beta.realtime-v1"
      ]);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("OpenAI realtime session did not connect before the pre-connection buffer expired."));
      }, 5000);

      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        this.socket = socket;
        socket.send(JSON.stringify(buildSessionUpdate(
          promptPack,
          language,
          latencyPreset
        )));
        resolve();
      }, { once: true });

      socket.addEventListener("message", (event) => this.handleMessage(event));
      socket.addEventListener("close", () => {
        if (this.finalTranscriptWaiters.length > 0) {
          this.failRealtime(new Error("OpenAI realtime session closed before final transcript completed."));
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        const error = new Error("OpenAI realtime session failed to connect.");
        if (this.socket === socket) {
          this.failRealtime(error);
        } else {
          reject(error);
        }
      }, { once: true });
    });
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") {
      return;
    }

    try {
      const payload = JSON.parse(event.data) as {
        type?: string;
        item_id?: string;
        transcript?: string;
        delta?: string;
        error?: {
          code?: unknown;
          type?: unknown;
          message?: unknown;
        };
      };

      if (payload.type === "error" || payload.type === "conversation.item.input_audio_transcription.failed") {
        this.failRealtime(new Error(formatRealtimeOpenAiError(payload.error)));
        return;
      }
      const providerItemId = payload.item_id ?? "current";
      const final = payload.type === "conversation.item.input_audio_transcription.completed" ||
        (payload.type?.includes("completed") ?? false);
      const text = payload.transcript ?? payload.delta ?? "";

      if (!text) {
        return;
      }

      this.onPreview?.(this.turns.apply({ providerItemId, text, final }));

      if (final) {
        this.resolveFinalTranscriptWaiters();
      }
    } catch {
      // Ignore malformed provider events; do not log transcripts or raw provider responses.
    }
  }

  private finalTurnCount(): number {
    return this.turns.list().filter((turn) => turn.status === "final" && turn.finalText?.trim()).length;
  }

  private markProvisionalTurnsAsFallback(): void {
    let turns = this.turns.list();

    for (const turn of turns) {
      if (turn.status === "provisional" && turn.provisionalText?.trim()) {
        turns = this.turns.markFallback(turn.providerItemId);
      }
    }

    this.onPreview?.(turns);
  }

  private throwIfRealtimeFailed(): void {
    if (this.lastError) {
      throw this.lastError;
    }
  }

  private failRealtime(error: Error): void {
    this.lastError = error;
    this.onError?.(error);
    const waiters = this.finalTranscriptWaiters;
    this.finalTranscriptWaiters = [];
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  private resolveFinalTranscriptWaiters(): void {
    const waiters = this.finalTranscriptWaiters;
    this.finalTranscriptWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }
}

function formatRealtimeOpenAiError(error: {
  code?: unknown;
  type?: unknown;
  message?: unknown;
} | undefined): string {
  return formatOpenAiFriendlyError(classifyOpenAiError({
    code: typeof error?.code === "string" ? error.code : null,
    type: typeof error?.type === "string" ? error.type : null,
    message: typeof error?.message === "string" ? error.message : null
  }));
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function buildSessionUpdate(
  promptPack: PromptPack | null,
  language: StreamingAsrRequest["language"],
  latencyPreset: StreamingAsrRequest["latencyPreset"]
): unknown {
  const languageHint = getProviderLanguageHint("openai", language);

  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: {
            type: "audio/pcm",
            rate: 24000
          },
          transcription: {
            model: OPENAI_REALTIME_WHISPER_MODEL_ID,
            language: languageHint.parameterValue ?? undefined,
            delay: getOpenAiRealtimeTranscriptionDelay(latencyPreset),
            prompt: promptPack?.text
              ? `Transcribe speech. Prefer these context terms when acoustically plausible: ${promptPack.text}`
              : undefined
          },
          turn_detection: null
        }
      }
    }
  };
}
