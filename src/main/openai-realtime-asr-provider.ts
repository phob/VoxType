import {
  type PromptPack,
  type StreamingAsrProvider,
  type StreamingAsrRequest,
  type TranscriptTurn
} from "../shared/asr";
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

    await this.openSession(apiKey, request.promptPack);
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
  }

  private async openSession(apiKey: string, promptPack: PromptPack | null): Promise<void> {
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
        socket.send(JSON.stringify(buildSessionUpdate(promptPack)));
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
      };
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

function buildSessionUpdate(promptPack: PromptPack | null): unknown {
  return {
    type: "session.update",
    session: {
      input_audio_format: "pcm16",
      turn_detection: { type: "server_vad" },
      instructions: promptPack?.text
        ? `Transcribe speech. Prefer these context terms when acoustically plausible: ${promptPack.text}`
        : "Transcribe speech accurately."
    }
  };
}
