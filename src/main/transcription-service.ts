import { app } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  getDictationMode,
  isCloudDictationMode,
  type DictationMode,
  type DictationModeId
} from "../shared/asr";
import {
  assertCloudDictationLogIsMetadataOnly,
  createCloudDictationLogEntry
} from "../shared/cloud-logging";
import { getCloudFailurePolicy } from "../shared/cloud-failure-policy";
import { resolveCloudPromptPackOcrEnabled } from "../shared/cloud-prompt-pack-settings";
import {
  getCloudDictationReadinessForMode,
  profileCloudFallbackModeId,
  resolveEffectiveDictationModeId
} from "../shared/cloud-status";
import { getModelById } from "../shared/models";
import { getProviderLanguageHint } from "../shared/provider-language";
import { type OcrPromptContext } from "../shared/ocr-context";
import { findAppProfile, type AppProfile, type AppSettings } from "../shared/settings";
import { type TranscriptEntry, type TranscriptionResult } from "../shared/transcripts";
import { DictionaryStore } from "./dictionary-store";
import { HistoryStore } from "./history-store";
import { OpenAiFileAsrProvider } from "./openai-asr-provider";
import { OpenAiCredentialStore } from "./openai-credential-store";
import { buildCloudPromptPack } from "./prompt-pack";
import { RuntimeService } from "./runtime-service";
import { SettingsStore } from "./settings-store";

const execFileAsync = promisify(execFile);

export class TranscriptionService {
  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly historyStore: HistoryStore,
    private readonly runtimeService: RuntimeService,
    private readonly dictionaryStore: DictionaryStore,
    private readonly openAiCredentials = new OpenAiCredentialStore(),
    private readonly openAiFileProvider = new OpenAiFileAsrProvider(openAiCredentials)
  ) {}

  async transcribeWav(
    audioBytes: Uint8Array,
    context?: {
      processName?: string | null;
      ocrContext?: OcrPromptContext | null;
      forceModeId?: "local.custom";
    }
  ): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const settings = await this.settingsStore.get();
    const profile = findAppProfile(settings.appProfiles, context?.processName ?? null);
    const mode = context?.forceModeId === "local.custom"
      ? getDictationMode("local.custom")
      : resolveDictationMode(settings, profile);
    const modelId = resolveLocalModelId(settings, mode);
    const model = getModelById(modelId);
    const whisperLanguage =
      profile?.whisperLanguage && profile.whisperLanguage !== "inherit"
        ? profile.whisperLanguage
        : settings.whisperLanguage;

    if (isCloudDictationMode(mode.id)) {
      return this.transcribeCloudFile(audioBytes, mode, settings, profile, whisperLanguage, context, startedAt);
    }

    if (!model) {
      throw new Error(`Unknown active model: ${modelId}`);
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
    const promptContext = combinePromptContext(
      generatedPromptContext,
      settings.whisperPromptOverride
    );
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

    if (whisperLanguage !== "auto") {
      args.push("--language", whisperLanguage);
    }

    await mkdir(workDirectory, { recursive: true });
    await writeFile(audioPath, audioBytes);

    try {
      const { stdout } = await execFileAsync(executable, args);

      const rawText = (await readTextOutput(outputTextPath, stdout)).trim();
      const normalizedText = normalizeTranscriptText(rawText);
      const correction = await this.dictionaryStore.applyCorrections(
        normalizedText,
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
        providerId: "local-whisper",
        dictationModeId: mode.id,
        modelId: model.id,
        languageHint: getProviderLanguageHint("local-whisper", whisperLanguage).parameterValue ?? undefined,
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

  private async transcribeCloudFile(
    audioBytes: Uint8Array,
    mode: DictationMode,
    settings: AppSettings,
    profile: AppProfile | null,
    whisperLanguage: AppSettings["whisperLanguage"],
    context: { processName?: string | null; ocrContext?: OcrPromptContext | null } | undefined,
    startedAt: number
  ): Promise<TranscriptionResult> {
    const readiness = getCloudDictationReadinessForMode({
      settings,
      profile,
      hasApiKey: await this.openAiCredentials.hasApiKey(),
      requestedModeId: mode.id
    });

    if (!readiness.ready || !readiness.cloud) {
      throw new Error(readiness.reason ?? "Cloud Dictation is not ready.");
    }

    if (mode.kind !== "file") {
      throw new Error("Realtime Cloud Dictation uses streaming capture and cannot transcribe a completed WAV file.");
    }

    const id = randomUUID();
    const promptPack = await buildCloudPromptPack(this.dictionaryStore, {
      processName: context?.processName,
      ocrContext: context?.ocrContext,
      includeOcrContext: resolveCloudPromptPackOcrEnabled(settings, profile),
      consentAccepted: settings.cloudDictationConsentAccepted
    });
    const startedLogEntry = createCloudDictationLogEntry({
      providerId: "openai",
      modelId: mode.modelId,
      modeId: mode.id,
      durationMs: 0,
      status: "started"
    });
    assertCloudDictationLogIsMetadataOnly(startedLogEntry);

    let asrResult: Awaited<ReturnType<OpenAiFileAsrProvider["transcribeFile"]>>;

    try {
      asrResult = await this.openAiFileProvider.transcribeFile({
        audioBytes,
        mode,
        promptPack,
        language: whisperLanguage
      });
    } catch (error) {
      const failedLogEntry = createCloudDictationLogEntry({
        providerId: "openai",
        modelId: mode.modelId,
        modeId: mode.id,
        durationMs: Date.now() - startedAt,
        status: "failed",
        errorCode: cloudErrorCode(error)
      });
      assertCloudDictationLogIsMetadataOnly(failedLogEntry);
      const policy = getCloudFailurePolicy(mode.id);
      throw new Error(`${policy.userMessage} ${formatErrorMessage(error)}`);
    }

    const completedLogEntry = createCloudDictationLogEntry({
      providerId: asrResult.providerId,
      modelId: asrResult.modelId,
      modeId: asrResult.modeId,
      durationMs: asrResult.durationMs,
      status: "completed"
    });
    assertCloudDictationLogIsMetadataOnly(completedLogEntry);
    const normalizedText = normalizeTranscriptText(asrResult.providerText);
    const correction = await this.dictionaryStore.applyCorrections(
      normalizedText,
      context?.processName
    );
    const text = correction.text.trim();

    if (!text) {
      throw new Error("OpenAI completed but returned no transcript text.");
    }

    const audioFileName = settings.cloudFileAudioHistoryEnabled
      ? await this.historyStore.saveAudio(id, audioBytes)
      : undefined;
    const entry: TranscriptEntry = {
      id,
      text,
      rawText: normalizedText !== text ? normalizedText : undefined,
      correctionsApplied: correction.applied.length > 0 ? correction.applied : undefined,
      audioFileName,
      providerId: asrResult.providerId,
      dictationModeId: asrResult.modeId,
      modelId: asrResult.modelId,
      languageHint: getProviderLanguageHint("openai", whisperLanguage).parameterValue ?? undefined,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    };

    await this.historyStore.add(entry);

    return { entry, promptContext: promptPack?.text ?? null };
  }

}

function cloudErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  const match = error.message.match(/\(([^)]+)\)/);
  return match?.[1] ?? error.name;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveDictationMode(settings: AppSettings, profile: AppProfile | null): DictationMode {
  const requestedModeId: DictationModeId = resolveEffectiveDictationModeId(settings, profile);
  const modeId =
    profile?.forbidCloudDictation && isCloudDictationMode(requestedModeId)
      ? profileCloudFallbackModeId
      : requestedModeId;

  return getDictationMode(modeId);
}

function resolveLocalModelId(settings: AppSettings, mode: DictationMode): string {
  if (mode.id === "local.custom") {
    return settings.localCustomModelId || settings.activeModelId;
  }

  if (mode.providerId === "local-whisper") {
    return mode.modelId;
  }

  return settings.activeModelId;
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

function normalizeTranscriptText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function combinePromptContext(
  generatedPromptContext: string | null,
  promptOverride: string
): string | null {
  const generated = generatedPromptContext?.trim() ?? "";
  const custom = promptOverride.trim();

  if (!generated) {
    return custom || null;
  }

  if (!custom) {
    return generated;
  }

  if (custom.includes(generated)) {
    return custom;
  }

  return `${generated} ${custom}`;
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
