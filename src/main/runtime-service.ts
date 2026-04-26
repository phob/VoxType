import { app } from "electron";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  getRuntimeById,
  type WhisperRuntime,
  type WhisperRuntimeBackend,
  type WhisperRuntimeCatalogItem,
  type WhisperRuntimePreference,
  whisperRuntimeCatalog
} from "../shared/runtimes";
import { HardwareService } from "./hardware-service";

const execFileAsync = promisify(execFile);
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

    const runtimeDirectory = this.getRuntimeDirectory(runtime);
    const archivePath = join(runtimeDirectory, runtime.archiveName);
    const temporaryArchivePath = `${archivePath}.download`;
    const extractDirectory = join(runtimeDirectory, "extract");

    await mkdir(dirname(archivePath), { recursive: true });
    await rm(extractDirectory, { recursive: true, force: true });
    await mkdir(extractDirectory, { recursive: true });

    const response = await fetch(runtime.url);

    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to download ${runtime.name}: ${response.status} ${response.statusText}`
      );
    }

    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      createWriteStream(temporaryArchivePath)
    );
    await rm(archivePath, { force: true });
    await rename(temporaryArchivePath, archivePath);
    await this.expandArchive(archivePath, extractDirectory);

    const installedRuntime = await this.hydrateRuntime(runtime);

    if (!installedRuntime.executablePath) {
      throw new Error(`Installed ${runtime.name}, but no whisper-cli.exe was found.`);
    }

    return installedRuntime;
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

  private async expandArchive(archivePath: string, destination: string): Promise<void> {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "$archivePath = [Environment]::GetEnvironmentVariable('VOXTYPE_ARCHIVE_PATH')",
        "$destinationPath = [Environment]::GetEnvironmentVariable('VOXTYPE_EXTRACT_PATH')",
        "Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force"
      ].join("; ")
    ], {
      env: {
        ...process.env,
        VOXTYPE_ARCHIVE_PATH: archivePath,
        VOXTYPE_EXTRACT_PATH: destination
      }
    });
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

async function findFile(directory: string, fileName: string): Promise<string | null> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return fullPath;
      }

      if (entry.isDirectory()) {
        const found = await findFile(fullPath, fileName);

        if (found) {
          return found;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}
