import { app } from "electron";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  getSherpaRuntimeById,
  getSherpaRuntimeForBackend,
  sherpaRuntimeCatalog,
  type SherpaRuntime,
  type SherpaRuntimeBackend,
  type SherpaRuntimeCatalogItem
} from "../shared/sherpa-runtimes";
import { extractTarBz2 } from "./tar-archive";

const executableCandidates = ["sherpa-onnx-offline.exe"];

// Downloads / extracts / locates the sherpa-onnx offline CLI. Structurally
// mirrors RuntimeService (whisper.cpp), but with two deliberate differences:
//   - `.tar.bz2` extraction via the system tar instead of Expand-Archive, and
//   - explicit backend selection (no HardwareService auto-promotion to CUDA).
export class SherpaRuntimeService {
  private readonly runtimeRootDirectory: string;

  constructor() {
    this.runtimeRootDirectory = join(
      app.getPath("userData"),
      "runtimes",
      "sherpa-onnx"
    );
  }

  async listRuntimes(): Promise<SherpaRuntime[]> {
    return Promise.all(sherpaRuntimeCatalog.map((runtime) => this.hydrateRuntime(runtime)));
  }

  async getRuntimeForBackend(backend: SherpaRuntimeBackend): Promise<SherpaRuntime> {
    const runtime = getSherpaRuntimeForBackend(backend);

    if (!runtime) {
      throw new Error(`No sherpa-onnx runtime is configured for backend "${backend}".`);
    }

    return this.hydrateRuntime(runtime);
  }

  async installRuntime(runtimeId?: string, backend?: SherpaRuntimeBackend): Promise<SherpaRuntime> {
    if (process.platform !== "win32") {
      throw new Error("Managed sherpa-onnx runtime installation is currently Windows-only.");
    }

    const runtime = runtimeId
      ? getSherpaRuntimeById(runtimeId)
      : getSherpaRuntimeForBackend(backend ?? "cpu");

    if (!runtime) {
      throw new Error(`Unknown sherpa-onnx runtime: ${runtimeId ?? backend ?? "cpu"}.`);
    }

    if (!runtime.managed || !runtime.archiveName || !runtime.url) {
      throw new Error(`${runtime.name} is not available as a managed download yet.`);
    }

    const runtimeDirectory = this.getRuntimeDirectory(runtime);
    const archivePath = join(runtimeDirectory, runtime.archiveName);
    const temporaryArchivePath = `${archivePath}.download`;
    const extractDirectory = join(runtimeDirectory, "extract");

    try {
      await mkdir(dirname(archivePath), { recursive: true });
      await rm(extractDirectory, { recursive: true, force: true });
      await mkdir(extractDirectory, { recursive: true });

      const response = await fetch(runtime.url);

      if (!response.ok || !response.body) {
        throw new Error(
          `Failed to download ${runtime.name}: ${String(response.status)} ${response.statusText}`
        );
      }

      await pipeline(
        Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(temporaryArchivePath)
      );
      await rm(archivePath, { force: true });
      await rename(temporaryArchivePath, archivePath);
      await extractTarBz2(archivePath, extractDirectory);

      const installedRuntime = await this.hydrateRuntime(runtime);

      if (!installedRuntime.executablePath) {
        throw new Error(`Installed ${runtime.name}, but no sherpa-onnx-offline.exe was found.`);
      }

      return installedRuntime;
    } catch (error) {
      await rm(extractDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await rm(temporaryArchivePath, { force: true }).catch(() => undefined);
      await rm(archivePath, { force: true }).catch(() => undefined);
    }
  }

  async getExecutablePath(options: {
    allowInstall: boolean;
    backend: SherpaRuntimeBackend;
  }): Promise<string | null> {
    const runtime = await this.getRuntimeForBackend(options.backend);

    if (runtime.executablePath) {
      return runtime.executablePath;
    }

    if (!options.allowInstall) {
      return null;
    }

    return (await this.installRuntime(runtime.id)).executablePath;
  }

  private async hydrateRuntime(runtime: SherpaRuntimeCatalogItem): Promise<SherpaRuntime> {
    const executablePath = await this.findExecutable(runtime);

    return {
      ...runtime,
      executablePath,
      status: executablePath ? "installed" : runtime.managed ? "not-installed" : "unavailable"
    };
  }

  private async findExecutable(runtime: SherpaRuntimeCatalogItem): Promise<string | null> {
    const runtimeDirectory = this.getRuntimeDirectory(runtime);

    for (const candidate of executableCandidates) {
      const found = await findFile(runtimeDirectory, candidate);

      if (found) {
        return found;
      }
    }

    return null;
  }

  private getRuntimeDirectory(runtime: SherpaRuntimeCatalogItem): string {
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
