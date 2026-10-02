import {
  composeRealtimeTurns,
  createCorrectedRealtimeCloudHistoryEntry,
  type RealtimeCloudHistoryInput
} from "../shared/realtime-history";
import { type TranscriptCleanup } from "../shared/llm-cleanup";
import { DictionaryStore } from "./dictionary-store";
import { HistoryStore } from "./history-store";
import { LlmCleanupService } from "./llm-cleanup-service";

export class RealtimeCloudHistoryService {
  constructor(
    private readonly dictionaryStore: DictionaryStore,
    private readonly historyStore: HistoryStore,
    private readonly llmCleanupService: LlmCleanupService
  ) {}

  async save(
    input: RealtimeCloudHistoryInput & { processName?: string | null }
  ): Promise<Awaited<ReturnType<typeof createCorrectedRealtimeCloudHistoryEntry>>> {
    const providerText = composeRealtimeTurns(input.turns).trim();

    if (!providerText) {
      throw new Error("Realtime Cloud Dictation completed but returned no transcript turns.");
    }

    let cleanup: TranscriptCleanup | undefined;
    const entry = await createCorrectedRealtimeCloudHistoryEntry({
      ...input,
      applyCorrections: async ({ text, processName }) => {
        const correction = await this.dictionaryStore.applyCorrections(text, processName);
        const cleaned = await this.llmCleanupService.clean(correction.text, { processName });
        cleanup = cleaned.cleanup;

        return {
          // Realtime has no "no speech" error path; keep the corrected text if cleanup left nothing.
          text: cleaned.text.trim() || correction.text,
          correctionsApplied: correction.applied.length > 0 ? correction.applied : undefined
        };
      }
    });

    entry.cleanup = cleanup;
    await this.historyStore.add(entry);
    return entry;
  }
}
