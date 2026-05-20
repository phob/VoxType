import { app } from "electron";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { deleteMatchingFiles } from "./file-retention";

const chromiumCleanupDirectories = [
  "blob_storage",
  "Cache",
  "Code Cache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUCache",
  "Local Storage",
  "Session Storage"
];

export async function cleanupStartupStorage(): Promise<void> {
  const userDataPath = app.getPath("userData");

  await Promise.all([
    ...chromiumCleanupDirectories.map((directory) =>
      rm(join(userDataPath, directory), { recursive: true, force: true }).catch(() => undefined)
    ),
    deleteMatchingFiles(join(userDataPath, "models"), isPartialDownloadFile),
    deleteMatchingFiles(join(userDataPath, "native-recordings"), (fileName) =>
      /^recording-\d+\.wav$/i.test(fileName)
    ),
    deleteMatchingFiles(
      join(userDataPath, "runtimes"),
      (fileName) => isPartialDownloadFile(fileName) || /\.zip$/i.test(fileName)
    ),
    deleteMatchingFiles(join(userDataPath, "updates"), isPartialDownloadFile)
  ]);
}

function isPartialDownloadFile(fileName: string): boolean {
  return /\.(download|tmp)$/i.test(fileName);
}
