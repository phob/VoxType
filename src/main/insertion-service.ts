import { clipboard } from "electron";
import { findAppProfile, type InsertionMode } from "../shared/settings";
import { type SettingsStore } from "./settings-store";
import { WindowsHelperService } from "./windows-helper-service";

const FOCUS_SETTLE_DELAY_MS = 120;
const CLIPBOARD_RESTORE_DELAY_MS = 250;

type InsertOptions = {
  mode?: InsertionMode;
  processName?: string | null;
};

type ClipboardSnapshot = {
  formats: string[];
  data: Electron.Data;
  buffers: Array<{
    format: string;
    buffer: Buffer;
  }>;
};

export class InsertionService {
  constructor(
    private readonly windowsHelperService: WindowsHelperService,
    private readonly settingsStore: SettingsStore
  ) {}

  async copyForInsertion(text: string): Promise<void> {
    clipboard.writeText(text);
  }

  async insertIntoActiveApp(text: string, options?: InsertOptions): Promise<void> {
    await this.insertText(text, options);
  }

  async insertIntoWindow(
    text: string,
    hwnd: string,
    options?: InsertOptions
  ): Promise<void> {
    await this.windowsHelperService.focusWindow(hwnd);
    await wait(FOCUS_SETTLE_DELAY_MS);
    await this.insertText(text, options);
  }

  async pasteIntoActiveApp(text: string): Promise<void> {
    await this.insertIntoActiveApp(text);
  }

  async pasteIntoWindow(text: string, hwnd: string): Promise<void> {
    await this.insertIntoWindow(text, hwnd);
  }

  private async insertText(text: string, options?: InsertOptions): Promise<void> {
    const settings = await this.settingsStore.get();
    const profile = findAppProfile(settings.appProfiles, options?.processName ?? null);
    const mode = options?.mode ?? profile?.insertionMode ?? settings.insertionMode;

    if (mode === "clipboard") {
      await this.pasteWithClipboardRestore(text, settings.restoreClipboard);
      return;
    }

    if (mode === "keyboard") {
      await this.windowsHelperService.typeText(text, 0);
      return;
    }

    if (mode === "windowsMessaging") {
      await this.windowsHelperService.messageText(
        text,
        usesRemoteControlMessages(options?.processName) ? "character-messages" : "focused-control"
      );
      return;
    }

    for (const chunk of chunkText(text, settings.remoteTypingChunkSize)) {
      await this.windowsHelperService.typeText(chunk, 0);
      await wait(settings.remoteTypingDelayMs);
    }
  }

  private async pasteWithClipboardRestore(
    text: string,
    restoreClipboard: boolean
  ): Promise<void> {
    const snapshot = restoreClipboard ? captureClipboard() : null;
    let pasteError: unknown = null;

    try {
      await this.windowsHelperService.pasteText(text);
    } catch (error) {
      pasteError = error;
    } finally {
      if (snapshot) {
        await wait(CLIPBOARD_RESTORE_DELAY_MS);
        restoreClipboardSnapshot(snapshot);
      }
    }

    if (pasteError) {
      throw pasteError;
    }
  }
}

function captureClipboard(): ClipboardSnapshot {
  const formats = clipboard.availableFormats("clipboard");
  const data: Electron.Data = {};

  if (hasFormat(formats, "text/plain")) {
    data.text = clipboard.readText("clipboard");
  }

  if (hasFormat(formats, "text/html")) {
    data.html = clipboard.readHTML("clipboard");
  }

  if (hasFormat(formats, "text/rtf")) {
    data.rtf = clipboard.readRTF("clipboard");
  }

  const image = clipboard.readImage("clipboard");
  if (!image.isEmpty()) {
    data.image = image;
  }

  return {
    formats,
    data,
    buffers: formats.flatMap((format) => {
      try {
        const buffer = clipboard.readBuffer(format);
        return buffer.length > 0 ? [{ format, buffer }] : [];
      } catch {
        return [];
      }
    })
  };
}

function restoreClipboardSnapshot(snapshot: ClipboardSnapshot): void {
  clipboard.clear("clipboard");

  if (snapshot.formats.length === 0) {
    return;
  }

  if (hasClipboardData(snapshot.data)) {
    clipboard.write(snapshot.data, "clipboard");
    return;
  }

  for (const entry of snapshot.buffers) {
    try {
      clipboard.writeBuffer(entry.format, entry.buffer, "clipboard");
    } catch {
      // Some Windows clipboard formats cannot be restored through Electron.
    }
  }
}

function hasClipboardData(data: Electron.Data): boolean {
  return Boolean(data.text || data.html || data.rtf || data.image);
}

function hasFormat(formats: string[], format: string): boolean {
  return formats.some((candidate) => candidate.toLowerCase() === format);
}

function usesRemoteControlMessages(processName?: string | null): boolean {
  const normalized = processName?.trim().toLowerCase();
  return (
    normalized === "teamviewer.exe" ||
    normalized === "anydesk.exe" ||
    normalized === "mstsc.exe"
  );
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
