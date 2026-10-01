// Local LLM transcript cleanup for the app: installs the llama.cpp runtime and model on request, keeps
// llama-server warm while cleanup is enabled, and cleans each dictation's text before it is inserted.
import { app } from "electron";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type HardwareAccelerationReport } from "../shared/hardware";
import {
  llamaRuntimeCatalog,
  llmCleanupTimeoutMs,
  resolveLlmCleanupModel,
  type LlamaRuntime,
  type LlamaRuntimeBackend,
  type LlamaRuntimeCatalogItem,
  type LlmCleanupStatus,
  type LlmModel,
  type TranscriptCleanup
} from "../shared/llm-cleanup";
import { isHighSignalOcrPromptTerm } from "../shared/prompt-context";
import { type AppSettings, findAppProfile } from "../shared/settings";
import { downloadAndExpandZip, downloadFile, findFile } from "./archive-download";
import { DictionaryStore } from "./dictionary-store";
import { HardwareService } from "./hardware-service";
import { LlamaServer, type LlamaServerConfig } from "./llama-server";
import { runCleanup, warmUpCleanup } from "./llm-cleanup-runner";
import { SettingsStore } from "./settings-store";

const maxCleanupTerms = 40;

export interface CleanupContext {
  processName?: string | null;
  ocrTerms?: string[];
}

export class LlmCleanupService {
  private readonly server = new LlamaServer();
  private readonly runtimeRootDirectory = join(app.getPath("userData"), "runtimes", "llama.cpp");
  private hardwareReport: Promise<HardwareAccelerationReport> | null = null;
  private installing: Promise<LlmCleanupStatus> | null = null;
  private lastError: string | null = null;
  private warmConfigKey: string | null = null;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly dictionaryStore: DictionaryStore,
    private readonly hardwareService: HardwareService
  ) {}

  async getStatus(): Promise<LlmCleanupStatus> {
    const settings = await this.settingsStore.get();
    const backend = await this.resolveBackend(settings);

    return {
      enabled: settings.llmCleanupEnabled,
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

  /** Called at startup and after settings changes: warm up when enabled and installed, stop otherwise. */
  async applySettings(): Promise<void> {
    const settings = await this.settingsStore.get();

    if (!settings.llmCleanupEnabled) {
      this.server.stop();
      return;
    }

    const config = await this.serverConfig(settings);
    const configKey = JSON.stringify(config);

    // Any settings change lands here; only warm up when the server is not already warm for this config.
    if (config && (this.server.state !== "ready" || configKey !== this.warmConfigKey)) {
      this.warmConfigKey = configKey;
      void warmUpCleanup(this.server, config).catch((error: unknown) => {
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

    const backend = await this.resolveBackend(settings);
    const model = resolveLlmCleanupModel(settings.llmCleanupModelId, backend);
    const config = await this.serverConfig(settings);

    if (!config) {
      return {
        text,
        cleanup: { status: "failed", reason: "AI cleanup is enabled but its runtime or model is not installed.", modelId: model.id, durationMs: 0 }
      };
    }

    const run = await runCleanup(this.server, config, {
      text,
      style,
      terms: await this.cleanupTerms(context),
      modelId: model.id,
      timeoutMs: llmCleanupTimeoutMs
    });

    console.info("[voxtype] llm cleanup", {
      status: run.record.status,
      reason: run.record.reason,
      modelId: model.id,
      backend,
      durationMs: run.record.durationMs
    });

    return { text: run.text, cleanup: run.record };
  }

  stop(): void {
    this.server.stop();
  }

  private async installNow(): Promise<LlmCleanupStatus> {
    const settings = await this.settingsStore.get();

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
