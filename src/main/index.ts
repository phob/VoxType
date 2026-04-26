import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage } from "electron";
import { join } from "node:path";
import { type DictionaryCreateInput, type DictionaryPatch } from "../shared/dictionary";
import { buildOcrPromptContext, type OcrPromptContext } from "../shared/ocr-context";
import { type AppProfile, type InsertionMode, type SettingsPatch } from "../shared/settings";
import {
  type ActiveWindowInfo,
  type DictationHotkeyState,
  type NativeRecordingOptions
} from "../shared/windows-helper";
import { DictionaryStore } from "./dictionary-store";
import { HistoryStore } from "./history-store";
import { InsertionService } from "./insertion-service";
import { ModelService } from "./model-service";
import { OcrService } from "./ocr-service";
import { RuntimeService } from "./runtime-service";
import { SettingsStore } from "./settings-store";
import { TranscriptionService } from "./transcription-service";
import { WindowsHelperService } from "./windows-helper-service";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let dictationHotkeyState: DictationHotkeyState = {
  recording: false,
  sessionId: 0,
  target: null,
  ocrContext: null
};
let nextDictationSessionId = 1;
let registeredShowWindowHotkey: string | null = null;
let registeredDictationHotkey: string | null = null;

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const settingsStore = new SettingsStore();
const dictionaryStore = new DictionaryStore();
const historyStore = new HistoryStore();
const modelService = new ModelService(settingsStore);
const runtimeService = new RuntimeService();
const windowsHelperService = new WindowsHelperService();
const ocrService = new OcrService(windowsHelperService);
const transcriptionService = new TranscriptionService(
  settingsStore,
  historyStore,
  runtimeService,
  dictionaryStore
);
const insertionService = new InsertionService(windowsHelperService, settingsStore);

if (process.platform === "win32") {
  app.setAppUserModelId("com.voxtype.app");
}

function getAppIconPath(): string {
  const resourcesRoot = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
  return join(resourcesRoot, "icons", "voxtype.ico");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "VoxType",
    icon: getAppIconPath(),
    backgroundColor: "#101114",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getAppIconPath());
  tray = new Tray(icon);
  tray.setToolTip("VoxType");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show VoxType",
        click: () => mainWindow?.show()
      },
      {
        label: "Quit",
        click: () => app.quit()
      }
    ])
  );
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

async function toggleDictationHotkey(): Promise<void> {
  if (dictationHotkeyState.recording) {
    const payload = {
      sessionId: dictationHotkeyState.sessionId,
      target: dictationHotkeyState.target,
      ocrContext: dictationHotkeyState.ocrContext
    };

    dictationHotkeyState = {
      ...dictationHotkeyState,
      recording: false,
      ocrContext: null
    };
    mainWindow?.webContents.send("dictation-hotkey-stop", payload);
    return;
  }

  const target = await windowsHelperService.getActiveWindow().catch(() => null);
  await settingsStore.ensureAppProfile(target);
  const sessionId = nextDictationSessionId++;

  dictationHotkeyState = {
    recording: true,
    sessionId,
    target,
    ocrContext: null
  };

  void captureActiveWindowOcrContext(target).then((ocrContext) => {
    if (!dictationHotkeyState.recording || dictationHotkeyState.sessionId !== sessionId) {
      return;
    }

    dictationHotkeyState = {
      ...dictationHotkeyState,
      ocrContext
    };
    mainWindow?.webContents.send("dictation-ocr-context", { sessionId, ocrContext });
  });

  if (!mainWindow) {
    createWindow();
  }

  if (mainWindow?.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("dictation-hotkey-start", {
        sessionId,
        target,
        ocrContext: null
      });
    });
    return;
  }

  mainWindow?.webContents.send("dictation-hotkey-start", { sessionId, target, ocrContext: null });
}

async function captureActiveWindowOcrContext(
  target: ActiveWindowInfo | null
): Promise<OcrPromptContext | null> {
  if (!target) {
    return null;
  }

  try {
    const settings = await settingsStore.get();
    const screenshot = await windowsHelperService.captureScreenshot("activeWindow", target.hwnd);
    const ocrResult = await ocrService.recognizeImage(screenshot.path, screenshot.mode);
    return buildOcrPromptContext(ocrResult, target, settings.ocrTermMode);
  } catch {
    return null;
  }
}

async function registerConfiguredHotkeys(): Promise<void> {
  const settings = await settingsStore.get();

  if (registeredShowWindowHotkey) {
    globalShortcut.unregister(registeredShowWindowHotkey);
    registeredShowWindowHotkey = null;
  }

  if (registeredDictationHotkey) {
    globalShortcut.unregister(registeredDictationHotkey);
    registeredDictationHotkey = null;
  }

  if (settings.showWindowHotkey.trim()) {
    const registered = globalShortcut.register(settings.showWindowHotkey, showMainWindow);
    registeredShowWindowHotkey = registered ? settings.showWindowHotkey : null;
  }

  if (
    settings.dictationToggleHotkey.trim() &&
    settings.dictationToggleHotkey !== settings.showWindowHotkey
  ) {
    const registered = globalShortcut.register(settings.dictationToggleHotkey, () => {
      void toggleDictationHotkey();
    });
    registeredDictationHotkey = registered ? settings.dictationToggleHotkey : null;
  }
}

function getHotkeyStatus(): {
  showWindowHotkey: string | null;
  dictationToggleHotkey: string | null;
} {
  return {
    showWindowHotkey: registeredShowWindowHotkey,
    dictationToggleHotkey: registeredDictationHotkey
  };
}

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("settings:get", () => settingsStore.get());
ipcMain.handle("settings:update", async (_event, patch: SettingsPatch) => {
  const settings = await settingsStore.update(patch);
  await registerConfiguredHotkeys();
  return settings;
});
ipcMain.handle("settings:reset", async () => {
  const settings = await settingsStore.reset();
  await registerConfiguredHotkeys();
  return settings;
});
ipcMain.handle("models:list", () => modelService.list());
ipcMain.handle("models:download", (_event, modelId: string) => modelService.download(modelId));
ipcMain.handle("runtime:get-whisper", () => runtimeService.getWhisperRuntime());
ipcMain.handle("runtime:install-whisper", () => runtimeService.installWhisperRuntime());
ipcMain.handle(
  "ocr:recognize-screenshot",
  (_event, imagePath: string, mode: "screen" | "activeWindow") =>
    ocrService.recognizeImage(imagePath, mode)
);
ipcMain.handle(
  "transcription:transcribe-wav",
  (
    _event,
    bytes: Uint8Array,
    context?: { processName?: string | null; ocrContext?: OcrPromptContext | null }
  ) =>
    transcriptionService.transcribeWav(bytes, context)
);
ipcMain.handle("history:list", () => historyStore.list());
ipcMain.handle("history:audio", (_event, entryId: string) => historyStore.readAudio(entryId));
ipcMain.handle("dictionary:list", () => dictionaryStore.list());
ipcMain.handle("dictionary:add", (_event, input: DictionaryCreateInput) =>
  dictionaryStore.add(input)
);
ipcMain.handle("dictionary:update", (_event, id: string, patch: DictionaryPatch) =>
  dictionaryStore.update(id, patch)
);
ipcMain.handle("dictionary:remove", (_event, id: string) => dictionaryStore.remove(id));
ipcMain.handle("insertion:copy", (_event, text: string) => insertionService.copyForInsertion(text));
ipcMain.handle("insertion:paste-active", (_event, text: string) =>
  insertionService.insertIntoActiveApp(text)
);
ipcMain.handle("insertion:paste-window", (_event, text: string, hwnd: string) =>
  insertionService.insertIntoWindow(text, hwnd)
);
ipcMain.handle("insertion:insert-active", (_event, text: string) =>
  insertionService.insertIntoActiveApp(text)
);
ipcMain.handle(
  "insertion:insert-window",
  (_event, text: string, hwnd: string, processName?: string | null) =>
    insertionService.insertIntoWindow(text, hwnd, { processName })
);
ipcMain.handle(
  "insertion:test-window",
  (_event, text: string, hwnd: string, mode: InsertionMode, processName?: string | null) =>
    insertionService.insertIntoWindow(text, hwnd, { mode, processName })
);
ipcMain.handle("dictation:get-hotkey-state", () => dictationHotkeyState);
ipcMain.handle("dictation:set-hotkey-recording", (_event, recording: boolean) => {
  dictationHotkeyState = {
    ...dictationHotkeyState,
    recording,
    ocrContext: recording ? dictationHotkeyState.ocrContext : null
  };
  return dictationHotkeyState;
});
ipcMain.handle("hotkeys:status", () => getHotkeyStatus());
ipcMain.handle("windows-helper:status", () => windowsHelperService.getStatus());
ipcMain.handle("windows-helper:active-window", async () => {
  const activeWindow = await windowsHelperService.getActiveWindow();
  await settingsStore.ensureAppProfile(activeWindow);
  return activeWindow;
});
ipcMain.handle("app-profiles:ensure", (_event, windowInfo: ActiveWindowInfo | null) =>
  settingsStore.ensureAppProfile(windowInfo)
);
ipcMain.handle(
  "app-profiles:update",
  (
    _event,
    processName: string,
    patch: Pick<AppProfile, "insertionMode" | "writingStyle">
  ) =>
    settingsStore.updateAppProfile(processName, patch)
);
ipcMain.handle("windows-helper:set-system-mute", (_event, muted: boolean) =>
  windowsHelperService.setSystemMute(muted)
);
ipcMain.handle("windows-helper:send-hotkey", (_event, accelerator: string) =>
  windowsHelperService.sendHotkey(accelerator)
);
ipcMain.handle("windows-helper:capture-screenshot", (_event, mode: "screen" | "activeWindow") =>
  windowsHelperService.captureScreenshot(mode)
);
ipcMain.handle("windows-helper:start-recording", (_event, options: NativeRecordingOptions) =>
  windowsHelperService.startRecording(options)
);
ipcMain.handle("windows-helper:stop-recording", () =>
  windowsHelperService.stopRecording()
);

app.whenReady().then(() => {
  createWindow();
  createTray();
  void registerConfiguredHotkeys();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
