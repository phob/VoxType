import { type ScreenshotCaptureMode } from "./windows-helper";

export type OcrProvider = "windowsMediaOcr";

export interface OcrTextLine {
  text: string;
  confidence: number | null;
  box: [number, number, number, number] | null;
}

export interface OcrResult {
  provider: OcrProvider;
  engine: string;
  imagePath: string;
  mode: ScreenshotCaptureMode;
  text: string;
  lines: OcrTextLine[];
  durationMs: number;
  capturedAt: string;
}
