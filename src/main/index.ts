import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen } from "electron";
import { join } from "node:path";
import { type DictionaryCreateInput, type DictionaryPatch } from "../shared/dictionary";
import { buildOcrPromptContext, type OcrPromptContext } from "../shared/ocr-context";
import {
  type AppProfile,
  type AppSettings,
  type InsertionMode,
  type SettingsPatch
} from "../shared/settings";
import {
  type ActiveWindowInfo,
  type DictationHotkeyState,
  type NativeRecordingOptions,
  type RecordingOverlayState
} from "../shared/windows-helper";
import { DictionaryStore } from "./dictionary-store";
import { HardwareService } from "./hardware-service";
import { HistoryStore } from "./history-store";
import { InsertionService } from "./insertion-service";
import { ModelService } from "./model-service";
import { OcrService } from "./ocr-service";
import { RuntimeService } from "./runtime-service";
import { SettingsStore } from "./settings-store";
import { TranscriptionService } from "./transcription-service";
import { UpdateService } from "./update-service";
import { WindowsHelperService } from "./windows-helper-service";

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayState: RecordingOverlayState = {
  visible: false,
  mode: "recording",
  level: 0,
  message: "Recording"
};
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
const hardwareService = new HardwareService();
const windowsHelperService = new WindowsHelperService();
const ocrService = new OcrService(windowsHelperService);
const updateService = new UpdateService();
const transcriptionService = new TranscriptionService(
  settingsStore,
  historyStore,
  runtimeService,
  dictionaryStore
);
const insertionService = new InsertionService(windowsHelperService, settingsStore);

app.setName("VoxType");

if (process.platform === "win32") {
  app.setAppUserModelId("com.voxtype.app");
}

function getAppIconPath(): string {
  const resourcesRoot = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
  return join(resourcesRoot, "icons", "voxtype.ico");
}

function applyStartupSettings(settings: AppSettings): void {
  if (process.platform !== "win32") {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: settings.startWithWindows,
    openAsHidden: settings.startMinimized
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    resizable: false,
    maximizable: false,
    title: "VoxType",
    icon: getAppIconPath(),
    frame: false,
    autoHideMenuBar: true,
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
    void (async () => {
      const settings = await settingsStore.get();

      if (settings.startMinimized) {
        mainWindow?.hide();
        return;
      }

      mainWindow?.show();
    })();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;

    if (overlayWindow && !overlayState.visible) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
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
  tray.on("double-click", showMainWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show VoxType",
        click: showMainWindow
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

  mainWindow.setSkipTaskbar(false);
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

function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    width: 150,
    height: 24,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    transparent: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
  overlayWindow.webContents.once("did-finish-load", () => {
    sendOverlayState();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void overlayWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?overlay=1`);
  } else {
    void overlayWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { overlay: "1" }
    });
  }

  return overlayWindow;
}

function positionOverlayWindow(): void {
  const window = createOverlayWindow();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = display.workArea;
  const [width, height] = window.getSize();
  const x = Math.round(bounds.x + (bounds.width - width) / 2);
  const y = Math.round(bounds.y + bounds.height - height - 24);
  window.setPosition(x, y, false);
}

function showOverlay(next: Partial<RecordingOverlayState>): void {
  overlayState = {
    ...overlayState,
    ...next,
    visible: true
  };
  const window = createOverlayWindow();
  positionOverlayWindow();
  window.showInactive();
  sendOverlayState();
}

function updateOverlay(next: Partial<RecordingOverlayState>): void {
  overlayState = {
    ...overlayState,
    ...next
  };
  sendOverlayState();
}

function hideOverlay(): void {
  overlayState = {
    ...overlayState,
    visible: false,
    level: 0
  };
  sendOverlayState();
  overlayWindow?.destroy();
  overlayWindow = null;
}

function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? mainWindow;
}

function sendOverlayState(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.webContents.send("recording-overlay-state", overlayState);
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
ipcMain.handle("app:get-info", () => {
  const version = app.getVersion();
  const isDeveloperBuild = !app.isPackaged;

  return {
    isDeveloperBuild,
    version,
    versionLabel: isDeveloperBuild ? `${version}-dev` : version
  };
});
ipcMain.handle("app:update-status", () => updateService.getStatus());
ipcMain.handle("app:check-for-updates", () => updateService.check());
ipcMain.handle("app:install-update", () => updateService.install());
ipcMain.handle("window:minimize", () => {
  mainWindow?.hide();
});
ipcMain.handle("window:close", () => {
  getFocusedWindow()?.close();
});
ipcMain.handle("settings:get", () => settingsStore.get());
ipcMain.handle("settings:update", async (_event, patch: SettingsPatch) => {
  const settings = await settingsStore.update(patch);
  applyStartupSettings(settings);
  await registerConfiguredHotkeys();
  return settings;
});
ipcMain.handle("settings:reset", async () => {
  const settings = await settingsStore.reset();
  applyStartupSettings(settings);
  await registerConfiguredHotkeys();
  return settings;
});
ipcMain.handle("models:list", () => modelService.list());
ipcMain.handle("models:download", (_event, modelId: string) => modelService.download(modelId));
ipcMain.handle("models:delete", (_event, modelId: string) => modelService.delete(modelId));
ipcMain.handle("runtime:get-whisper", () => runtimeService.getWhisperRuntime());
ipcMain.handle("runtime:list-whisper", () => runtimeService.listWhisperRuntimes());
ipcMain.handle("runtime:install-whisper", (_event, runtimeId?: string) =>
  runtimeService.installWhisperRuntime(runtimeId)
);
ipcMain.handle("runtime:setup-first-run-cuda", async () => {
  const target = await runtimeService.getFirstRunCudaRuntimeTarget();

  if (!target) {
    return {
      runtime: await runtimeService.getPreferredRuntime("auto"),
      settings: await settingsStore.get(),
      hardware: await hardwareService.getAccelerationReport(),
      installed: false,
      message: "No suitable NVIDIA CUDA runtime was detected. CPU remains the fallback."
    };
  }

  const runtime = await runtimeService.installWhisperRuntime(target.id);
  const settings = await settingsStore.update({ whisperRuntimeBackend: "auto" });

  return {
    runtime,
    settings,
    hardware: await hardwareService.getAccelerationReport(),
    installed: true,
    message: `Installed ${runtime.name}.`
  };
});
ipcMain.handle("hardware:get-acceleration-report", () =>
  hardwareService.getAccelerationReport()
);
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
ipcMain.handle("history:cleanup", () => historyStore.cleanup());
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
    patch: Pick<
      AppProfile,
      | "insertionMode"
      | "writingStyle"
      | "recordingCoordinationMode"
      | "recordingStartHotkey"
      | "recordingStopHotkey"
      | "postTranscriptionHotkey"
      | "whisperLanguage"
    >
  ) =>
    settingsStore.updateAppProfile(processName, patch)
);
ipcMain.handle("app-profiles:remove", (_event, processName: string) =>
  settingsStore.removeAppProfile(processName)
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
  windowsHelperService.startRecording(options, (level) => {
    updateOverlay({
      level: Math.max(level.rms * 3, level.peak)
    });
  })
);
ipcMain.handle("windows-helper:stop-recording", () =>
  windowsHelperService.stopRecording()
);
ipcMain.handle("recording-overlay:show-recording", () => {
  showOverlay({ mode: "recording", level: 0, message: "Recording" });
});
ipcMain.handle("recording-overlay:show-transcribing", () => {
  showOverlay({ mode: "transcribing", level: 0, message: "Transcribing" });
});
ipcMain.handle("recording-overlay:hide", () => {
  hideOverlay();
});
ipcMain.handle("recording-overlay:get-state", () => overlayState);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  void settingsStore.get().then(applyStartupSettings);
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
  overlayWindow?.destroy();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
