// Downloads a release zip and expands it into a clean directory. Shared by the managed whisper.cpp
// and llama.cpp runtimes, which both ship as official Windows zips on GitHub releases.
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function downloadFile(url: string, destination: string, label: string): Promise<void> {
  const temporaryPath = `${destination}.download`;

  try {
    const response = await fetch(url);

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${label}: ${String(response.status)} ${response.statusText}`);
    }

    await pipeline(
      // Node's web ReadableStream type differs from the DOM one fetch() is typed with; same object at runtime.
      Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(temporaryPath)
    );
    await rm(destination, { force: true });
    await rename(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/** Downloads `url` and expands it into `extractDirectory`, which is emptied first and removed on failure. */
export async function downloadAndExpandZip(input: {
  url: string;
  archiveName: string;
  runtimeDirectory: string;
  extractDirectory: string;
  label: string;
}): Promise<void> {
  const archivePath = join(input.runtimeDirectory, input.archiveName);

  try {
    await mkdir(input.runtimeDirectory, { recursive: true });
    await rm(input.extractDirectory, { recursive: true, force: true });
    await mkdir(input.extractDirectory, { recursive: true });
    await downloadFile(input.url, archivePath, input.label);
    await expandZip(archivePath, input.extractDirectory);
  } catch (error) {
    await rm(input.extractDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(archivePath, { force: true }).catch(() => undefined);
  }
}

async function expandZip(archivePath: string, destination: string): Promise<void> {
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

export async function findFile(directory: string, fileName: string): Promise<string | null> {
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
