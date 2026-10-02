// LLM transcript cleanup for the app. Locally it installs the llama.cpp runtime and model on request and
// keeps llama-server warm while cleanup is enabled; with a cloud provider it sends each dictation to
// OpenAI or Anthropic with the user's API key. Either way it cleans each dictation's text before insertion.
import { app } from "electron";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveCloudPromptPackOcrEnabled } from "../shared/cloud-prompt-pack-settings";
import { type HardwareAccelerationReport } from "../shared/hardware";
import {
  cloudCleanupTimeoutMs,
  getCloudCleanupModel,
  llamaRuntimeCatalog,
  llmCleanupTimeoutMs,
  resolveLlmCleanupModel,
  type LlamaRuntime,
  type LlamaRuntimeBackend,
  type LlamaRuntimeCatalogItem,
  type CloudCleanupModel,
  type CloudCleanupProvider,
  type LlmCleanupStatus,
  type LlmCleanupTestResult,
  type LlmModel,
  type TranscriptCleanup
} from "../shared/llm-cleanup";
import { isHighSignalOcrPromptTerm } from "../shared/prompt-context";
import { type AppSettings, findAppProfile } from "../shared/settings";
import { type AnthropicCredentialStore, type ApiKeyStore } from "./api-key-store";
import { downloadAndExpandZip, downloadFile, findFile } from "./archive-download";
import { AnthropicCleanupChat, type CleanupChat, LocalCleanupChat, OpenAiCleanupChat } from "./cleanup-chat";
import { DictionaryStore } from "./dictionary-store";
import { HardwareService } from "./hardware-service";
import { LlamaServer, type LlamaServerConfig } from "./llama-server";
import { localModelIdleStopMs } from "./local-server-process";
import { runCleanup, skipCleanup, warmUpCleanup, type CleanupRun } from "./llm-cleanup-runner";
import { type OpenAiCredentialStore } from "./openai-credential-store";
import { SettingsStore } from "./settings-store";

const maxCleanupTerms = 40;

export interface CleanupContext {
  processName?: string | null;
  ocrTerms?: string[];
  /** Text before the cursor in the target app (UI Automation), if it could be read. */
  textBefore?: string;
}

export class LlmCleanupService {
  private readonly server = new LlamaServer(localModelIdleStopMs);
  private readonly runtimeRootDirectory = join(app.getPath("userData"), "runtimes", "llama.cpp");
  private hardwareReport: Promise<HardwareAccelerationReport> | null = null;
  private installing: Promise<LlmCleanupStatus> | null = null;
  private lastError: string | null = null;
  private warmConfigKey: string | null = null;
  // Reused across dictations so the HTTPS connection to the provider can stay open.
  private cloudChat: { key: string; chat: CleanupChat } | null = null;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly dictionaryStore: DictionaryStore,
    private readonly hardwareService: HardwareService,
    private readonly credentials: { openai: OpenAiCredentialStore; anthropic: AnthropicCredentialStore }
  ) {}

  async getStatus(): Promise<LlmCleanupStatus> {
    const settings = await this.settingsStore.get();
    const backend = await this.resolveBackend(settings);
    const provider = settings.llmCleanupProvider;

    return {
      enabled: settings.llmCleanupEnabled,
      provider,
      level: settings.llmCleanupLevel,
      cloud:
        provider === "local"
          ? null
          : {
              model: cloudModelFor(settings, provider),
              hasApiKey: await this.keyStore(provider).hasApiKey(),
              blockedByOfflineMode: settings.offlineMode
            },
      backend,
      runtime: await this.hydrateRuntime(this.runtimeFor(backend)),
      model: await this.hydrateModel(settings, backend),
      server: this.server.state,
      error: this.server.error ?? this.lastError
    };
  }

  /** Downloads whatever the current settings need (runtime zip and model) and warms the server up. */
  install(): Promise<LlmCleanupStatus> {
    this.installing ??= this.installNow().finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  /** Called when a recording starts: load the model while the user speaks (it unloads after idle time). */
  prewarm(): Promise<void> {
    return this.applySettings();
  }

  /** Called at startup and after settings changes: warm up when enabled and installed, stop otherwise. */
  async applySettings(): Promise<void> {
    const settings = await this.settingsStore.get();

    if (!settings.llmCleanupEnabled || settings.llmCleanupProvider !== "local") {
      this.server.stop();
      return;
    }

    const config = await this.serverConfig(settings);
    const configKey = JSON.stringify(config);

    // Any settings change lands here; only warm up when the server is not already warm for this config.
    if (config && (this.server.state !== "ready" || configKey !== this.warmConfigKey)) {
      this.warmConfigKey = configKey;
      const model = resolveLlmCleanupModel(settings.llmCleanupModelId, config.backend);
      void warmUpCleanup(new LocalCleanupChat(this.server, config, model.id), settings.llmCleanupLevel).catch((error: unknown) => {
        this.warmConfigKey = null;
        this.lastError = error instanceof Error ? error.message : String(error);
      });
    }
  }


  async clean(text: string, context: CleanupContext): Promise<{ text: string; cleanup?: TranscriptCleanup }> {
    const settings = await this.settingsStore.get();
    const profile = findAppProfile(settings.appProfiles, context.processName ?? null);
    const style = profile?.writingStyle ?? "default";

    if (!settings.llmCleanupEnabled || style === "raw" || !text.trim()) {
      return { text };
    }

    const provider = settings.llmCleanupProvider;
    // On-screen (OCR) terms go to a cloud provider only where the cloud Prompt Pack may contain them.
    const ocrAllowed = provider === "local" || resolveCloudPromptPackOcrEnabled(settings, profile);
    const input = {
      text,
      style,
      level: settings.llmCleanupLevel,
      textBefore: context.textBefore,
      terms: await this.cleanupTerms(ocrAllowed ? context : { ...context, ocrTerms: [] }),
      provider
    };
    let run: CleanupRun;

    if (provider === "local") {
      const backend = await this.resolveBackend(settings);
      const model = resolveLlmCleanupModel(settings.llmCleanupModelId, backend);
      const config = await this.serverConfig(settings);
      run = config
        ? await runCleanup(new LocalCleanupChat(this.server, config, model.id), { ...input, timeoutMs: llmCleanupTimeoutMs })
        : skipCleanup({ ...input, modelId: model.id }, "AI cleanup is enabled but its runtime or model is not installed.");
    } else {
      const model = cloudModelFor(settings, provider);
      const chat = await this.cloudChatFor(provider, model);
      // Text leaves the computer only when nothing forbids it; otherwise the deterministic steps still run.
      const blocked = settings.offlineMode
        ? "Offline Mode is on, so cloud AI cleanup did not run."
        : profile?.forbidCloudDictation
          ? "The app profile blocks cloud services, so cloud AI cleanup did not run."
          : null;
      run = blocked
        ? skipCleanup({ ...input, modelId: model.id }, blocked)
        : chat
          ? await runCleanup(chat, { ...input, timeoutMs: cloudCleanupTimeoutMs(text) })
          : skipCleanup({ ...input, modelId: model.id }, `No ${provider === "openai" ? "OpenAI" : "Anthropic"} API key is set for AI cleanup.`);
    }

    // Never log text: dictations are private.
    console.info("[voxtype] llm cleanup", {
      status: run.record.status,
      reason: run.record.reason,
      provider,
      level: run.record.level,
      modelId: run.record.modelId,
      durationMs: run.record.durationMs
    });

    return { text: run.text, cleanup: run.record };
  }

  /** The settings screen's "Try it": cleans sample text exactly like a dictation without an app profile. */
  async test(text: string): Promise<LlmCleanupTestResult> {
    const settings = await this.settingsStore.get();

    if (!settings.llmCleanupEnabled) {
      return { text, cleanup: null };
    }

    const result = await this.clean(text, {});
    return { text: result.text, cleanup: result.cleanup ?? null };
  }

  stop(): void {
    this.server.stop();
  }

  private keyStore(provider: CloudCleanupProvider): ApiKeyStore {
    return provider === "openai" ? this.credentials.openai : this.credentials.anthropic;
  }

  private async cloudChatFor(provider: CloudCleanupProvider, model: CloudCleanupModel): Promise<CleanupChat | null> {
    const apiKey = await this.keyStore(provider).getApiKey();

    if (!apiKey) {
      return null;
    }

    const key = JSON.stringify([provider, model.id, apiKey]);
    if (this.cloudChat?.key !== key) {
      this.cloudChat = { key, chat: provider === "openai" ? new OpenAiCleanupChat(apiKey, model) : new AnthropicCleanupChat(apiKey, model) };
    }
    return this.cloudChat.chat;
  }

  private async installNow(): Promise<LlmCleanupStatus> {
    const settings = await this.settingsStore.get();

    if (settings.llmCleanupProvider !== "local") {
      return this.getStatus();
    }

    if (settings.offlineMode) {
      throw new Error("AI cleanup needs a one-time download of its runtime and model. Turn off Offline Mode to install it.");
    }

    const backend = await this.resolveBackend(settings);
    const runtime = this.runtimeFor(backend);
    this.lastError = null;

    if (!(await this.hydrateRuntime(runtime)).executablePath) {
      await downloadAndExpandZip({
        url: runtime.url,
        archiveName: runtime.archiveName,
        runtimeDirectory: this.runtimeDirectory(runtime),
        extractDirectory: join(this.runtimeDirectory(runtime), "extract"),
        label: runtime.name
      });
    }

    const model = await this.hydrateModel(settings, backend);
    if (model.status !== "downloaded") {
      await mkdir(join(settings.modelDirectory, "llm"), { recursive: true });
      await downloadFile(model.url, model.localPath, model.name);
    }

    await this.applySettings();
    return this.getStatus();
  }

  private async serverConfig(settings: AppSettings): Promise<LlamaServerConfig | null> {
    const backend = await this.resolveBackend(settings);
    const runtime = await this.hydrateRuntime(this.runtimeFor(backend));
    const model = await this.hydrateModel(settings, backend);

    if (!runtime.executablePath || model.status !== "downloaded") {
      return null;
    }

    return { executable: runtime.executablePath, modelPath: model.localPath, backend };
  }

  private async cleanupTerms(context: CleanupContext): Promise<string[]> {
    const dictionaryTerms = await this.dictionaryStore.relevantTerms(context.processName);
    const ocrTerms = (context.ocrTerms ?? []).filter(isHighSignalOcrPromptTerm);
    const seen = new Set<string>();

    return [...dictionaryTerms, ...ocrTerms]
      .map((term) => term.trim())
      .filter((term) => {
        const key = term.toLowerCase();
        if (!term || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, maxCleanupTerms);
  }

  private async resolveBackend(settings: AppSettings): Promise<LlamaRuntimeBackend> {
    if (settings.llmCleanupBackend !== "auto") {
      return settings.llmCleanupBackend;
    }

    // Hardware does not change while VoxType runs; nvidia-smi and WMI are slow, so ask once.
    this.hardwareReport ??= this.hardwareService.getAccelerationReport();
    const report = await this.hardwareReport.catch(() => null);
    return report?.canUseGpuRuntime ? "vulkan" : "cpu";
  }

  private runtimeFor(backend: LlamaRuntimeBackend): LlamaRuntimeCatalogItem {
    const runtime = llamaRuntimeCatalog.find((item) => item.backend === backend);

    if (!runtime) {
      throw new Error(`No llama.cpp runtime is configured for ${backend}.`);
    }

    return runtime;
  }

  private runtimeDirectory(runtime: LlamaRuntimeCatalogItem): string {
    return join(this.runtimeRootDirectory, runtime.version, runtime.id);
  }

  private async hydrateRuntime(runtime: LlamaRuntimeCatalogItem): Promise<LlamaRuntime> {
    const executablePath = await findFile(this.runtimeDirectory(runtime), "llama-server.exe");
    return { ...runtime, executablePath, status: executablePath ? "installed" : "not-installed" };
  }

  private async hydrateModel(settings: AppSettings, backend: LlamaRuntimeBackend): Promise<LlmModel> {
    const model = resolveLlmCleanupModel(settings.llmCleanupModelId, backend);
    const localPath = join(settings.modelDirectory, "llm", model.fileName);
    const size = await stat(localPath).then((info) => info.size, () => 0);

    return { ...model, localPath, status: size > 0 ? "downloaded" : "not-downloaded" };
  }
}

function cloudModelFor(settings: AppSettings, provider: CloudCleanupProvider): CloudCleanupModel {
  return getCloudCleanupModel(provider, provider === "openai" ? settings.llmCleanupOpenAiModelId : settings.llmCleanupAnthropicModelId);
}
