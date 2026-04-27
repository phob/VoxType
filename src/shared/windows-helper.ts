import { type OcrPromptContext } from "./ocr-context";

export type ActiveWindowInfo = {
  hwnd: string;
  title: string;
  processId: number;
  processPath: string | null;
  processName: string | null;
};

export type WindowsHelperStatus = {
  available: boolean;
  helperPath: string | null;
  helperModifiedAt: string | null;
  helperCreatedAt: string | null;
  helperSizeBytes: number | null;
  error: string | null;
};

export type ScreenshotCaptureMode = "screen" | "activeWindow";

export type ScreenshotCaptureResult = {
  path: string;
  bytes: Uint8Array;
  capturedAt: string;
  mode: ScreenshotCaptureMode;
};

export type WindowsMediaOcrLine = {
  text: string;
  confidence: number | null;
  box: [number, number, number, number] | null;
};

export type WindowsMediaOcrResult = {
  provider: "windowsMediaOcr";
  engine: string;
  imagePath: string;
  text: string;
  lines: WindowsMediaOcrLine[];
  durationMs: number;
};

export type NativeRecordingOptions = {
  captureMode: "sharedCapture" | "exclusiveCapturePreferred" | "exclusiveCaptureRequired";
  vadEnabled: boolean;
  vadPositiveSpeechThreshold: number;
  vadPreSpeechPadMs: number;
  vadRedemptionMs: number;
};

export type NativeRecordingResult = {
  wavBytes: Uint8Array;
  sampleRate: number;
  samples: number;
  rawSamples: number;
  vadEnabled: boolean;
  captureMode: "sharedCapture" | "exclusiveCapture";
  speechFrames: number;
};

export type NativeRecordingLevel = {
  rms: number;
  peak: number;
};

export type RecordingOverlayState = {
  visible: boolean;
  mode: "recording" | "transcribing";
  level: number;
  message: string;
};

export type CaptureSessionMuteEntry = {
  sessionInstanceIdentifier: string;
  processId: number;
  processName: string | null;
  mutedBefore: boolean;
};

export type CaptureSessionMuteState = {
  sessions: CaptureSessionMuteEntry[];
};

export type DictationHotkeyPayload = {
  sessionId: number;
  target: ActiveWindowInfo | null;
  ocrContext: OcrPromptContext | null;
};

export type DictationOcrContextPayload = {
  sessionId: number;
  ocrContext: OcrPromptContext | null;
};

export type DictationHotkeyState = {
  recording: boolean;
  sessionId: number;
  target: ActiveWindowInfo | null;
  ocrContext: OcrPromptContext | null;
};
