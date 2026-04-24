import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage } from "electron";
import { join } from "node:path";
import { type SettingsPatch } from "../shared/settings";
import { type DictationHotkeyState } from "../shared/windows-helper";
import { HistoryStore } from "./history-store";
import { InsertionService } from "./insertion-service";
import { ModelService } from "./model-service";
import { RuntimeService } from "./runtime-service";
import { SettingsStore } from "./settings-store";
import { TranscriptionService } from "./transcription-service";
import { WindowsHelperService } from "./windows-helper-service";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let dictationHotkeyState: DictationHotkeyState = {
  recording: false,
  target: null
};

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const settingsStore = new SettingsStore();
const historyStore = new HistoryStore();
const modelService = new ModelService(settingsStore);
const runtimeService = new RuntimeService();
const windowsHelperService = new WindowsHelperService();
const transcriptionService = new TranscriptionService(
  settingsStore,
  historyStore,
  runtimeService
);
const insertionService = new InsertionService(windowsHelperService);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "VoxType",
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
  const icon = nativeImage.createEmpty();
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
    dictationHotkeyState = {
      ...dictationHotkeyState,
      recording: false
    };
    mainWindow?.webContents.send("dictation-hotkey-stop", {
      target: dictationHotkeyState.target
    });
    return;
  }

  const target = await windowsHelperService.getActiveWindow().catch(() => null);

  dictationHotkeyState = {
    recording: true,
    target
  };

  if (!mainWindow) {
    createWindow();
  }

  if (mainWindow?.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("dictation-hotkey-start", { target });
    });
    return;
  }

  mainWindow?.webContents.send("dictation-hotkey-start", { target });
}

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("settings:get", () => settingsStore.get());
ipcMain.handle("settings:update", (_event, patch: SettingsPatch) => settingsStore.update(patch));
ipcMain.handle("settings:reset", () => settingsStore.reset());
ipcMain.handle("models:list", () => modelService.list());
ipcMain.handle("models:download", (_event, modelId: string) => modelService.download(modelId));
ipcMain.handle("runtime:get-whisper", () => runtimeService.getWhisperRuntime());
ipcMain.handle("runtime:install-whisper", () => runtimeService.installWhisperRuntime());
ipcMain.handle("transcription:transcribe-wav", (_event, bytes: Uint8Array) =>
  transcriptionService.transcribeWav(bytes)
);
ipcMain.handle("history:list", () => historyStore.list());
ipcMain.handle("insertion:copy", (_event, text: string) => insertionService.copyForInsertion(text));
ipcMain.handle("insertion:paste-active", (_event, text: string) =>
  insertionService.pasteIntoActiveApp(text)
);
ipcMain.handle("insertion:paste-window", (_event, text: string, hwnd: string) =>
  insertionService.pasteIntoWindow(text, hwnd)
);
ipcMain.handle("dictation:get-hotkey-state", () => dictationHotkeyState);
ipcMain.handle("dictation:set-hotkey-recording", (_event, recording: boolean) => {
  dictationHotkeyState = {
    ...dictationHotkeyState,
    recording
  };
  return dictationHotkeyState;
});
ipcMain.handle("windows-helper:status", () => windowsHelperService.getStatus());
ipcMain.handle("windows-helper:active-window", () => windowsHelperService.getActiveWindow());

app.whenReady().then(() => {
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+Space", showMainWindow);
  globalShortcut.register("CommandOrControl+Alt+Space", () => {
    void toggleDictationHotkey();
  });

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
