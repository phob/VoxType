import { app } from "electron";
import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type ActiveWindowInfo,
  type CaptureSessionMuteState,
  type NativeRecordingLevel,
  type NativeRecordingOptions,
  type NativeRecordingDiagnostics,
  type NativeRecordingResult,
  type NativeInputDevice,
  type WindowsMediaOcrResult,
  type ScreenshotCaptureMode,
  type ScreenshotCaptureResult,
  type WindowsHelperStatus
} from "../shared/windows-helper";
import { retainLatestFiles } from "./file-retention";

const execFileAsync = promisify(execFile);
const retainedScreenshotCount = 10;

interface NativeRecording {
  kind: "legacy" | "session";
  child: ChildProcessWithoutNullStreams;
  outputPath: string;
  stdout: Buffer[];
  stderr: Buffer[];
  diagnostics: NativeRecordingDiagnostics;
  onLevel?: (level: NativeRecordingLevel, pcm16Chunk?: Uint8Array) => void;
  session?: NativeRecordingSession;
  stopPromise?: Promise<void>;
  resolveStop?: () => void;
  rejectStop?: (error: Error) => void;
}

interface NativeRecordingSession {
  child: ChildProcessWithoutNullStreams;
  optionsKey: string;
  stdoutRemainder: string;
  stderr: Buffer[];
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  activeRecording: NativeRecording | null;
  readySettled: boolean;
}

export class WindowsHelperService {
  private recording: NativeRecording | null = null;
  private recordingSession: NativeRecordingSession | null = null;

  async getStatus(): Promise<WindowsHelperStatus> {
    const helperPath = await this.resolveHelperPath();
    const helperStats = helperPath ? await stat(helperPath).catch(() => null) : null;

    return {
      available: Boolean(helperPath),
      helperPath,
      helperModifiedAt: helperStats?.mtime.toISOString() ?? null,
      helperCreatedAt: helperStats?.birthtime.toISOString() ?? null,
      helperSizeBytes: helperStats?.size ?? null,
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

    return normalizeActiveWindowInfo(parsed);
  }

  async pasteText(pasteDelayMs = 0): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    await execFileAsync(helperPath, ["paste-text", String(pasteDelayMs)], {
      windowsHide: true
    });
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

  async messageText(
    text: string,
    strategy: "focused-control" | "character-messages",
    hwnd?: string | null
  ): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    const args = ["message-text", strategy];

    if (hwnd) {
      args.push(hwnd);
    }

    await runHelperWithStdin(helperPath, args, text);
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

  async waitForHotkeyRelease(accelerator: string): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    if (!accelerator.trim()) {
      throw new Error("Hold hotkey is empty.");
    }

    await execFileAsync(helperPath, ["wait-hotkey-release", accelerator], {
      windowsHide: true
    });
  }

  async captureScreenshot(
    mode: ScreenshotCaptureMode,
    targetHwnd?: string | null
  ): Promise<ScreenshotCaptureResult> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    const outputDirectory = join(app.getPath("userData"), "screenshots");
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = join(outputDirectory, `screenshot-${String(Date.now())}.png`);
    const args = ["capture-screenshot", outputPath];

    if (mode === "activeWindow") {
      args.push("--active-window");
    }

    if (targetHwnd) {
      args.push("--hwnd", targetHwnd);
    }

    await execFileAsync(helperPath, args, {
      windowsHide: true
    });

    await retainLatestFiles(
      outputDirectory,
      retainedScreenshotCount,
      (fileName) => /^screenshot-\d+\.png$/i.test(fileName)
    );

    return {
      path: outputPath,
      bytes: new Uint8Array(await readFile(outputPath)),
      capturedAt: new Date().toISOString(),
      mode
    };
  }

  async recognizeImageText(imagePath: string): Promise<WindowsMediaOcrResult> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    const { stdout } = await execFileAsync(helperPath, ["ocr-image", imagePath], {
      windowsHide: true
    });
    const parsed = JSON.parse(stdout) as unknown;

    if (!isWindowsMediaOcrResult(parsed)) {
      throw new Error("Windows helper returned an unexpected Windows OCR payload.");
    }

    return parsed;
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

  async listInputDevices(): Promise<NativeInputDevice[]> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    const { stdout } = await execFileAsync(helperPath, ["input-devices"], {
      windowsHide: true
    });
    const parsed = JSON.parse(stdout) as unknown;

    if (!Array.isArray(parsed) || !parsed.every(isNativeInputDevice)) {
      throw new Error("Windows helper returned an unexpected input-devices payload.");
    }

    return parsed;
  }

  async startRecording(
    options: NativeRecordingOptions,
    onLevel?: (level: NativeRecordingLevel, pcm16Chunk?: Uint8Array) => void
  ): Promise<void> {
    if (this.recording) {
      throw new Error("Native recording is already active.");
    }

    if (options.captureMode === "sharedCapture") {
      await this.startSessionRecording(options, onLevel);
      return;
    }

    await this.startLegacyRecording(options, onLevel);
  }

  private async startLegacyRecording(
    options: NativeRecordingOptions,
    onLevel?: (level: NativeRecordingLevel, pcm16Chunk?: Uint8Array) => void
  ): Promise<void> {
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
    const outputPath = join(outputDirectory, `recording-${String(Date.now())}.wav`);
    const vadModelPath = await this.resolveSileroVadModelPath();
    const args = createNativeRecordingArgs("record-wav", options, vadModelPath, outputPath);
    const diagnostics = createNativeRecordingDiagnostics({
      helperPath,
      options,
      vadModelPath
    });

    if (options.vadEnabled) {
      if (!vadModelPath) {
        throw new Error("Silero VAD model was not found.");
      }
    }

    const child = spawn(helperPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    diagnostics.processId = child.pid ?? null;
    logNativeRecordingDiagnostics("started", diagnostics);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutRemainder = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const { complete, remainder } = splitCompleteStdoutLines(`${stdoutRemainder}${chunk.toString("utf8")}`);
      stdoutRemainder = remainder;
      updateNativeRecordingDiagnosticsFromStdout(diagnostics, complete);
      stdout.push(Buffer.from(stripRealtimePcm16ChunkEvents(complete)));
      for (const event of parseRecordingStdoutEvents(complete)) {
        onLevel?.(event.level, event.pcm16Chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostics.stderrByteCount += chunk.byteLength;
      stderr.push(chunk);
    });
    child.once("close", (code, signal) => {
      const complete = stdoutRemainder;
      stdoutRemainder = "";
      updateNativeRecordingDiagnosticsFromStdout(diagnostics, complete);
      stdout.push(Buffer.from(stripRealtimePcm16ChunkEvents(complete)));
      for (const event of parseRecordingStdoutEvents(complete)) {
        onLevel?.(event.level, event.pcm16Chunk);
      }
      diagnostics.exitCode = code;
      diagnostics.signal = signal;
      diagnostics.stoppedAt = new Date().toISOString();
      diagnostics.durationMs = Date.parse(diagnostics.stoppedAt) - Date.parse(diagnostics.startedAt);
    });
    child.once("exit", (code) => {
      if (this.recording?.child === child && code !== null && code !== 0) {
        this.recording = null;
      }
    });

    this.recording = {
      kind: "legacy",
      child,
      outputPath,
      stdout,
      stderr,
      diagnostics,
      onLevel
    };

    try {
      await waitForHelperStartup(child, stdout, stderr);
    } catch (error) {
      if (this.recording.child === child) {
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
        }, onLevel);
      }

      throw error;
    }
  }

  async stopRecording(): Promise<NativeRecordingResult> {
    const recording = this.recording;

    if (!recording) {
      throw new Error("Native recording is not active.");
    }

    if (recording.kind === "session") {
      return this.stopSessionRecording(recording);
    }

    return this.stopLegacyRecording(recording);
  }

  private async stopLegacyRecording(recording: NativeRecording): Promise<NativeRecordingResult> {
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
          `Windows helper exited with code ${String(code)}.`;

        reject(new Error(message));
      });
    });

    const bytes = await readFile(recording.outputPath);
    const metadata = parseNativeRecordingMetadata(
      Buffer.concat(recording.stdout).toString("utf8")
    );
    const diagnostics = {
      ...recording.diagnostics,
      finalWavByteLength: bytes.byteLength,
      finalSampleRate: metadata.sampleRate,
      finalSamples: metadata.samples,
      finalRawSamples: metadata.rawSamples,
      finalSpeechFrames: metadata.speechFrames,
      finalCaptureMode: metadata.captureMode
    };
    logNativeRecordingDiagnostics("stopped", diagnostics);
    await rm(recording.outputPath, { force: true });
    return {
      wavBytes: new Uint8Array(bytes),
      ...metadata,
      diagnostics
    };
  }

  private async startSessionRecording(
    options: NativeRecordingOptions,
    onLevel?: (level: NativeRecordingLevel, pcm16Chunk?: Uint8Array) => void
  ): Promise<void> {
    const helperPath = await this.resolveHelperPath();

    if (!helperPath) {
      throw new Error(
        "Windows helper executable was not found. Build it with `cargo build --manifest-path native/windows-helper/Cargo.toml`."
      );
    }

    const outputDirectory = join(app.getPath("userData"), "native-recordings");
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = join(outputDirectory, `recording-${String(Date.now())}.wav`);
    const vadModelPath = await this.resolveSileroVadModelPath();

    if (options.vadEnabled && !vadModelPath) {
      throw new Error("Silero VAD model was not found.");
    }

    const session = await this.ensureRecordingSession(helperPath, options, vadModelPath);
    const diagnostics = createNativeRecordingDiagnostics({
      helperPath,
      options,
      vadModelPath
    });
    diagnostics.processId = session.child.pid ?? null;

    let resolveStop: (() => void) | undefined;
    let rejectStop: ((error: Error) => void) | undefined;
    const stopPromise = new Promise<void>((resolvePromise, reject) => {
      resolveStop = resolvePromise;
      rejectStop = reject;
    });

    const recording: NativeRecording = {
      kind: "session",
      child: session.child,
      outputPath,
      stdout: [],
      stderr: session.stderr,
      diagnostics,
      onLevel,
      session,
      stopPromise,
      resolveStop,
      rejectStop
    };

    session.activeRecording = recording;
    this.recording = recording;
    logNativeRecordingDiagnostics("started", diagnostics);
    session.child.stdin.write(`${JSON.stringify({ type: "start", outputPath })}\n`, "utf8");
  }

  private async stopSessionRecording(recording: NativeRecording): Promise<NativeRecordingResult> {
    const session = recording.session;

    if (!session || !recording.stopPromise) {
      throw new Error("Native recording session is not active.");
    }

    this.recording = null;
    session.child.stdin.write(`${JSON.stringify({ type: "stop" })}\n`, "utf8");

    try {
      await recording.stopPromise;
    } finally {
      if (session.activeRecording === recording) {
        session.activeRecording = null;
      }
    }

    const bytes = await readFile(recording.outputPath);
    const metadata = parseNativeRecordingMetadata(
      Buffer.concat(recording.stdout).toString("utf8")
    );
    recording.diagnostics.stoppedAt = new Date().toISOString();
    recording.diagnostics.durationMs =
      Date.parse(recording.diagnostics.stoppedAt) - Date.parse(recording.diagnostics.startedAt);
    const diagnostics = {
      ...recording.diagnostics,
      finalWavByteLength: bytes.byteLength,
      finalSampleRate: metadata.sampleRate,
      finalSamples: metadata.samples,
      finalRawSamples: metadata.rawSamples,
      finalSpeechFrames: metadata.speechFrames,
      finalCaptureMode: metadata.captureMode
    };
    logNativeRecordingDiagnostics("stopped", diagnostics);
    await rm(recording.outputPath, { force: true });
    return {
      wavBytes: new Uint8Array(bytes),
      ...metadata,
      diagnostics
    };
  }

  private async ensureRecordingSession(
    helperPath: string,
    options: NativeRecordingOptions,
    vadModelPath: string | null
  ): Promise<NativeRecordingSession> {
    const optionsKey = createRecordingSessionKey(helperPath, options, vadModelPath);

    if (this.recordingSession?.optionsKey === optionsKey) {
      await this.recordingSession.ready;
      return this.recordingSession;
    }

    await this.shutdownRecordingSession();

    const args = createNativeRecordingArgs("record-wav-session", options, vadModelPath);
    const child = spawn(helperPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let resolveReady: (() => void) | undefined;
    let rejectReady: ((error: Error) => void) | undefined;
    const ready = new Promise<void>((resolvePromise, reject) => {
      resolveReady = resolvePromise;
      rejectReady = reject;
    });
    const session: NativeRecordingSession = {
      child,
      optionsKey,
      stdoutRemainder: "",
      stderr: [],
      ready,
      resolveReady: () => {
        session.readySettled = true;
        resolveReady?.();
      },
      rejectReady: (error: Error) => {
        session.readySettled = true;
        rejectReady?.(error);
      },
      activeRecording: null,
      readySettled: false
    };

    child.stdout.on("data", (chunk: Buffer) => {
      this.handleRecordingSessionStdout(session, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      session.stderr.push(chunk);
      if (session.activeRecording) {
        session.activeRecording.diagnostics.stderrByteCount += chunk.byteLength;
      }
    });
    child.once("error", (error) => {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      if (!session.readySettled) {
        session.rejectReady(wrapped);
      }
      session.activeRecording?.rejectStop?.(wrapped);
    });
    child.once("close", (code, signal) => {
      const complete = session.stdoutRemainder;
      session.stdoutRemainder = "";
      if (complete) {
        this.handleRecordingSessionStdout(session, Buffer.from(`${complete}\n`));
      }

      const message =
        Buffer.concat(session.stderr).toString("utf8").trim() ||
        `Windows helper recording session exited with code ${String(code)}.`;
      const error = new Error(message);

      if (!session.readySettled) {
        session.rejectReady(error);
      }
      if (session.activeRecording) {
        session.activeRecording.diagnostics.exitCode = code;
        session.activeRecording.diagnostics.signal = signal;
        session.activeRecording.diagnostics.stoppedAt = new Date().toISOString();
        session.activeRecording.diagnostics.durationMs =
          Date.parse(session.activeRecording.diagnostics.stoppedAt) -
          Date.parse(session.activeRecording.diagnostics.startedAt);
        session.activeRecording.rejectStop?.(error);
      }
      if (this.recordingSession === session) {
        this.recordingSession = null;
      }
      if (this.recording?.session === session) {
        this.recording = null;
      }
    });

    this.recordingSession = session;
    await session.ready;
    return session;
  }

  private async shutdownRecordingSession(): Promise<void> {
    const session = this.recordingSession;

    if (!session) {
      return;
    }

    this.recordingSession = null;
    session.child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`, "utf8");
    session.child.stdin.end();

    await new Promise<void>((resolvePromise) => {
      const timeout = setTimeout(() => {
        session.child.kill();
        resolvePromise();
      }, 1000);
      session.child.once("close", () => {
        clearTimeout(timeout);
        resolvePromise();
      });
    });
  }

  private handleRecordingSessionStdout(
    session: NativeRecordingSession,
    chunk: Buffer
  ): void {
    const { complete, remainder } = splitCompleteStdoutLines(
      `${session.stdoutRemainder}${chunk.toString("utf8")}`
    );
    session.stdoutRemainder = remainder;

    if (!complete) {
      return;
    }

    const recording = session.activeRecording;

    if (recording) {
      updateNativeRecordingDiagnosticsFromStdout(recording.diagnostics, complete);
      recording.stdout.push(Buffer.from(stripRealtimePcm16ChunkEvents(complete)));
      for (const event of parseRecordingStdoutEvents(complete)) {
        recording.onLevel?.(event.level, event.pcm16Chunk);
      }
    }

    for (const line of complete.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        if (parsed.type === "recordingReady") {
          if (!session.readySettled) {
            session.resolveReady();
          }
          continue;
        }

        if (parsed.type === "recordingError" && typeof parsed.error === "string") {
          const error = new Error(parsed.error);
          if (recording) {
            recording.rejectStop?.(error);
          } else if (!session.readySettled) {
            session.rejectReady(error);
          }
          continue;
        }

        if (recording && isNativeRecordingMetadata(parsed)) {
          recording.resolveStop?.();
        }
      } catch {
        continue;
      }
    }
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

function isWindowsMediaOcrResult(value: unknown): value is WindowsMediaOcrResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const result = value as Record<string, unknown>;

  return (
    result.provider === "windowsMediaOcr" &&
    typeof result.engine === "string" &&
    typeof result.imagePath === "string" &&
    typeof result.text === "string" &&
    typeof result.durationMs === "number" &&
    Array.isArray(result.lines) &&
    result.lines.every((line) => {
      if (typeof line !== "object" || line === null || Array.isArray(line)) {
        return false;
      }

      const entry = line as Record<string, unknown>;

      return (
        typeof entry.text === "string" &&
        (typeof entry.confidence === "number" || entry.confidence === null) &&
        (entry.box === null ||
          (Array.isArray(entry.box) &&
            entry.box.length === 4 &&
            entry.box.every((item) => typeof item === "number")))
      );
    })
  );
}

function msToVadFrames(milliseconds: number): number {
  return Math.max(0, Math.round(milliseconds / 30));
}

function createNativeRecordingArgs(
  command: "record-wav" | "record-wav-session",
  options: NativeRecordingOptions,
  vadModelPath: string | null,
  outputPath?: string
): string[] {
  const args = outputPath ? [command, outputPath] : [command];
  const captureModeArg = nativeCaptureModeArg(options.captureMode);

  if (captureModeArg) {
    args.push("--capture-mode", captureModeArg);
  }

  if (options.inputDeviceId && options.inputDeviceId !== "default") {
    args.push("--input-device", options.inputDeviceId);
  }

  if (options.realtimePcm16Enabled) {
    args.push("--emit-realtime-pcm16");
  }

  if (options.vadEnabled && vadModelPath) {
    args.push(
      "--vad-model",
      vadModelPath,
      "--vad-threshold",
      String(options.vadPositiveSpeechThreshold),
      "--vad-prefill-frames",
      String(msToVadFrames(options.vadPreSpeechPadMs)),
      "--vad-hangover-frames",
      String(msToVadFrames(options.vadRedemptionMs)),
      "--vad-preserved-pause-frames",
      String(msToVadFrames(options.vadPreservedPauseMs)),
      "--vad-onset-frames",
      "2"
    );
  }

  return args;
}

function createRecordingSessionKey(
  helperPath: string,
  options: NativeRecordingOptions,
  vadModelPath: string | null
): string {
  return JSON.stringify({
    helperPath,
    captureMode: options.captureMode,
    inputDeviceId: options.inputDeviceId,
    realtimePcm16Enabled: options.realtimePcm16Enabled,
    vadEnabled: options.vadEnabled,
    vadModelPath,
    vadPositiveSpeechThreshold: options.vadPositiveSpeechThreshold,
    vadPreSpeechPadMs: options.vadPreSpeechPadMs,
    vadRedemptionMs: options.vadRedemptionMs,
    vadPreservedPauseMs: options.vadPreservedPauseMs
  });
}

function createNativeRecordingDiagnostics({
  helperPath,
  options,
  vadModelPath
}: {
  helperPath: string;
  options: NativeRecordingOptions;
  vadModelPath: string | null;
}): NativeRecordingDiagnostics {
  return {
    helperPath,
    processId: null,
    requestedCaptureMode: options.captureMode,
    requestedInputDevice: options.inputDeviceId && options.inputDeviceId !== "default" ? "custom" : "default",
    vadRequested: options.vadEnabled,
    realtimePcm16Requested: options.realtimePcm16Enabled,
    vadModelResolved: Boolean(vadModelPath),
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    stdoutLineCount: 0,
    stdoutJsonLineCount: 0,
    stdoutUnparsedLineCount: 0,
    recordingLevelCount: 0,
    realtimePcm16ChunkCount: 0,
    realtimePcm16ByteCount: 0,
    realtimePcm16InvalidChunkCount: 0,
    otherJsonEventCount: 0,
    stderrByteCount: 0,
    finalWavByteLength: null,
    finalSampleRate: null,
    finalSamples: null,
    finalRawSamples: null,
    finalSpeechFrames: null,
    finalCaptureMode: null
  };
}

function updateNativeRecordingDiagnosticsFromStdout(
  diagnostics: NativeRecordingDiagnostics,
  stdout: string
): void {
  for (const line of stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    diagnostics.stdoutLineCount += 1;

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      diagnostics.stdoutJsonLineCount += 1;

      if (parsed.type === "recordingLevel") {
        diagnostics.recordingLevelCount += 1;
        continue;
      }

      if (parsed.type === "realtimePcm16Chunk") {
        if (
          parsed.encoding === "pcm16" &&
          parsed.sampleRateHz === 24000 &&
          parsed.channelCount === 1 &&
          typeof parsed.audioBase64 === "string"
        ) {
          const byteLength = Buffer.byteLength(parsed.audioBase64, "base64");

          if (byteLength > 0 && byteLength % 2 === 0) {
            diagnostics.realtimePcm16ChunkCount += 1;
            diagnostics.realtimePcm16ByteCount += byteLength;
            continue;
          }
        }

        diagnostics.realtimePcm16InvalidChunkCount += 1;
        continue;
      }

      if (typeof parsed.type === "string") {
        diagnostics.otherJsonEventCount += 1;
      }
    } catch {
      diagnostics.stdoutUnparsedLineCount += 1;
    }
  }
}

function logNativeRecordingDiagnostics(
  stage: "started" | "stopped",
  diagnostics: NativeRecordingDiagnostics
): void {
  console.info("[voxtype] native recording diagnostics", {
    stage,
    helperPath: diagnostics.helperPath,
    processId: diagnostics.processId,
    requestedCaptureMode: diagnostics.requestedCaptureMode,
    requestedInputDevice: diagnostics.requestedInputDevice,
    vadRequested: diagnostics.vadRequested,
    realtimePcm16Requested: diagnostics.realtimePcm16Requested,
    vadModelResolved: diagnostics.vadModelResolved,
    durationMs: diagnostics.durationMs,
    exitCode: diagnostics.exitCode,
    signal: diagnostics.signal,
    stdoutLineCount: diagnostics.stdoutLineCount,
    stdoutJsonLineCount: diagnostics.stdoutJsonLineCount,
    stdoutUnparsedLineCount: diagnostics.stdoutUnparsedLineCount,
    recordingLevelCount: diagnostics.recordingLevelCount,
    realtimePcm16ChunkCount: diagnostics.realtimePcm16ChunkCount,
    realtimePcm16ByteCount: diagnostics.realtimePcm16ByteCount,
    realtimePcm16InvalidChunkCount: diagnostics.realtimePcm16InvalidChunkCount,
    otherJsonEventCount: diagnostics.otherJsonEventCount,
    stderrByteCount: diagnostics.stderrByteCount,
    finalWavByteLength: diagnostics.finalWavByteLength,
    finalSampleRate: diagnostics.finalSampleRate,
    finalSamples: diagnostics.finalSamples,
    finalRawSamples: diagnostics.finalRawSamples,
    finalSpeechFrames: diagnostics.finalSpeechFrames,
    finalCaptureMode: diagnostics.finalCaptureMode
  });
}

function parseNativeRecordingMetadata(stdout: string): Omit<NativeRecordingResult, "wavBytes" | "diagnostics"> {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => Boolean(item) && !isRecordingLevelLine(item))
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

function isNativeRecordingMetadata(parsed: Record<string, unknown>): boolean {
  return (
    typeof parsed.sampleRate === "number" &&
    typeof parsed.samples === "number" &&
    typeof parsed.rawSamples === "number" &&
    typeof parsed.vadEnabled === "boolean" &&
    (parsed.captureMode === "sharedCapture" || parsed.captureMode === "exclusiveCapture") &&
    typeof parsed.speechFrames === "number"
  );
}

function splitCompleteStdoutLines(stdout: string): { complete: string; remainder: string } {
  const lastNewlineIndex = Math.max(stdout.lastIndexOf("\n"), stdout.lastIndexOf("\r"));

  if (lastNewlineIndex < 0) {
    return { complete: "", remainder: stdout };
  }

  return {
    complete: stdout.slice(0, lastNewlineIndex + 1),
    remainder: stdout.slice(lastNewlineIndex + 1)
  };
}

function stripRealtimePcm16ChunkEvents(stdout: string): string {
  const stripped = stdout
    .split(/\r?\n/)
    .filter((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return parsed.type !== "realtimePcm16Chunk";
      } catch {
        return true;
      }
    })
    .join("\n");

  if (!stripped) {
    return "";
  }

  return /[\r\n]$/.test(stdout) ? `${stripped}\n` : stripped;
}

function parseRecordingStdoutEvents(stdout: string): {
  level: NativeRecordingLevel;
  pcm16Chunk?: Uint8Array;
}[] {
  return stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        if (parsed.type === "recordingLevel") {
          return [{
            level: {
              rms: typeof parsed.rms === "number" ? clamp01(parsed.rms) : 0,
              peak: typeof parsed.peak === "number" ? clamp01(parsed.peak) : 0
            }
          }];
        }

        if (
          parsed.type === "realtimePcm16Chunk" &&
          parsed.encoding === "pcm16" &&
          parsed.sampleRateHz === 24000 &&
          parsed.channelCount === 1 &&
          typeof parsed.audioBase64 === "string"
        ) {
          const pcm16Chunk = new Uint8Array(Buffer.from(parsed.audioBase64, "base64"));

          if (pcm16Chunk.byteLength === 0 || pcm16Chunk.byteLength % 2 !== 0) {
            return [];
          }

          return [{
            level: { rms: 0, peak: 0 },
            pcm16Chunk
          }];
        }
      } catch {
        return [];
      }

      return [];
    });
}

function isRecordingLevelLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return parsed.type === "recordingLevel";
  } catch {
    return false;
  }
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
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
        `Windows helper exited before recording started with code ${String(code)}.`;

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
        `Windows helper exited with code ${String(code)}.`;

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
    (typeof info.processName === "string" || info.processName === null) &&
    (info.bounds === undefined || info.bounds === null || isWindowBounds(info.bounds)) &&
    (info.fullscreen === undefined || typeof info.fullscreen === "boolean")
  );
}

function normalizeActiveWindowInfo(value: ActiveWindowInfo): ActiveWindowInfo {
  return {
    ...value,
    bounds: value.bounds ?? null,
    fullscreen: value.fullscreen
  };
}

function isWindowBounds(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const bounds = value as Record<string, unknown>;

  return (
    typeof bounds.left === "number" &&
    typeof bounds.top === "number" &&
    typeof bounds.right === "number" &&
    typeof bounds.bottom === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number"
  );
}

function isNativeInputDevice(value: unknown): value is NativeInputDevice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const device = value as Record<string, unknown>;

  return (
    typeof device.id === "string" &&
    typeof device.name === "string" &&
    typeof device.isDefault === "boolean"
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
