import {
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
  private sessionReadyWaiters: Array<{
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
      const settle = (waiter: {
        resolve: () => void;
        reject: (error: Error) => void;
      }): void => {
        clearTimeout(timeout);
        this.removeFinalTranscriptWaiter(waiter);
      };
      const timeout = setTimeout(() => {
        settle(waiter);
        resolve();
      }, timeoutMs);
      const waiter = {
        resolve: () => {
          settle(waiter);
          resolve();
        },
        reject: (error: Error) => {
          settle(waiter);
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

  stop(reason = "OpenAI realtime session stopped."): void {
    if (this.sessionReadyWaiters.length > 0 || this.finalTranscriptWaiters.length > 0) {
      this.failRealtime(new Error(reason));
    }

    this.socket?.close();
    this.socket = null;
  }

  private async openSession(
    apiKey: string,
    language: StreamingAsrRequest["language"],
    latencyPreset: StreamingAsrRequest["latencyPreset"]
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(OPENAI_REALTIME_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      } as unknown as string | string[]);
      const timeout = setTimeout(() => {
        socket.close();
        const error = this.socket === socket
          ? new Error("OpenAI realtime session configuration did not complete before the pre-connection buffer expired.")
          : new Error("OpenAI realtime session did not connect before the pre-connection buffer expired.");

        if (this.socket === socket) {
          this.failRealtime(error);
        } else {
          clearTimeout(timeout);
          reject(error);
        }
      }, 5000);

      socket.addEventListener("open", () => {
        this.socket = socket;
        const waiter = {
          resolve: () => {
            clearTimeout(timeout);
            this.removeSessionReadyWaiter(waiter);
            resolve();
          },
          reject: (error: Error) => {
            clearTimeout(timeout);
            this.removeSessionReadyWaiter(waiter);
            reject(error);
          }
        };
        this.sessionReadyWaiters.push(waiter);
        socket.send(JSON.stringify(buildSessionUpdate(
          language,
          latencyPreset
        )));
      }, { once: true });

      socket.addEventListener("message", (event) => this.handleMessage(event));
      socket.addEventListener("close", () => {
        if (this.sessionReadyWaiters.length > 0) {
          this.failRealtime(new Error("OpenAI realtime session closed before session configuration completed."));
          return;
        }

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
        content_index?: number;
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

      if (payload.type === "session.updated" || payload.type === "session.created") {
        this.resolveSessionReadyWaiters();
        return;
      }

      const providerItemId = getRealtimeTranscriptKey(payload.item_id, payload.content_index);
      const final = payload.type === "conversation.item.input_audio_transcription.completed" ||
        (payload.type?.includes("completed") ?? false);
      const text = payload.transcript ?? payload.delta ?? "";

      if (!text) {
        return;
      }

      this.onPreview?.(this.turns.apply({
        providerItemId,
        text,
        final,
        append: payload.type === "conversation.item.input_audio_transcription.delta"
      }));

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
    const sessionWaiters = this.sessionReadyWaiters;
    this.sessionReadyWaiters = [];
    for (const waiter of sessionWaiters) {
      waiter.reject(error);
    }

    const waiters = this.finalTranscriptWaiters;
    this.finalTranscriptWaiters = [];
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  private resolveSessionReadyWaiters(): void {
    const waiters = this.sessionReadyWaiters;
    this.sessionReadyWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private removeSessionReadyWaiter(waiter: {
    resolve: () => void;
    reject: (error: Error) => void;
  }): void {
    this.sessionReadyWaiters = this.sessionReadyWaiters.filter((candidate) => candidate !== waiter);
  }

  private removeFinalTranscriptWaiter(waiter: {
    resolve: () => void;
    reject: (error: Error) => void;
  }): void {
    this.finalTranscriptWaiters = this.finalTranscriptWaiters.filter((candidate) => candidate !== waiter);
  }

  private resolveFinalTranscriptWaiters(): void {
    const waiters = this.finalTranscriptWaiters;
    this.finalTranscriptWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }
}

function getRealtimeTranscriptKey(itemId: string | undefined, contentIndex: number | undefined): string {
  const safeItemId = itemId?.trim() || "current";
  return typeof contentIndex === "number" && Number.isFinite(contentIndex)
    ? `${safeItemId}:${contentIndex}`
    : safeItemId;
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
            delay: getOpenAiRealtimeTranscriptionDelay(latencyPreset)
          },
          turn_detection: null
        }
      }
    }
  };
}
