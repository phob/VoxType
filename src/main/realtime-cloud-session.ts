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

export class RealtimeCloudSession {
  private readonly startedAtMs = Date.now();
  private turns: TranscriptTurn[] = [];
  private finalized = false;
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
  }

  appendPcm16Audio(bytes: Uint8Array): void {
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

  cancel(): RealtimeCloudSessionSnapshot {
    if (!this.finalized) {
      this.finalized = true;
      this.provider.stop();
    }

    return this.snapshot();
  }

  private snapshot(): RealtimeCloudSessionSnapshot {
    return {
      startedAtMs: this.startedAtMs,
      turns: this.turns
    };
  }
}
