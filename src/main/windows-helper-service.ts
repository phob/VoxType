import { app } from "electron";
import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type ActiveWindowInfo,
  type CaptureSessionMuteState,
  type NativeRecordingOptions,
  type NativeRecordingResult,
  type WindowsHelperStatus
} from "../shared/windows-helper";

const execFileAsync = promisify(execFile);

type NativeRecording = {
  child: ChildProcessWithoutNullStreams;
  outputPath: string;
  stdout: Buffer[];
  stderr: Buffer[];
};

export class WindowsHelperService {
  private recording: NativeRecording | null = null;

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

  async sendHotkey(accelerator: string): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    if (!accelerator.trim()) {
      throw new Error("Recording coordination hotkey is empty.");
    }

    await execFileAsync(helperPath, ["send-hotkey", accelerator], {
      windowsHide: true
    });
  }

  async muteCaptureSession(
    processId: number,
    processName?: string | null
  ): Promise<CaptureSessionMuteState> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    const args = ["mute-capture-session", String(processId)];

    if (processName) {
      args.push(processName);
    }

    const { stdout } = await execFileAsync(helperPath, args, {
      windowsHide: true
    });
    const parsed = JSON.parse(stdout) as unknown;

    if (!isCaptureSessionMuteState(parsed)) {
      throw new Error("Windows helper returned an unexpected capture-session mute payload.");
    }

    return parsed;
  }

  async restoreCaptureSession(state: CaptureSessionMuteState): Promise<void> {
    if (state.sessions.length === 0) {
      return;
    }

    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    await runHelperWithStdin(helperPath, ["restore-capture-session"], JSON.stringify(state));
  }

  async startRecording(options: NativeRecordingOptions): Promise<void> {
    if (this.recording) {
      throw new Error("Native recording is already active.");
    }

    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    const outputDirectory = join(app.getPath("userData"), "native-recordings");
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = join(outputDirectory, `recording-${Date.now()}.wav`);
    const args = ["record-wav", outputPath];
    const vadModelPath = await this.resolveSileroVadModelPath();
    const captureModeArg = nativeCaptureModeArg(options.captureMode);

    if (captureModeArg) {
      args.push("--capture-mode", captureModeArg);
    }

    if (options.vadEnabled) {
      if (!vadModelPath) {
        throw new Error("Silero VAD model was not found.");
      }

      args.push(
        "--vad-model",
        vadModelPath,
        "--vad-threshold",
        String(options.vadPositiveSpeechThreshold),
        "--vad-prefill-frames",
        String(msToVadFrames(options.vadPreSpeechPadMs)),
        "--vad-hangover-frames",
        String(msToVadFrames(options.vadRedemptionMs)),
        "--vad-onset-frames",
        "2"
      );
    }

    const child = spawn(helperPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("exit", (code) => {
      if (this.recording?.child === child && code !== null && code !== 0) {
        this.recording = null;
      }
    });

    this.recording = {
      child,
      outputPath,
      stdout,
      stderr
    };

    try {
      await waitForHelperStartup(child, stdout, stderr);
    } catch (error) {
      if (this.recording?.child === child) {
        this.recording = null;
      }

      child.kill();
      await rm(outputPath, { force: true });

      if (
        options.captureMode === "exclusiveCapturePreferred" &&
        errorMessage(error).includes("Exclusive microphone capture failed")
      ) {
        return this.startRecording({
          ...options,
          captureMode: "sharedCapture"
        });
      }

      throw error;
    }
  }

  async stopRecording(): Promise<NativeRecordingResult> {
    const recording = this.recording;

    if (!recording) {
      throw new Error("Native recording is not active.");
    }

    this.recording = null;
    recording.child.stdin.end("stop\n", "utf8");

    await new Promise<void>((resolvePromise, reject) => {
      recording.child.once("error", reject);
      recording.child.once("close", (code) => {
        if (code === 0) {
          resolvePromise();
          return;
        }

        const message =
          Buffer.concat(recording.stdout).toString("utf8").trim() ||
          Buffer.concat(recording.stderr).toString("utf8").trim() ||
          `Windows helper exited with code ${code}.`;

        reject(new Error(message));
      });
    });

    const bytes = await readFile(recording.outputPath);
    const metadata = parseNativeRecordingMetadata(
      Buffer.concat(recording.stdout).toString("utf8")
    );
    await rm(recording.outputPath, { force: true });
    return {
      wavBytes: new Uint8Array(bytes),
      ...metadata
    };
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

  private async resolveSileroVadModelPath(): Promise<string | null> {
    const candidates = [
      process.env.VOXTYPE_SILERO_VAD_MODEL_PATH,
      resolve("resources/models/silero_vad_v4.onnx"),
      join(process.resourcesPath, "models", "silero_vad_v4.onnx"),
      join(app.getAppPath(), "resources", "models", "silero_vad_v4.onnx")
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}

function msToVadFrames(milliseconds: number): number {
  return Math.max(0, Math.round(milliseconds / 30));
}

function parseNativeRecordingMetadata(stdout: string): Omit<NativeRecordingResult, "wavBytes"> {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1);

  if (!line) {
    throw new Error("Windows helper did not return recording metadata.");
  }

  const parsed = JSON.parse(line) as Record<string, unknown>;

  return {
    sampleRate: typeof parsed.sampleRate === "number" ? parsed.sampleRate : 16000,
    samples: typeof parsed.samples === "number" ? parsed.samples : 0,
    rawSamples: typeof parsed.rawSamples === "number" ? parsed.rawSamples : 0,
    vadEnabled: typeof parsed.vadEnabled === "boolean" ? parsed.vadEnabled : false,
    captureMode:
      parsed.captureMode === "exclusiveCapture" ? "exclusiveCapture" : "sharedCapture",
    speechFrames: typeof parsed.speechFrames === "number" ? parsed.speechFrames : 0
  };
}

function nativeCaptureModeArg(mode: NativeRecordingOptions["captureMode"]): string | null {
  if (mode === "exclusiveCapturePreferred") {
    return "exclusive-preferred";
  }

  if (mode === "exclusiveCaptureRequired") {
    return "exclusive-required";
  }

  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForHelperStartup(
  child: ChildProcessWithoutNullStreams,
  stdout: Buffer[],
  stderr: Buffer[]
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const startupTimeout = setTimeout(() => {
      cleanup();
      resolvePromise();
    }, 250);

    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const handleExit = (code: number | null): void => {
      cleanup();
      const message =
        Buffer.concat(stdout).toString("utf8").trim() ||
        Buffer.concat(stderr).toString("utf8").trim() ||
        `Windows helper exited before recording started with code ${code}.`;

      reject(new Error(message));
    };

    const cleanup = (): void => {
      clearTimeout(startupTimeout);
      child.off("error", handleError);
      child.off("exit", handleExit);
    };

    child.once("error", handleError);
    child.once("exit", handleExit);
  });
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

function isCaptureSessionMuteState(value: unknown): value is CaptureSessionMuteState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const state = value as Record<string, unknown>;

  return (
    Array.isArray(state.sessions) &&
    state.sessions.every((session) => {
      if (typeof session !== "object" || session === null || Array.isArray(session)) {
        return false;
      }

      const entry = session as Record<string, unknown>;

      return (
        typeof entry.sessionInstanceIdentifier === "string" &&
        typeof entry.processId === "number" &&
        (typeof entry.processName === "string" || entry.processName === null) &&
        typeof entry.mutedBefore === "boolean"
      );
    })
  );
}
