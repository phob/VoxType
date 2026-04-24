import { app } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getModelById } from "../shared/models";
import { type TranscriptEntry, type TranscriptionResult } from "../shared/transcripts";
import { DictionaryStore } from "./dictionary-store";
import { HistoryStore } from "./history-store";
import { RuntimeService } from "./runtime-service";
import { SettingsStore } from "./settings-store";

const execFileAsync = promisify(execFile);

export class TranscriptionService {
  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly historyStore: HistoryStore,
    private readonly runtimeService: RuntimeService,
    private readonly dictionaryStore: DictionaryStore
  ) {}

  async transcribeWav(
    audioBytes: Uint8Array,
    context?: { processName?: string | null }
  ): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const settings = await this.settingsStore.get();
    const model = getModelById(settings.activeModelId);

    if (!model) {
      throw new Error(`Unknown active model: ${settings.activeModelId}`);
    }

    const modelPath = join(settings.modelDirectory, model.fileName);
    const executable =
      settings.whisperExecutablePath.trim() ||
      (await this.runtimeService.getExecutablePath({ allowInstall: !settings.offlineMode })) ||
      "whisper-cli";
    const workDirectory = join(app.getPath("temp"), "voxtype");
    const id = randomUUID();
    const audioPath = join(workDirectory, `${id}.wav`);
    const outputBase = join(workDirectory, id);
    const outputTextPath = `${outputBase}.txt`;
    const promptContext = await this.dictionaryStore.buildPromptContext(context?.processName);
    const args = [
      "-m",
      modelPath,
      "-f",
      audioPath,
      "-otxt",
      "-of",
      outputBase,
      "-np"
    ];

    if (promptContext) {
      args.push("--prompt", promptContext);
    }

    await mkdir(workDirectory, { recursive: true });
    await writeFile(audioPath, audioBytes);

    try {
      const { stdout } = await execFileAsync(executable, args);

      const rawText = (await readTextOutput(outputTextPath, stdout)).trim();
      const correction = await this.dictionaryStore.applyCorrections(
        rawText,
        context?.processName
      );
      const text = correction.text.trim();

      if (!text) {
        throw new Error("Whisper completed but returned no transcript text.");
      }

      const audioFileName = await this.historyStore.saveAudio(id, audioBytes);
      const entry: TranscriptEntry = {
        id,
        text,
        rawText: rawText !== text ? rawText : undefined,
        correctionsApplied: correction.applied.length > 0 ? correction.applied : undefined,
        audioFileName,
        modelId: model.id,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt
      };

      await this.historyStore.add(entry);

      return { entry };
    } catch (error) {
      throw new Error(formatWhisperError(error, executable));
    } finally {
      await rm(audioPath, { force: true });
      await rm(outputTextPath, { force: true });
    }
  }
}

async function readTextOutput(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

function formatWhisperError(error: unknown, executable: string): string {
  const detail = error instanceof Error ? error.message : String(error);

  return [
    `Could not run whisper.cpp executable "${executable}".`,
    "Install/build whisper.cpp and set the whisper executable path in VoxType settings.",
    detail
  ].join(" ");
}
