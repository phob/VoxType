import { app } from "electron";
import { join } from "node:path";
import {
  getRuntimeById,
  type WhisperRuntime,
  type WhisperRuntimeBackend,
  type WhisperRuntimeCatalogItem,
  type WhisperRuntimePreference,
  whisperRuntimeCatalog
} from "../shared/runtimes";
import { downloadAndExpandZip, findFile } from "./archive-download";
import { HardwareService } from "./hardware-service";

const executableCandidates = ["whisper-cli.exe", "main.exe"];

export class RuntimeService {
  private readonly runtimeRootDirectory: string;
  private readonly hardwareService = new HardwareService();

  constructor() {
    this.runtimeRootDirectory = join(
      app.getPath("userData"),
      "runtimes",
      "whisper.cpp"
    );
  }

  async getWhisperRuntime(): Promise<WhisperRuntime> {
    return this.getPreferredRuntime("auto");
  }

  async listWhisperRuntimes(): Promise<WhisperRuntime[]> {
    return Promise.all(whisperRuntimeCatalog.map((runtime) => this.hydrateRuntime(runtime)));
  }

  async getPreferredRuntime(
    preference: WhisperRuntimePreference
  ): Promise<WhisperRuntime> {
    const runtimes = await this.listWhisperRuntimes();
    const selectedRuntime = await this.selectRuntime(runtimes, preference);

    return selectedRuntime;
  }

  async installWhisperRuntime(runtimeId?: string): Promise<WhisperRuntime> {
    if (process.platform !== "win32") {
      throw new Error("Managed whisper.cpp runtime installation is currently Windows-only.");
    }

    const runtime = runtimeId ? getRuntimeById(runtimeId) : await this.getInstallTarget("auto");

    if (!runtime) {
      throw new Error(`Unknown whisper.cpp runtime: ${runtimeId ?? "auto"}.`);
    }

    if (!runtime.managed || !runtime.archiveName || !runtime.url) {
      throw new Error(`${runtime.name} is not available as a managed download yet.`);
    }

    await downloadAndExpandZip({
      url: runtime.url,
      archiveName: runtime.archiveName,
      runtimeDirectory: this.getRuntimeDirectory(runtime),
      extractDirectory: join(this.getRuntimeDirectory(runtime), "extract"),
      label: runtime.name
    });

    const installedRuntime = await this.hydrateRuntime(runtime);

    if (!installedRuntime.executablePath) {
      throw new Error(`Installed ${runtime.name}, but no whisper-cli.exe was found.`);
    }

    return installedRuntime;
  }

  async getFirstRunCudaRuntimeTarget(): Promise<WhisperRuntimeCatalogItem | null> {
    const hardware = await this.hardwareService.getAccelerationReport();

    if (hardware.recommendedBackend !== "cuda") {
      return null;
    }

    return this.getCudaRuntimeForDriver(hardware.bestGpu?.driverVersion);
  }

  async getExecutablePath(options: {
    allowInstall: boolean;
    preference: WhisperRuntimePreference;
  }): Promise<string | null> {
    const runtime = await this.getPreferredRuntime(options.preference);

    if (runtime.executablePath) {
      return runtime.executablePath;
    }

    if (!options.allowInstall) {
      return null;
    }

    return (await this.installWhisperRuntime(runtime.id)).executablePath;
  }

  private async getInstallTarget(
    preference: WhisperRuntimePreference
  ): Promise<WhisperRuntimeCatalogItem | null> {
    const runtime = await this.getPreferredRuntime(preference);
    return getRuntimeById(runtime.id) ?? null;
  }

  private getCudaRuntimeForDriver(driverVersion?: string): WhisperRuntimeCatalogItem | null {
    const majorDriverVersion = parseDriverMajorVersion(driverVersion);
    const preferredRuntimeId =
      majorDriverVersion !== null && majorDriverVersion < 551
        ? "whisper.cpp-cuda-11.8-x64"
        : "whisper.cpp-cuda-12.4-x64";

    return getRuntimeById(preferredRuntimeId) ?? null;
  }

  private async selectRuntime(
    runtimes: WhisperRuntime[],
    preference: WhisperRuntimePreference
  ): Promise<WhisperRuntime> {
    if (preference !== "auto") {
      return (
        runtimes.find((runtime) => runtime.backend === preference && runtime.status !== "unavailable") ??
        this.requireRuntime(runtimes, "cpu")
      );
    }

    const hardware = await this.hardwareService.getAccelerationReport();
    const preferredBackends: WhisperRuntimeBackend[] =
      hardware.recommendedBackend === "cuda"
        ? ["cuda", "cpu"]
        : hardware.recommendedBackend === "vulkan"
          ? ["vulkan", "cpu"]
          : ["cpu"];

    for (const backend of preferredBackends) {
      const installedRuntime = runtimes.find(
        (runtime) => runtime.backend === backend && runtime.status === "installed"
      );

      if (installedRuntime) {
        return installedRuntime;
      }
    }

    for (const backend of preferredBackends) {
      const managedRuntime = runtimes.find(
        (runtime) => runtime.backend === backend && runtime.managed
      );

      if (managedRuntime) {
        return managedRuntime;
      }
    }

    return this.requireRuntime(runtimes, "cpu");
  }

  private requireRuntime(
    runtimes: WhisperRuntime[],
    backend: WhisperRuntimeBackend
  ): WhisperRuntime {
    const runtime = runtimes.find((item) => item.backend === backend);

    if (!runtime) {
      throw new Error(`No ${backend} whisper.cpp runtime is configured.`);
    }

    return runtime;
  }

  private async hydrateRuntime(runtime: WhisperRuntimeCatalogItem): Promise<WhisperRuntime> {
    const executablePath = await this.findExecutable(runtime);

    return {
      ...runtime,
      executablePath,
      status: executablePath ? "installed" : runtime.managed ? "not-installed" : "unavailable"
    };
  }

  private async findExecutable(runtime: WhisperRuntimeCatalogItem): Promise<string | null> {
    const runtimeDirectory = this.getRuntimeDirectory(runtime);

    for (const candidate of executableCandidates) {
      const found = await findFile(runtimeDirectory, candidate);

      if (found) {
        return found;
      }
    }

    return null;
  }

  private getRuntimeDirectory(runtime: WhisperRuntimeCatalogItem): string {
    return join(this.runtimeRootDirectory, runtime.version, runtime.id);
  }
}

function parseDriverMajorVersion(driverVersion?: string): number | null {
  if (!driverVersion) {
    return null;
  }

  const [major] = driverVersion.split(".");
  const parsed = Number.parseInt(major, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
