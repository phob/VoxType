import { app } from "electron";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  type WhisperRuntime,
  whisperRuntimeCatalog
} from "../shared/runtimes";

const execFileAsync = promisify(execFile);
const executableCandidates = ["whisper-cli.exe", "main.exe"];

export class RuntimeService {
  private readonly runtimeDirectory: string;

  constructor() {
    this.runtimeDirectory = join(
      app.getPath("userData"),
      "runtimes",
      "whisper.cpp",
      whisperRuntimeCatalog.version,
      whisperRuntimeCatalog.id
    );
  }

  async getWhisperRuntime(): Promise<WhisperRuntime> {
    const executablePath = await this.findExecutable();

    return {
      ...whisperRuntimeCatalog,
      executablePath,
      status: executablePath ? "installed" : "not-installed"
    };
  }

  async installWhisperRuntime(): Promise<WhisperRuntime> {
    if (process.platform !== "win32") {
      throw new Error("Managed whisper.cpp runtime installation is currently Windows-only.");
    }

    const archivePath = join(this.runtimeDirectory, whisperRuntimeCatalog.archiveName);
    const temporaryArchivePath = `${archivePath}.download`;
    const extractDirectory = join(this.runtimeDirectory, "extract");

    await mkdir(dirname(archivePath), { recursive: true });
    await rm(extractDirectory, { recursive: true, force: true });
    await mkdir(extractDirectory, { recursive: true });

    const response = await fetch(whisperRuntimeCatalog.url);

    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to download ${whisperRuntimeCatalog.name}: ${response.status} ${response.statusText}`
      );
    }

    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      createWriteStream(temporaryArchivePath)
    );
    await rm(archivePath, { force: true });
    await rename(temporaryArchivePath, archivePath);
    await this.expandArchive(archivePath, extractDirectory);

    const runtime = await this.getWhisperRuntime();

    if (!runtime.executablePath) {
      throw new Error("Installed whisper.cpp runtime, but no whisper-cli.exe was found.");
    }

    return runtime;
  }

  async getExecutablePath(options: { allowInstall: boolean }): Promise<string | null> {
    const runtime = await this.getWhisperRuntime();

    if (runtime.executablePath) {
      return runtime.executablePath;
    }

    if (!options.allowInstall) {
      return null;
    }

    return (await this.installWhisperRuntime()).executablePath;
  }

  private async expandArchive(archivePath: string, destination: string): Promise<void> {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      archivePath,
      destination
    ]);
  }

  private async findExecutable(): Promise<string | null> {
    for (const candidate of executableCandidates) {
      const found = await findFile(this.runtimeDirectory, candidate);

      if (found) {
        return found;
      }
    }

    return null;
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

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

