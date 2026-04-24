import { app } from "electron";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type ActiveWindowInfo,
  type WindowsHelperStatus
} from "../shared/windows-helper";

const execFileAsync = promisify(execFile);

export class WindowsHelperService {
  async getStatus(): Promise<WindowsHelperStatus> {
    const helperPath = await this.resolveHelperPath();

    return {
      available: Boolean(helperPath),
      helperPath,
      error: helperPath ? null : "Windows helper executable was not found."
    };
  }

  async getActiveWindow(): Promise<ActiveWindowInfo> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    const { stdout } = await execFileAsync(helperPath, ["active-window"], {
      windowsHide: true
    });
    const parsed = JSON.parse(stdout) as unknown;

    if (!isActiveWindowInfo(parsed)) {
      throw new Error("Windows helper returned an unexpected active-window payload.");
    }

    return parsed;
  }

  private async resolveHelperPath(): Promise<string | null> {
    const candidates = [
      process.env.VOXTYPE_WINDOWS_HELPER_PATH,
      resolve("native/windows-helper/target/debug/voxtype-windows-helper.exe"),
      resolve("native/windows-helper/target/release/voxtype-windows-helper.exe"),
      join(process.resourcesPath, "native", "voxtype-windows-helper.exe"),
      join(app.getAppPath(), "native", "voxtype-windows-helper.exe")
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isActiveWindowInfo(value: unknown): value is ActiveWindowInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const info = value as Record<string, unknown>;

  return (
    typeof info.hwnd === "string" &&
    typeof info.title === "string" &&
    typeof info.processId === "number" &&
    (typeof info.processPath === "string" || info.processPath === null) &&
    (typeof info.processName === "string" || info.processName === null)
  );
}

