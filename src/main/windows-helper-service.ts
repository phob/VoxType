import { app } from "electron";
import { execFile, spawn } from "node:child_process";
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

  async pasteText(text: string): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    await runHelperWithStdin(helperPath, ["paste-text"], text);
  }

  async typeText(text: string, delayMs: number): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    await runHelperWithStdin(helperPath, ["type-text", String(delayMs)], text);
  }

  async focusWindow(hwnd: string): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    await execFileAsync(helperPath, ["focus-window", hwnd], {
      windowsHide: true
    });
  }

  async setSystemMute(muted: boolean): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    await execFileAsync(helperPath, ["set-system-mute", muted ? "true" : "false"], {
      windowsHide: true
    });
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

function runHelperWithStdin(
  helperPath: string,
  args: string[],
  stdin: string
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(helperPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const message =
        Buffer.concat(stdout).toString("utf8").trim() ||
        Buffer.concat(stderr).toString("utf8").trim() ||
        `Windows helper exited with code ${code}.`;

      reject(new Error(message));
    });

    child.stdin.end(stdin, "utf8");
  });
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
