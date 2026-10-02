import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
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
import { type CursorContext } from "../shared/cursor-context";
import { type OcrPromptContext } from "../shared/ocr-context";
import { findAppProfile, type AppProfile, type AppSettings } from "../shared/settings";
import { type SpeechSegment } from "../shared/speech-segments";
import { type TranscriptEntry, type TranscriptionResult } from "../shared/transcripts";
import { DictionaryStore } from "./dictionary-store";
import { HistoryStore } from "./history-store";
import { LlmCleanupService } from "./llm-cleanup-service";
import { localModelIdleStopMs } from "./local-server-process";
import { OpenAiFileAsrProvider } from "./openai-asr-provider";
import { OpenAiCredentialStore } from "./openai-credential-store";
import { ParakeetAsrProvider, type ParakeetHotwords } from "./parakeet-asr-provider";
import { buildCloudPromptPack } from "./prompt-pack";
import { RuntimeService } from "./runtime-service";
import { SettingsStore } from "./settings-store";
import { SherpaModelService } from "./sherpa-model-service";
import { SherpaRuntimeService } from "./sherpa-runtime-service";
import { composeSpeechWav, decodeMonoPcm, planSpeechChunks, type MonoPcm, type SpeechChunk } from "./speech-audio";
import { transcribeChunksWithWhisperCli, type WhisperChunkTranscription } from "./whisper-cli-transcriber";
import { WhisperServer, type WhisperServerConfig } from "./whisper-server";
import { type WindowsHelperService } from "./windows-helper-service";

interface ResolvedSpeech {
  audio: MonoPcm;
  segments: SpeechSegment[];
  /** Speech with long pauses shortened; what single-file providers and history receive. */
  wavBytes: Uint8Array;
}

export class TranscriptionService {
  private readonly whisperServer = new WhisperServer(localModelIdleStopMs);

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly historyStore: HistoryStore,
    private readonly runtimeService: RuntimeService,
    private readonly dictionaryStore: DictionaryStore,
    private readonly windowsHelperService: WindowsHelperService,
    private readonly llmCleanupService: LlmCleanupService,
    private readonly sherpaModelService = new SherpaModelService(settingsStore),
    private readonly sherpaRuntimeService = new SherpaRuntimeService(),
    private readonly parakeetProvider = new ParakeetAsrProvider(),
    private readonly openAiCredentials = new OpenAiCredentialStore(),
    private readonly openAiFileProvider = new OpenAiFileAsrProvider(openAiCredentials)
  ) {}

  async transcribeWav(
    audioBytes: Uint8Array,
    context?: {
      /** Segments from the live recording; omitted for saved audio, null when VAD was disabled. */
      speechSegments?: SpeechSegment[] | null;
      processName?: string | null;
      ocrContext?: OcrPromptContext | null;
      forceModeId?: "local.custom";
      /** Text before the cursor in the target app, captured when the dictation hotkey was pressed. */
      cursorContext?: CursorContext | null;
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

    const speech = await this.resolveSpeech(audioBytes, context?.speechSegments);

    if (isCloudDictationMode(mode.id)) {
      return this.transcribeCloudFile(speech.wavBytes, mode, settings, profile, whisperLanguage, context, startedAt);
    }

    if (mode.providerId === "local-parakeet") {
      return this.transcribeParakeetFile(speech.wavBytes, mode, settings, context, startedAt);
    }

    if (!model) {
      throw new Error(`Unknown active model: ${modelId}`);
    }

    const modelPath = join(settings.modelDirectory, model.fileName);
    const configuredExecutable = settings.whisperExecutablePath.trim();
    const executable =
      (configuredExecutable
        ? configuredExecutable
        : await this.runtimeService.getExecutablePath({
            allowInstall: !settings.offlineMode,
            preference: settings.whisperRuntimeBackend
          })) ?? "whisper-cli";
    const workDirectory = join(app.getPath("temp"), "voxtype");
    const id = randomUUID();
    const generatedPromptContext = await this.dictionaryStore.buildPromptContext(
      context?.processName,
      context?.ocrContext?.terms
    );
    const promptContext = combinePromptContext(
      generatedPromptContext,
      settings.whisperPromptOverride
    );
    const chunks = planSpeechChunks(speech.audio, speech.segments);

    console.info("[voxtype] transcribe", {
      engine: "local-whisper",
      modeId: mode.id,
      modelId: model.id,
      backend: settings.whisperRuntimeBackend,
      executable,
      speechSegments: speech.segments.length,
      chunks: chunks.length
    });

    try {
      const result = await this.transcribeWhisperChunks({
        executable,
        modelPath,
        chunks,
        prompt: promptContext,
        language: whisperLanguage,
        workDirectory,
        id
      });

      if (result.removed.length > 0) {
        console.info("[voxtype] whisper output filtered", {
          reasons: result.removed.map((item) => item.reason)
        });
      }

      const rawText = result.rawText;
      const normalizedText = normalizeTranscriptText(result.text);
      const correction = await this.dictionaryStore.applyCorrections(
        normalizedText,
        context?.processName
      );
      const ocrCorrection = applyOcrTermCorrections(
        correction.text,
        context?.ocrContext?.terms ?? []
      );
      const cleaned = await this.llmCleanupService.clean(ocrCorrection.text.trim(), {
        processName: context?.processName,
        ocrTerms: context?.ocrContext?.terms,
        textBefore: context?.cursorContext?.before
      });
      const text = cleaned.text.trim();

      if (!text) {
        throw new Error(cleaned.cleanup ? "Only hesitation sounds were recognized." : "Whisper completed but returned no transcript text.");
      }

      const audioFileName = await this.historyStore.saveAudio(id, speech.wavBytes);
      const entry: TranscriptEntry = {
        id,
        text,
        rawText: rawText !== text ? rawText : undefined,
        correctionsApplied: correction.applied.length > 0 ? correction.applied : undefined,
        ocrCorrectionsApplied:
          ocrCorrection.applied.length > 0 ? ocrCorrection.applied : undefined,
        cleanup: cleaned.cleanup,
        promptContext: promptContext ?? undefined,
        audioFileName,
        providerId: "local-whisper",
        dictationModeId: mode.id,
        modelId: model.id,
        languageHint: getProviderLanguageHint("local-whisper", whisperLanguage).parameterValue ?? undefined,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt
      };

      await this.historyStore.add(entry);

      return { entry, promptContext: promptContext ?? null };
    } catch (error) {
      throw new Error(formatWhisperError(error, executable), { cause: error });
    }
  }

  /**
   * Live recordings arrive with the segments the recorder detected. Saved audio (re-transcription)
   * is run through the native VAD again; `null` means VAD was disabled, so everything is speech.
   */
  private async resolveSpeech(
    audioBytes: Uint8Array,
    speechSegments: SpeechSegment[] | null | undefined
  ): Promise<ResolvedSpeech> {
    let audio: MonoPcm;
    let segments: SpeechSegment[];

    if (speechSegments === undefined) {
      const analyzed = await this.windowsHelperService.analyzeSpeechWav(audioBytes);
      audio = decodeMonoPcm(analyzed.wavBytes);
      segments = analyzed.speechSegments;
    } else {
      audio = decodeMonoPcm(audioBytes);
      segments = speechSegments ?? [
        { start: 0, end: audio.samples.length, speechStart: 0, speechEnd: audio.samples.length }
      ];
    }

    const wavBytes = composeSpeechWav(audio, segments);

    if (!wavBytes) {
      throw new Error("No speech detected.");
    }

    return { audio, segments, wavBytes };
  }

  /**
   * Loads the local Whisper model in the background when a recording starts, so it is warm by the
   * time the user stops speaking. Never installs anything and never throws.
   */
  async prewarm(processName: string | null): Promise<void> {
    try {
      const settings = await this.settingsStore.get();
      const mode = resolveDictationMode(settings, findAppProfile(settings.appProfiles, processName));
      const model = getModelById(resolveLocalModelId(settings, mode));

      if (mode.providerId !== "local-whisper" || !model) {
        return;
      }

      const executable =
        settings.whisperExecutablePath.trim() ||
        (await this.runtimeService.getExecutablePath({ allowInstall: false, preference: settings.whisperRuntimeBackend }));
      const config = executable ? whisperServerConfig(executable, join(settings.modelDirectory, model.fileName)) : null;

      if (config) {
        await this.whisperServer.ensure(config);
      }
    } catch (error) {
      console.warn("[voxtype] whisper-server prewarm failed", { message: formatErrorMessage(error) });
    }
  }

  stop(): void {
    this.whisperServer.stop();
  }

  // The warm whisper-server when the runtime ships one; whisper-cli (model loaded per call) otherwise
  // or when the server fails, so a server problem never costs a dictation.
  private async transcribeWhisperChunks(input: {
    executable: string;
    modelPath: string;
    chunks: SpeechChunk[];
    prompt: string | null;
    language: string;
    workDirectory: string;
    id: string;
  }): Promise<WhisperChunkTranscription> {
    const config = whisperServerConfig(input.executable, input.modelPath);

    if (config) {
      try {
        return await this.whisperServer.transcribeChunks(config, input);
      } catch (error) {
        console.warn("[voxtype] whisper-server failed; using whisper-cli", { message: formatErrorMessage(error) });
        this.whisperServer.stop();
      }
    }

    return transcribeChunksWithWhisperCli(input);
  }

  private async transcribeCloudFile(
    audioBytes: Uint8Array,
    mode: DictationMode,
    settings: AppSettings,
    profile: AppProfile | null,
    whisperLanguage: AppSettings["whisperLanguage"],
    context: { processName?: string | null; ocrContext?: OcrPromptContext | null; cursorContext?: CursorContext | null } | undefined,
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
      throw new Error(`${policy.userMessage} ${formatErrorMessage(error)}`, { cause: error });
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
    const cleaned = await this.llmCleanupService.clean(correction.text.trim(), {
      processName: context?.processName,
      ocrTerms: context?.ocrContext?.terms,
      textBefore: context?.cursorContext?.before
    });
    const text = cleaned.text.trim();

    if (!text) {
      throw new Error(cleaned.cleanup ? "Only hesitation sounds were recognized." : "OpenAI completed but returned no transcript text.");
    }

    const audioFileName = settings.cloudFileAudioHistoryEnabled
      ? await this.historyStore.saveAudio(id, audioBytes)
      : undefined;
    const entry: TranscriptEntry = {
      id,
      text,
      rawText: normalizedText !== text ? normalizedText : undefined,
      correctionsApplied: correction.applied.length > 0 ? correction.applied : undefined,
      cleanup: cleaned.cleanup,
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

  private async transcribeParakeetFile(
    audioBytes: Uint8Array,
    mode: DictationMode,
    settings: AppSettings,
    context: { processName?: string | null; ocrContext?: OcrPromptContext | null; cursorContext?: CursorContext | null } | undefined,
    startedAt: number
  ): Promise<TranscriptionResult> {
    const bundle = await this.sherpaModelService.resolveBundlePaths(mode.modelId);

    if (!bundle) {
      throw new Error(
        "The Parakeet model is not downloaded. Download it in VoxType settings before using Local Parakeet."
      );
    }

    const executablePath = await this.sherpaRuntimeService.getExecutablePath({
      allowInstall: !settings.offlineMode,
      backend: settings.sherpaRuntimeBackend
    });

    if (!executablePath) {
      throw new Error(
        "The sherpa-onnx runtime is not installed. Turn off offline mode to download it, or install it in VoxType settings."
      );
    }

    console.info("[voxtype] transcribe", {
      engine: "local-parakeet",
      modeId: mode.id,
      modelId: mode.modelId,
      backend: settings.sherpaRuntimeBackend,
      executable: executablePath
    });

    const id = randomUUID();
    const workDirectory = join(app.getPath("temp"), "voxtype");
    const generatedPromptContext = await this.dictionaryStore.buildPromptContext(
      context?.processName,
      context?.ocrContext?.terms
    );

    let hotwords: ParakeetHotwords | null = null;
    let hotwordsFilePath: string | null = null;

    try {
      // Decode-time hotwords are experimental and require bpe.vocab, which is not
      // part of the published bundle. Only build the hotwords file when the user
      // opted in AND the vocab is actually present on disk.
      if (settings.parakeetHotwordsEnabled && bundle.bpeVocab) {
        const terms = promptContextToHotwordTerms(generatedPromptContext);

        if (terms.length > 0) {
          await mkdir(workDirectory, { recursive: true });
          hotwordsFilePath = join(workDirectory, `${id}.hotwords.txt`);
          await writeFile(hotwordsFilePath, `${terms.join("\n")}\n`, "utf8");
          hotwords = {
            filePath: hotwordsFilePath,
            score: settings.parakeetHotwordsScore,
            bpeVocabPath: bundle.bpeVocab
          };
        }
      }

      const result = await this.parakeetProvider.transcribe({
        audioBytes,
        executablePath,
        bundle,
        backend: settings.sherpaRuntimeBackend,
        hotwords,
        workDirectory
      });

      const rawText = result.text.trim();
      const normalizedText = normalizeTranscriptText(rawText);
      const correction = await this.dictionaryStore.applyCorrections(
        normalizedText,
        context?.processName
      );
      const ocrCorrection = applyOcrTermCorrections(
        correction.text,
        context?.ocrContext?.terms ?? []
      );
      const cleaned = await this.llmCleanupService.clean(ocrCorrection.text.trim(), {
        processName: context?.processName,
        ocrTerms: context?.ocrContext?.terms,
        textBefore: context?.cursorContext?.before
      });
      const text = cleaned.text.trim();

      if (!text) {
        // Parakeet returns empty (not hallucinated) text on silence — surface it
        // the same way the Whisper path does rather than inserting nothing.
        throw new Error(cleaned.cleanup ? "Only hesitation sounds were recognized." : "Parakeet completed but returned no transcript text.");
      }

      console.info("[voxtype] transcribe done", {
        engine: "local-parakeet",
        modelId: mode.modelId,
        backend: settings.sherpaRuntimeBackend,
        hotwords: Boolean(hotwords),
        characters: text.length,
        durationMs: Date.now() - startedAt
      });

      const audioFileName = await this.historyStore.saveAudio(id, audioBytes);
      const entry: TranscriptEntry = {
        id,
        text,
        rawText: rawText !== text ? rawText : undefined,
        correctionsApplied: correction.applied.length > 0 ? correction.applied : undefined,
        ocrCorrectionsApplied:
          ocrCorrection.applied.length > 0 ? ocrCorrection.applied : undefined,
        cleanup: cleaned.cleanup,
        audioFileName,
        providerId: "local-parakeet",
        dictationModeId: mode.id,
        modelId: mode.modelId,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt
      };

      await this.historyStore.add(entry);

      return { entry, promptContext: null };
    } finally {
      if (hotwordsFilePath) {
        await rm(hotwordsFilePath, { force: true }).catch(() => undefined);
      }
    }
  }

}

function cloudErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  const match = /\(([^)]+)\)/.exec(error.message);
  return match?.[1] ?? error.name;
}

function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/transcript|text/i.test(message)) {
    return "Provider returned no usable transcript.";
  }

  return message;
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

function formatWhisperError(error: unknown, executable: string): string {
  const detail = error instanceof Error ? error.message : String(error);

  return [
    `Could not run whisper.cpp executable "${executable}".`,
    "Install/build whisper.cpp and set the whisper executable path in VoxType settings.",
    detail
  ].join(" ");
}

// The dictionary store returns the Whisper prompt as a term list ("a, b, c."). sherpa-onnx
// hotwords want one raw phrase per line, so split it back into terms.
function promptContextToHotwordTerms(promptContext: string | null): string[] {
  if (!promptContext) {
    return [];
  }

  return promptContext
    .trim()
    .replace(/\.$/, "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
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

function whisperServerConfig(cliExecutable: string, modelPath: string): WhisperServerConfig | null {
  const executable = join(dirname(cliExecutable), "whisper-server.exe");
  return existsSync(executable) && existsSync(modelPath) ? { executable, modelPath } : null;
}
