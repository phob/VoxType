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
  speechFrames: number;
};

export type DictationHotkeyPayload = {
  target: ActiveWindowInfo | null;
};

export type DictationHotkeyState = {
  recording: boolean;
  target: ActiveWindowInfo | null;
};
