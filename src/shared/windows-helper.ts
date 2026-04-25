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
  error: string | null;
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
  target: ActiveWindowInfo | null;
};

export type DictationHotkeyState = {
  recording: boolean;
  target: ActiveWindowInfo | null;
};
