import { type OcrResult } from "../shared/ocr";
import { type ScreenshotCaptureMode } from "../shared/windows-helper";
import { type WindowsHelperService } from "./windows-helper-service";

export class OcrService {
  constructor(private readonly windowsHelperService: WindowsHelperService) {}

  async recognizeImage(
    imagePath: string,
    mode: ScreenshotCaptureMode
  ): Promise<OcrResult> {
    const result = await this.windowsHelperService.recognizeImageText(imagePath);

    return {
      provider: "windowsMediaOcr",
      engine: result.engine,
      imagePath: result.imagePath,
      mode,
      text: result.text,
      lines: result.lines,
      durationMs: result.durationMs,
      capturedAt: new Date().toISOString()
    };
  }
}
