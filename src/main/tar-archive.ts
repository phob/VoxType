import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The sherpa-onnx runtime binaries and the Parakeet model bundle are shipped as
// `.tar.bz2`, which PowerShell's `Expand-Archive` (Zip-only) cannot read. Windows
// 10 1803+ / Windows 11 ship `tar.exe` (bsdtar/libarchive) in System32, which
// extracts bzip2 tarballs natively — no bundled extractor required
// (planning/parakeet-phase1-plan.md Step 0.2).
export async function extractTarBz2(archivePath: string, destination: string): Promise<void> {
  try {
    await execFileAsync("tar", ["-xf", archivePath, "-C", destination]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to extract archive "${archivePath}" with the system tar.exe. ${detail}`,
      { cause: error }
    );
  }
}
