import {
  type PromptPack,
  type StreamingAsrProvider,
  type StreamingAsrRequest,
  type TranscriptTurn
} from "../shared/asr";
import { classifyOpenAiError, formatOpenAiFriendlyError } from "../shared/openai-errors";
import { getProviderLanguageHint } from "../shared/provider-language";
import { getOpenAiRealtimeVadConfig } from "../shared/realtime-latency";
import { TranscriptTurnAccumulator } from "../shared/transcript-turns";
import { OpenAiCredentialStore } from "./openai-credential-store";

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime-whisper";

export type RealtimePreviewCallback = (turns: TranscriptTurn[]) => void;

export class OpenAiRealtimeAsrProvider implements StreamingAsrProvider {
  readonly providerId = "openai" as const;
  private socket: WebSocket | null = null;
  private readonly turns = new TranscriptTurnAccumulator();

  constructor(
    private readonly credentials: OpenAiCredentialStore,
    private readonly onPreview?: RealtimePreviewCallback
  ) {}

  async startStreaming(request: StreamingAsrRequest): Promise<void> {
    const apiKey = await this.credentials.getApiKey();

    if (!apiKey) {
      throw new Error("OpenAI API key is required before Realtime Cloud Dictation can start.");
    }

    if (request.mode.modelId !== "gpt-realtime-whisper") {
      throw new Error(`Unsupported realtime OpenAI model: ${request.mode.modelId}.`);
    }

    if (request.audioConfig.sampleRateHz !== 24000 || request.audioConfig.encoding !== "pcm16") {
      throw new Error("OpenAI realtime requires 24 kHz PCM16 mono audio.");
    }

    await this.openSession(
      apiKey,
      request.promptPack,
      request.language,
      request.latencyPreset,
      request.developerVadThresholdOverride
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
    latencyPreset: StreamingAsrRequest["latencyPreset"],
    developerVadThresholdOverride: StreamingAsrRequest["developerVadThresholdOverride"]
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
          latencyPreset,
          developerVadThresholdOverride
        )));
        resolve();
      }, { once: true });

      socket.addEventListener("message", (event) => this.handleMessage(event));
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("OpenAI realtime session failed to connect."));
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

      if (payload.type === "error") {
        throw new Error(formatRealtimeOpenAiError(payload.error));
      }
      const providerItemId = payload.item_id ?? "current";
      const final = payload.type?.includes("completed") ?? false;
      const text = payload.transcript ?? payload.delta ?? "";

      if (!text) {
        return;
      }

      this.onPreview?.(this.turns.apply({ providerItemId, text, final }));
    } catch {
      // Ignore malformed provider events; do not log transcripts or raw provider responses.
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
  latencyPreset: StreamingAsrRequest["latencyPreset"],
  developerVadThresholdOverride: StreamingAsrRequest["developerVadThresholdOverride"]
): unknown {
  const languageHint = getProviderLanguageHint("openai", language);

  return {
    type: "session.update",
    session: {
      input_audio_format: "pcm16",
      input_audio_transcription: {
        model: "gpt-realtime-whisper",
        language: languageHint.parameterValue ?? undefined
      },
      turn_detection: getOpenAiRealtimeVadConfig(latencyPreset, developerVadThresholdOverride),
      instructions: promptPack?.text
        ? `Transcribe speech. Prefer these context terms when acoustically plausible: ${promptPack.text}`
        : "Transcribe speech accurately."
    }
  };
}
