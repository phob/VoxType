import { app } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getModelById } from "../shared/models";
import { type OcrPromptContext } from "../shared/ocr-context";
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
    context?: { processName?: string | null; ocrContext?: OcrPromptContext | null }
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
      (await this.runtimeService.getExecutablePath({
        allowInstall: !settings.offlineMode,
        preference: settings.whisperRuntimeBackend
      })) ||
      "whisper-cli";
    const workDirectory = join(app.getPath("temp"), "voxtype");
    const id = randomUUID();
    const audioPath = join(workDirectory, `${id}.wav`);
    const outputBase = join(workDirectory, id);
    const outputTextPath = `${outputBase}.txt`;
    const generatedPromptContext = await this.dictionaryStore.buildPromptContext(
      context?.processName,
      context?.ocrContext?.terms
    );
    const promptContext = settings.whisperPromptOverride.trim() || generatedPromptContext;
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
      const ocrCorrection = applyOcrTermCorrections(
        correction.text,
        context?.ocrContext?.terms ?? []
      );
      const text = ocrCorrection.text.trim();

      if (!text) {
        throw new Error("Whisper completed but returned no transcript text.");
      }

      const audioFileName = await this.historyStore.saveAudio(id, audioBytes);
      const entry: TranscriptEntry = {
        id,
        text,
        rawText: rawText !== text ? rawText : undefined,
        correctionsApplied: correction.applied.length > 0 ? correction.applied : undefined,
        ocrCorrectionsApplied:
          ocrCorrection.applied.length > 0 ? ocrCorrection.applied : undefined,
        promptContext: promptContext || undefined,
        audioFileName,
        modelId: model.id,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt
      };

      await this.historyStore.add(entry);

      return { entry, promptContext: promptContext || null };
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

function applyOcrTermCorrections(text: string, terms: string[]): {
  text: string;
  applied: string[];
} {
  let corrected = text;
  const applied: string[] = [];

  for (const term of terms.slice(0, 60)) {
    const variants = spokenVariantsForTerm(term);

    for (const variant of variants) {
      if (!variant || variant.toLowerCase() === term.toLowerCase()) {
        continue;
      }

      const next = replaceSpokenVariant(corrected, variant, term);

      if (next !== corrected) {
        corrected = next;
        applied.push(`${variant} -> ${term}`);
        break;
      }
    }
  }

  return { text: corrected, applied };
}

function spokenVariantsForTerm(term: string): string[] {
  const normalized = term.trim();

  if (normalized.length < 4 || normalized.length > 72) {
    return [];
  }

  const variants = new Set<string>();
  const separatorVariant = normalized.replace(/[._/#\\-]+/g, " ").replace(/\s+/g, " ").trim();
  const camelVariant = normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (separatorVariant.includes(" ")) {
    variants.add(separatorVariant);
  }

  if (camelVariant.includes(" ")) {
    variants.add(camelVariant);
  }

  if (/^[A-Z]{2,6}$/.test(normalized)) {
    variants.add(normalized.split("").join(" "));
  }

  if (/^HRESULT$/i.test(normalized)) {
    variants.add("h result");
  }

  return [...variants].filter((variant) => variant.length >= 3);
}

function replaceSpokenVariant(text: string, variant: string, term: string): string {
  const escaped = variant
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const expression = new RegExp(`\\b${escaped}\\b`, "gi");

  return text.replace(expression, term);
}
