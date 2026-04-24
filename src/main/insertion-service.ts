import { clipboard } from "electron";
import { WindowsHelperService } from "./windows-helper-service";

export class InsertionService {
  constructor(private readonly windowsHelperService: WindowsHelperService) {}

  async copyForInsertion(text: string): Promise<void> {
    clipboard.writeText(text);
  }

  async pasteIntoActiveApp(text: string): Promise<void> {
    await this.windowsHelperService.pasteText(text);
  }

  async pasteIntoWindow(text: string, hwnd: string): Promise<void> {
    await this.windowsHelperService.focusWindow(hwnd);
    await wait(120);
    await this.windowsHelperService.pasteText(text);
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
