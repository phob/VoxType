import {
  getDictationMode,
  openAiRealtimeAudioConfig,
  type TranscriptTurn
} from "../shared/asr";
import { type AppSettings } from "../shared/settings";
import { type RecordingOverlayState } from "../shared/windows-helper";
import { OpenAiCredentialStore } from "./openai-credential-store";
import { OpenAiRealtimeAsrProvider } from "./openai-realtime-asr-provider";
import { type PromptPack } from "../shared/asr";

export type RealtimeCloudSessionSnapshot = {
  startedAtMs: number;
  turns: TranscriptTurn[];
};

const openAiRealtimePreConnectionBufferBytes = openAiRealtimeAudioConfig.sampleRateHz * 2 * 5;

export class RealtimeCloudSession {
  private readonly startedAtMs = Date.now();
  private turns: TranscriptTurn[] = [];
  private finalized = false;
  private streamingStarted = false;
  private preConnectionBytes = 0;
  private readonly preConnectionBuffer: Uint8Array[] = [];
  private readonly provider: OpenAiRealtimeAsrProvider;

  constructor(
    credentials: OpenAiCredentialStore,
    private readonly settings: AppSettings,
    private readonly updateOverlay: (state: Partial<RecordingOverlayState>) => void
  ) {
    this.provider = new OpenAiRealtimeAsrProvider(
      credentials,
      (turns) => {
        this.turns = turns;
        this.updateOverlay({
          mode: "recording",
          cloudProviderLabel: "Cloud Dictation",
          livePreviewTurns: turns
        });
      },
      (error) => {
        this.updateOverlay({
          mode: "finalizing",
          cloudProviderLabel: "Cloud Dictation",
          message: error.message
        });
      }
    );
  }

  async start(promptPack: PromptPack | null): Promise<void> {
    await this.provider.startStreaming({
      mode: getDictationMode("openai.realtime"),
      promptPack,
      language: this.settings.whisperLanguage,
      audioConfig: openAiRealtimeAudioConfig,
      latencyPreset: this.settings.realtimeLatencyPreset,
      developerVadThresholdOverride: this.settings.realtimeVadThresholdOverride
    });
    this.streamingStarted = true;
    this.flushPreConnectionBuffer();
  }

  appendPcm16Audio(bytes: Uint8Array): void {
    if (this.finalized) {
      return;
    }

    if (!this.streamingStarted) {
      this.bufferPreConnectionAudio(bytes);
      return;
    }

    this.provider.appendPcm16Audio(bytes);
  }

  finalize(): RealtimeCloudSessionSnapshot {
    if (!this.finalized) {
      this.finalized = true;
      this.provider.commitAudio();
      this.provider.stop();
    }

    return this.snapshot();
  }

  cancel(reason = "Realtime Cloud Dictation session cancelled"): RealtimeCloudSessionSnapshot {
    if (!this.finalized) {
      this.finalized = true;
      this.provider.stop();
      this.updateOverlay({
        mode: "finalizing",
        cloudProviderLabel: "Cloud Dictation",
        message: reason,
        livePreviewTurns: this.turns
      });
    }

    return this.snapshot();
  }

  cancelForOfflineMode(): RealtimeCloudSessionSnapshot {
    return this.cancel("Realtime Cloud Dictation stopped because Offline Mode was enabled.");
  }

  private bufferPreConnectionAudio(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) {
      return;
    }

    this.preConnectionBuffer.push(bytes);
    this.preConnectionBytes += bytes.byteLength;

    while (this.preConnectionBytes > openAiRealtimePreConnectionBufferBytes) {
      const removed = this.preConnectionBuffer.shift();
      this.preConnectionBytes -= removed?.byteLength ?? 0;
    }
  }

  private flushPreConnectionBuffer(): void {
    for (const bytes of this.preConnectionBuffer) {
      this.provider.appendPcm16Audio(bytes);
    }

    this.preConnectionBuffer.length = 0;
    this.preConnectionBytes = 0;
  }

  private snapshot(): RealtimeCloudSessionSnapshot {
    return {
      startedAtMs: this.startedAtMs,
      turns: this.turns
    };
  }
}
