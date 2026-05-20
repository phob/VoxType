import { type OcrPromptContext } from "./ocr-context";
import { type TranscriptTurn } from "./asr";

export interface ActiveWindowInfo {
  hwnd: string;
  title: string;
  processId: number;
  processPath: string | null;
  processName: string | null;
  bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  fullscreen: boolean;
}

export interface WindowsHelperStatus {
  available: boolean;
  helperPath: string | null;
  helperModifiedAt: string | null;
  helperCreatedAt: string | null;
  helperSizeBytes: number | null;
  error: string | null;
}

export type ScreenshotCaptureMode = "screen" | "activeWindow";

export interface ScreenshotCaptureResult {
  path: string;
  bytes: Uint8Array;
  capturedAt: string;
  mode: ScreenshotCaptureMode;
}

export interface WindowsMediaOcrLine {
  text: string;
  confidence: number | null;
  box: [number, number, number, number] | null;
}

export interface WindowsMediaOcrResult {
  provider: "windowsMediaOcr";
  engine: string;
  imagePath: string;
  text: string;
  lines: WindowsMediaOcrLine[];
  durationMs: number;
}

export interface NativeRecordingOptions {
  captureMode: "sharedCapture" | "exclusiveCapturePreferred" | "exclusiveCaptureRequired";
  inputDeviceId: string;
  vadEnabled: boolean;
  vadPositiveSpeechThreshold: number;
  vadPreSpeechPadMs: number;
  vadRedemptionMs: number;
  vadPreservedPauseMs: number;
}

export interface NativeInputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface NativeRecordingResult {
  wavBytes: Uint8Array;
  sampleRate: number;
  samples: number;
  rawSamples: number;
  vadEnabled: boolean;
  captureMode: "sharedCapture" | "exclusiveCapture";
  speechFrames: number;
  diagnostics: NativeRecordingDiagnostics;
}

export interface NativeRecordingLevel {
  rms: number;
  peak: number;
}

export interface NativeRecordingDiagnostics {
  helperPath: string;
  processId: number | null;
  requestedCaptureMode: NativeRecordingOptions["captureMode"];
  requestedInputDevice: "default" | "custom";
  vadRequested: boolean;
  vadModelResolved: boolean;
  startedAt: string;
  stoppedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  signal: string | null;
  stdoutLineCount: number;
  stdoutJsonLineCount: number;
  stdoutUnparsedLineCount: number;
  recordingLevelCount: number;
  realtimePcm16ChunkCount: number;
  realtimePcm16ByteCount: number;
  realtimePcm16InvalidChunkCount: number;
  otherJsonEventCount: number;
  stderrByteCount: number;
  finalWavByteLength: number | null;
  finalSampleRate: number | null;
  finalSamples: number | null;
  finalRawSamples: number | null;
  finalSpeechFrames: number | null;
  finalCaptureMode: "sharedCapture" | "exclusiveCapture" | null;
}

export interface RecordingOverlayState {
  visible: boolean;
  mode: "recording" | "transcribing" | "finalizing";
  level: number;
  message: string;
  cloudProviderLabel?: string;
  elapsedMs?: number;
  livePreviewTurns?: TranscriptTurn[];
}

export interface CaptureSessionMuteEntry {
  sessionInstanceIdentifier: string;
  processId: number;
  processName: string | null;
  mutedBefore: boolean;
}

export interface CaptureSessionMuteState {
  sessions: CaptureSessionMuteEntry[];
}

export interface DictationHotkeyPayload {
  sessionId: number;
  target: ActiveWindowInfo | null;
  ocrContext: OcrPromptContext | null;
}

export interface DictationOcrContextPayload {
  sessionId: number;
  ocrContext: OcrPromptContext | null;
}

export interface DictationHotkeyState {
  recording: boolean;
  sessionId: number;
  target: ActiveWindowInfo | null;
  ocrContext: OcrPromptContext | null;
}
