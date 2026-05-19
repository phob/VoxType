import {
  createCorrectedRealtimeCloudHistoryEntry,
  type RealtimeCloudHistoryInput
} from "../shared/realtime-history";
import { DictionaryStore } from "./dictionary-store";
import { HistoryStore } from "./history-store";

export class RealtimeCloudHistoryService {
  constructor(
    private readonly dictionaryStore: DictionaryStore,
    private readonly historyStore: HistoryStore
  ) {}

  async save(
    input: RealtimeCloudHistoryInput & { processName?: string | null }
  ): Promise<Awaited<ReturnType<typeof createCorrectedRealtimeCloudHistoryEntry>>> {
    const entry = await createCorrectedRealtimeCloudHistoryEntry({
      ...input,
      applyCorrections: async ({ text, processName }) => {
        const correction = await this.dictionaryStore.applyCorrections(text, processName);

        return {
          text: correction.text,
          correctionsApplied: correction.applied.length > 0 ? correction.applied : undefined
        };
      }
    });

    await this.historyStore.add(entry);
    return entry;
  }
}
