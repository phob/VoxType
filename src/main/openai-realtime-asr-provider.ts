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

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const OPENAI_REALTIME_MAX_APPEND_BYTES = 15 * 1024 * 1024;
const OPENAI_REALTIME_MIN_COMMIT_BYTES = Math.ceil(24000 * 2 * 0.1);

interface NodeWebSocketInit {
  headers: Record<string, string>;
}

type NodeWebSocketConstructor = new (url: string, init: NodeWebSocketInit) => WebSocket;

export type RealtimePreviewCallback = (turns: TranscriptTurn[]) => void;
export type RealtimeErrorCallback = (error: Error) => void;

export class OpenAiRealtimeAsrProvider implements StreamingAsrProvider {
  readonly providerId = "openai" as const;
  private socket: WebSocket | null = null;
  private readonly turns = new TranscriptTurnAccumulator();
  private finalTranscriptWaiters: {
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  private sessionReadyWaiters: {
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  private lastError: Error | null = null;
  private sessionCreatedSeen = false;
  private appendedAudioBytes = 0;
  private latestCommitSentAtMs: number | null = null;

  constructor(
    private readonly credentials: OpenAiCredentialStore,
    private readonly onPreview?: RealtimePreviewCallback,
    private readonly onError?: RealtimeErrorCallback
  ) {}

  async startStreaming(request: StreamingAsrRequest): Promise<void> {
    const apiKey = (await this.credentials.getApiKey())?.trim() ?? null;

    if (!apiKey) {
      throw new Error("OpenAI API key is required before Realtime Cloud Dictation can start.");
    }

    if (request.mode.modelId !== OPENAI_REALTIME_WHISPER_MODEL_ID) {
      throw new Error(`Unsupported realtime OpenAI model: ${request.mode.modelId}.`);
    }

    await this.openSession(
      apiKey,
      request.language,
      request.latencyPreset
    );
  }

  appendPcm16Audio(pcm16Audio: Uint8Array): void {
    this.throwIfRealtimeFailed();

    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("OpenAI realtime session is not connected.");
    }

    if (pcm16Audio.byteLength === 0 || pcm16Audio.byteLength % 2 !== 0) {
      throw new Error("OpenAI realtime PCM16 audio chunks must be non-empty whole 16-bit samples.");
    }

    if (pcm16Audio.byteLength > OPENAI_REALTIME_MAX_APPEND_BYTES) {
      throw new Error("OpenAI realtime PCM16 audio chunks must be 15 MB or smaller.");
    }

    this.socket.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: encodeBase64(pcm16Audio)
    }));
    this.appendedAudioBytes += pcm16Audio.byteLength;
  }

  async commitAudioAndWaitForFinalTranscript(timeoutMs = 10000): Promise<void> {
    this.throwIfRealtimeFailed();

    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this.appendedAudioBytes < OPENAI_REALTIME_MIN_COMMIT_BYTES) {
      throw new Error(`Realtime Cloud Dictation did not receive enough microphone audio to finalize. Try holding the hotkey a little longer and check the selected input device. Provider appended ${String(this.appendedAudioBytes)} PCM bytes.`);
    }

    const initialFinalTurnCount = this.finalTurnCount();
    this.latestCommitSentAtMs = Date.now();
    this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    logRealtimeTiming("commit sent", {
      appendedAudioBytes: this.appendedAudioBytes,
      initialFinalTurnCount,
      timeoutMs
    });

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
        logRealtimeTiming("final transcript wait timed out", {
          elapsedSinceCommitMs: elapsedSince(this.latestCommitSentAtMs),
          timeoutMs
        });
        resolve();
      }, timeoutMs);
      const waiter = {
        resolve: () => {
          settle(waiter);
          logRealtimeTiming("final transcript wait resolved", {
            elapsedSinceCommitMs: elapsedSince(this.latestCommitSentAtMs),
            finalTurnCount: this.finalTurnCount()
          });
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
      logRealtimeTiming("provisional fallback used", {
        elapsedSinceCommitMs: elapsedSince(this.latestCommitSentAtMs),
        initialFinalTurnCount,
        finalTurnCount: this.finalTurnCount()
      });
    }
  }

  getAppendedAudioBytes(): number {
    return this.appendedAudioBytes;
  }

  stop(reason = "OpenAI realtime session stopped.", options: { preserveLastError?: boolean } = {}): void {
    if (this.sessionReadyWaiters.length > 0 || this.finalTranscriptWaiters.length > 0) {
      this.failRealtime(new Error(reason));
    }

    this.socket?.close();
    this.socket = null;

    if (!options.preserveLastError) {
      this.lastError = null;
    }
  }

  private async openSession(
    apiKey: string,
    language: StreamingAsrRequest["language"],
    latencyPreset: StreamingAsrRequest["latencyPreset"]
  ): Promise<void> {
    this.lastError = null;
    this.sessionCreatedSeen = false;

    await new Promise<void>((resolve, reject) => {
      const NodeWebSocket = WebSocket as unknown as NodeWebSocketConstructor;
      const socket = new NodeWebSocket(OPENAI_REALTIME_URL, {
        headers: {
          Authorization: buildOpenAiRealtimeAuthorizationHeader(apiKey)
        }
      });
      const timeout = setTimeout(() => {
        socket.close();
        const error = this.socket === socket
          ? new Error(this.sessionCreatedSeen
            ? "OpenAI realtime session.update was not acknowledged before the pre-connection buffer expired."
            : "OpenAI realtime session configuration did not complete before the pre-connection buffer expired.")
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

      socket.addEventListener("message", (event) => { this.handleMessage(event); });
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
        item?: {
          id?: unknown;
          content?: unknown;
        };
        content_index?: number;
        contentIndex?: number;
        transcript?: string;
        delta?: string;
        text?: string;
        error?: {
          code?: unknown;
          type?: unknown;
          message?: unknown;
        };
      };

      if (this.latestCommitSentAtMs !== null && payload.type) {
        const nestedTranscriptText = extractRealtimeItemTranscriptText(payload.item);
        logRealtimeTiming("provider event after commit", {
          providerEventType: payload.type,
          elapsedSinceCommitMs: elapsedSince(this.latestCommitSentAtMs),
          hasTranscript: typeof payload.transcript === "string" && payload.transcript.length > 0,
          hasDelta: typeof payload.delta === "string" && payload.delta.length > 0,
          hasText: typeof payload.text === "string" && payload.text.length > 0,
          nestedTranscriptLength: nestedTranscriptText?.length ?? 0
        });
      }

      if (payload.type === "error" || isRealtimeTranscriptionFailedEvent(payload.type)) {
        this.failRealtime(new Error(formatRealtimeOpenAiError(payload.error)));
        return;
      }

      if (isRealtimeTranscriptionSessionCreatedEvent(payload.type)) {
        this.sessionCreatedSeen = true;
        return;
      }

      if (isRealtimeTranscriptionSessionUpdatedEvent(payload.type)) {
        this.resolveSessionReadyWaiters();
        return;
      }

      if (isRealtimeInputAudioBufferCommittedEvent(payload.type)) {
        logRealtimeTiming("input audio buffer committed", {
          elapsedSinceCommitMs: elapsedSince(this.latestCommitSentAtMs)
        });
        return;
      }

      const providerItemId = getRealtimeTranscriptKey(
        payload.item_id ?? (typeof payload.item?.id === "string" ? payload.item.id : undefined),
        payload.content_index ?? payload.contentIndex
      );
      const final = isRealtimeTranscriptionCompletedEvent(payload.type);
      const text = payload.transcript ?? payload.delta ?? payload.text ??
        extractRealtimeItemTranscriptText(payload.item) ?? "";

      if (final) {
        logRealtimeTiming("final transcript received", {
          elapsedSinceCommitMs: elapsedSince(this.latestCommitSentAtMs),
          finalTurnCountBeforeApply: this.finalTurnCount(),
          textLength: text.length
        });
      }

      if (!text) {
        return;
      }

      this.onPreview?.(this.turns.apply({
        providerItemId,
        text,
        final,
        append: isRealtimeTranscriptionDeltaEvent(payload.type)
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

function isRealtimeTranscriptionDeltaEvent(type: string | undefined): boolean {
  return type === "conversation.item.input_audio_transcription.delta" ||
    type === "transcription_session.input_audio_transcription.delta";
}

function isRealtimeTranscriptionCompletedEvent(type: string | undefined): boolean {
  return type === "conversation.item.input_audio_transcription.completed" ||
    type === "transcription_session.input_audio_transcription.completed" ||
    (type?.includes("input_audio_transcription") === true &&
      (type.includes("completed") || type.endsWith(".done")));
}

function isRealtimeInputAudioBufferCommittedEvent(type: string | undefined): boolean {
  return type === "input_audio_buffer.committed";
}

function isRealtimeTranscriptionFailedEvent(type: string | undefined): boolean {
  return type === "conversation.item.input_audio_transcription.failed" ||
    type === "transcription_session.input_audio_transcription.failed" ||
    (type?.includes("input_audio_transcription") === true &&
      (type.includes("failed") || type.includes("error")));
}

function isRealtimeTranscriptionSessionCreatedEvent(type: string | undefined): boolean {
  return type === "transcription_session.created" || type === "session.created";
}

function isRealtimeTranscriptionSessionUpdatedEvent(type: string | undefined): boolean {
  return type === "transcription_session.updated" || type === "session.updated";
}

function buildOpenAiRealtimeAuthorizationHeader(apiKey: string): string {
  return `Bearer ${apiKey.trim()}`;
}

function logRealtimeTiming(event: string, details: Record<string, unknown> = {}): void {
  console.info("[voxtype] realtime timing", {
    event,
    at: new Date().toISOString(),
    monotonicMs: Math.round(performance.now()),
    ...details
  });
}

function elapsedSince(startedAtMs: number | null): number | null {
  return startedAtMs === null ? null : Date.now() - startedAtMs;
}

function extractRealtimeItemTranscriptText(item: { content?: unknown } | undefined): string | null {
  if (!Array.isArray(item?.content)) {
    return null;
  }

  const text = item.content
    .map((contentPart) => {
      if (!contentPart || typeof contentPart !== "object") {
        return "";
      }

      const candidate = contentPart as {
        transcript?: unknown;
        text?: unknown;
      };

      if (typeof candidate.transcript === "string" && candidate.transcript.trim()) {
        return candidate.transcript;
      }

      if (typeof candidate.text === "string" && candidate.text.trim()) {
        return candidate.text;
      }

      return "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();

  return text || null;
}

function getRealtimeTranscriptKey(itemId: string | undefined, contentIndex: number | undefined): string {
  const safeItemId = itemId?.trim() ?? "current";
  return typeof contentIndex === "number" && Number.isFinite(contentIndex)
    ? `${safeItemId}:${String(contentIndex)}`
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
          }
        }
      }
    }
  };
}
