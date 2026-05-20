import {
  getDictationMode,
  openAiRealtimeAudioConfig,
  type DictationMode,
  type PromptPack,
  type TranscriptTurn
} from "../shared/asr";
import { type AppSettings, type WhisperLanguage } from "../shared/settings";
import { type RecordingOverlayState } from "../shared/windows-helper";
import {
  assertCloudDictationLogIsMetadataOnly,
  createCloudDictationLogEntry
} from "../shared/cloud-logging";
import { OpenAiCredentialStore } from "./openai-credential-store";
import { OpenAiRealtimeAsrProvider } from "./openai-realtime-asr-provider";

export interface RealtimeCloudSessionSnapshot {
  startedAtMs: number;
  language: WhisperLanguage;
  turns: TranscriptTurn[];
  preConnectionDroppedBytes: number;
}

export interface RealtimeCloudSessionAudioDiagnostics {
  sessionReceivedChunks: number;
  sessionReceivedBytes: number;
  sessionBufferedBytes: number;
  sessionDroppedBytes: number;
  providerAppendedBytes: number;
  streamingStarted: boolean;
}

const openAiRealtimePreConnectionBufferBytes = openAiRealtimeAudioConfig.sampleRateHz * 2 * 5;

export class RealtimeCloudSession {
  private readonly startedAtMs = Date.now();
  private turns: TranscriptTurn[] = [];
  private finalized = false;
  private streamingStarted = false;
  private preConnectionBytes = 0;
  private preConnectionDroppedBytes = 0;
  private receivedChunks = 0;
  private receivedBytes = 0;
  private readonly preConnectionBuffer: Uint8Array[] = [];
  private readonly provider: OpenAiRealtimeAsrProvider;
  private readonly mode: DictationMode;

  constructor(
    credentials: OpenAiCredentialStore,
    private readonly settings: AppSettings,
    private readonly language: WhisperLanguage,
    private readonly promptPack: PromptPack | null,
    private readonly updateOverlay: (state: Partial<RecordingOverlayState>) => void
  ) {
    this.mode = getDictationMode("openai.realtime");
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

  async start(): Promise<void> {
    const startedLogEntry = createCloudDictationLogEntry({
      providerId: "openai",
      modelId: this.mode.modelId,
      modeId: this.mode.id,
      durationMs: 0,
      status: "started"
    });
    assertCloudDictationLogIsMetadataOnly(startedLogEntry);

    await this.provider.startStreaming({
      mode: this.mode,
      promptPack: this.promptPack,
      language: this.language,
      audioConfig: openAiRealtimeAudioConfig,
      latencyPreset: this.settings.realtimeLatencyPreset,
      vadThresholdOverride: this.settings.realtimeVadThresholdOverride
    });
    this.streamingStarted = true;
    this.flushPreConnectionBuffer();
  }

  appendPcm16Audio(bytes: Uint8Array): void {
    if (this.finalized) {
      return;
    }

    this.receivedChunks += 1;
    this.receivedBytes += bytes.byteLength;

    if (!this.streamingStarted) {
      this.bufferPreConnectionAudio(bytes);
      return;
    }

    this.provider.appendPcm16Audio(bytes);
  }

  async finalize(): Promise<RealtimeCloudSessionSnapshot> {
    if (!this.finalized) {
      this.finalized = true;
      const completedLogEntry = createCloudDictationLogEntry({
        providerId: "openai",
        modelId: this.mode.modelId,
        modeId: this.mode.id,
        durationMs: Date.now() - this.startedAtMs,
        status: "completed"
      });
      assertCloudDictationLogIsMetadataOnly(completedLogEntry);
      try {
        await this.provider.commitAudioAndWaitForFinalTranscript();
      } finally {
        this.provider.stop("Realtime Cloud Dictation stopped after final transcript processing.", {
          preserveLastError: true
        });
      }
    }

    return this.snapshot();
  }

  cancel(reason = "Realtime Cloud Dictation session cancelled"): RealtimeCloudSessionSnapshot {
    if (!this.finalized) {
      this.finalized = true;
      const cancelledLogEntry = createCloudDictationLogEntry({
        providerId: "openai",
        modelId: this.mode.modelId,
        modeId: this.mode.id,
        durationMs: Date.now() - this.startedAtMs,
        status: "cancelled"
      });
      assertCloudDictationLogIsMetadataOnly(cancelledLogEntry);
      this.provider.stop(reason);
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
      const removedBytes = removed?.byteLength ?? 0;
      this.preConnectionBytes -= removedBytes;
      this.preConnectionDroppedBytes += removedBytes;
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
      language: this.language,
      turns: this.turns,
      preConnectionDroppedBytes: this.preConnectionDroppedBytes
    };
  }

  getAudioDiagnostics(): RealtimeCloudSessionAudioDiagnostics {
    return {
      sessionReceivedChunks: this.receivedChunks,
      sessionReceivedBytes: this.receivedBytes,
      sessionBufferedBytes: this.preConnectionBytes,
      sessionDroppedBytes: this.preConnectionDroppedBytes,
      providerAppendedBytes: this.provider.getAppendedAudioBytes(),
      streamingStarted: this.streamingStarted
    };
  }
}
