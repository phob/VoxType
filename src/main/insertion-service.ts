import { clipboard } from "electron";
import { type SettingsStore } from "./settings-store";
import { WindowsHelperService } from "./windows-helper-service";

const FOCUS_SETTLE_DELAY_MS = 120;

export class InsertionService {
  constructor(
    private readonly windowsHelperService: WindowsHelperService,
    private readonly settingsStore: SettingsStore
  ) {}

  async copyForInsertion(text: string): Promise<void> {
    clipboard.writeText(text);
  }

  async insertIntoActiveApp(text: string): Promise<void> {
    await this.insertText(text);
  }

  async insertIntoWindow(text: string, hwnd: string): Promise<void> {
    await this.windowsHelperService.focusWindow(hwnd);
    await wait(FOCUS_SETTLE_DELAY_MS);
    await this.insertText(text);
  }

  async pasteIntoActiveApp(text: string): Promise<void> {
    await this.insertIntoActiveApp(text);
  }

  async pasteIntoWindow(text: string, hwnd: string): Promise<void> {
    await this.insertIntoWindow(text, hwnd);
  }

  private async insertText(text: string): Promise<void> {
    const settings = await this.settingsStore.get();

    if (settings.insertionMode === "clipboard") {
      await this.windowsHelperService.pasteText(text);
      return;
    }

    if (settings.insertionMode === "keyboard") {
      await this.windowsHelperService.typeText(text, 0);
      return;
    }

    for (const chunk of chunkText(text, settings.remoteTypingChunkSize)) {
      await this.windowsHelperService.typeText(chunk, 0);
      await wait(settings.remoteTypingDelayMs);
    }
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  const characters = Array.from(text);

  for (let index = 0; index < characters.length; index += chunkSize) {
    chunks.push(characters.slice(index, index + chunkSize).join(""));
  }

  return chunks;
}
