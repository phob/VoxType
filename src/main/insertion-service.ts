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
}
