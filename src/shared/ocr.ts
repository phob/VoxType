import { type ScreenshotCaptureMode } from "./windows-helper";

export type OcrProvider = "windowsMediaOcr";

export type OcrTextLine = {
  text: string;
  confidence: number | null;
  box: [number, number, number, number] | null;
};

export type OcrResult = {
  provider: OcrProvider;
  engine: string;
  imagePath: string;
  mode: ScreenshotCaptureMode;
  text: string;
  lines: OcrTextLine[];
  durationMs: number;
  capturedAt: string;
};
