import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen } from "electron";
import { join } from "node:path";
import { getDictationMode } from "../shared/asr";
import { getOpenAiModelIdForMode, OPENAI_TRANSCRIBE_MODEL_ID } from "../shared/openai-models";
import { getCloudDictationReadiness } from "../shared/cloud-status";
import { type DictionaryCreateInput, type DictionaryPatch } from "../shared/dictionary";
import { buildOcrPromptContext, type OcrPromptContext } from "../shared/ocr-context";
import {
  type AppProfile,
  type AppSettings,
  type InsertionMode,
  type SettingsPatch,
  findAppProfile
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
import { OpenAiFileAsrProvider } from "./openai-asr-provider";
import { OpenAiCredentialStore } from "./openai-credential-store";
import { buildCloudPromptPack } from "./prompt-pack";
import { RealtimeCloudHistoryService } from "./realtime-cloud-history-service";
import { RealtimeCloudSession } from "./realtime-cloud-session";
import { RuntimeService } from "./runtime-service";
import { SettingsStore } from "./settings-store";
import { cleanupStartupStorage } from "./startup-cleanup";
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
let registeredDictationHoldHotkey: string | null = null;
let dictationSuspendedForFullscreen = false;
let fullscreenSuspensionProcessName: string | null = null;
let fullscreenSuspensionTimer: ReturnType<typeof setInterval> | null = null;
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
let hotkeysManuallySuspended = false;
let revealMainWindowOnReady = false;
const holdToDictateThresholdMs = 700;
const updateCheckIntervalMs = 60 * 60 * 1000;

const isDeveloperBuild = !app.isPackaged;
const hasDevRendererUrl = Boolean(process.env.ELECTRON_RENDERER_URL);
const settingsStore = new SettingsStore();
const dictionaryStore = new DictionaryStore();
const historyStore = new HistoryStore();
const modelService = new ModelService(settingsStore);
const runtimeService = new RuntimeService();
const hardwareService = new HardwareService();
const windowsHelperService = new WindowsHelperService();
const ocrService = new OcrService(windowsHelperService);
const openAiCredentialStore = new OpenAiCredentialStore();
const openAiFileAsrProvider = new OpenAiFileAsrProvider(openAiCredentialStore);
const updateService = new UpdateService();
const transcriptionService = new TranscriptionService(
  settingsStore,
  historyStore,
  runtimeService,
  dictionaryStore
);
const realtimeCloudHistoryService = new RealtimeCloudHistoryService(dictionaryStore, historyStore);
let activeRealtimeCloudSession: RealtimeCloudSession | null = null;
let activeRealtimeCloudProcessName: string | null = null;
const insertionService = new InsertionService(windowsHelperService, settingsStore);

app.setName("VoxType");

if (process.platform === "win32") {
  app.setAppUserModelId("com.voxtype.app");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
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
    openAsHidden: shouldStartMinimized(settings)
  });
}

function shouldStartMinimized(settings: AppSettings): boolean {
  return !isDeveloperBuild && settings.startMinimized;
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

      if (shouldStartMinimized(settings) && !revealMainWindowOnReady) {
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

  if (hasDevRendererUrl && process.env.ELECTRON_RENDERER_URL) {
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

function sendUpdateStatus(): void {
  mainWindow?.webContents.send("app-update-status", updateService.getStatus());
}

async function checkForUpdates(options: { revealWindowOnAvailable?: boolean } = {}): Promise<void> {
  const settings = await settingsStore.get();

  if (!settings.automaticUpdateChecksEnabled) {
    return;
  }

  const checkPromise = updateService.check();
  sendUpdateStatus();
  const status = await checkPromise;
  sendUpdateStatus();

  if (options.revealWindowOnAvailable && status.available) {
    revealMainWindowOnReady = true;
    showMainWindow();
  }
}

function stopAutomaticUpdateChecks(): void {
  if (!updateCheckTimer) {
    return;
  }

  clearInterval(updateCheckTimer);
  updateCheckTimer = null;
}

function cancelActiveRealtimeCloudSession(reason: string): void {
  activeRealtimeCloudSession?.cancel(reason);
  activeRealtimeCloudSession = null;
  activeRealtimeCloudProcessName = null;
}

function startAutomaticUpdateChecks(settings: AppSettings): void {
  stopAutomaticUpdateChecks();

  if (!settings.automaticUpdateChecksEnabled) {
    return;
  }

  updateCheckTimer = setInterval(() => {
    void checkForUpdates();
  }, updateCheckIntervalMs);
}

function stopDictationHotkey(): boolean {
  if (!dictationHotkeyState.recording) {
    return false;
  }

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

  return true;
}

async function startDictationHotkey(): Promise<number | null> {
  if (dictationHotkeyState.recording) {
    return null;
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
      if (!dictationHotkeyState.recording || dictationHotkeyState.sessionId !== sessionId) {
        return;
      }

      mainWindow?.webContents.send("dictation-hotkey-start", {
        sessionId,
        target,
        ocrContext: null
      });
    });
    return sessionId;
  }

  mainWindow?.webContents.send("dictation-hotkey-start", { sessionId, target, ocrContext: null });
  return sessionId;
}

async function holdDictationHotkey(): Promise<void> {
  const settings = await settingsStore.get();
  const sessionId = await startDictationHotkey();

  if (sessionId === null) {
    return;
  }

  try {
    await windowsHelperService.waitForHotkeyRelease(settings.dictationHoldHotkey);
  } finally {
    if (dictationHotkeyState.recording && dictationHotkeyState.sessionId === sessionId) {
      stopDictationHotkey();
    }
  }
}

async function durationAwareDictationHotkey(accelerator: string): Promise<void> {
  if (stopDictationHotkey()) {
    return;
  }

  const startedAt = Date.now();
  const releasePromise = windowsHelperService.waitForHotkeyRelease(accelerator);
  const sessionId = await startDictationHotkey();

  try {
    await releasePromise;
  } catch {
    return;
  }

  if (sessionId === null) {
    return;
  }

  if (Date.now() - startedAt < holdToDictateThresholdMs) {
    return;
  }

  if (dictationHotkeyState.recording && dictationHotkeyState.sessionId === sessionId) {
    stopDictationHotkey();
  }
}

function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    width: 196,
    height: 30,
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

  if (hasDevRendererUrl && process.env.ELECTRON_RENDERER_URL) {
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
    level: 0,
    cloudProviderLabel: undefined,
    elapsedMs: undefined,
    livePreviewTurns: undefined
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
  unregisterConfiguredHotkeys();

  if (hotkeysManuallySuspended) {
    return;
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
      void durationAwareDictationHotkey(settings.dictationToggleHotkey);
    });
    registeredDictationHotkey = registered ? settings.dictationToggleHotkey : null;
  }

  if (
    settings.dictationHoldHotkey.trim() &&
    settings.dictationHoldHotkey !== settings.showWindowHotkey &&
    settings.dictationHoldHotkey !== settings.dictationToggleHotkey
  ) {
    const registered = globalShortcut.register(settings.dictationHoldHotkey, () => {
      void holdDictationHotkey();
    });
    registeredDictationHoldHotkey = registered ? settings.dictationHoldHotkey : null;
  }

  await refreshFullscreenHotkeySuspension();
}

function unregisterConfiguredHotkeys(): void {
  if (registeredShowWindowHotkey) {
    globalShortcut.unregister(registeredShowWindowHotkey);
    registeredShowWindowHotkey = null;
  }

  if (registeredDictationHotkey) {
    globalShortcut.unregister(registeredDictationHotkey);
    registeredDictationHotkey = null;
  }

  if (registeredDictationHoldHotkey) {
    globalShortcut.unregister(registeredDictationHoldHotkey);
    registeredDictationHoldHotkey = null;
  }
}

function unregisterDictationHotkeys(): void {
  if (registeredDictationHotkey) {
    globalShortcut.unregister(registeredDictationHotkey);
    registeredDictationHotkey = null;
  }

  if (registeredDictationHoldHotkey) {
    globalShortcut.unregister(registeredDictationHoldHotkey);
    registeredDictationHoldHotkey = null;
  }
}

async function registerDictationHotkeys(settings: AppSettings): Promise<void> {
  if (
    settings.dictationToggleHotkey.trim() &&
    settings.dictationToggleHotkey !== settings.showWindowHotkey &&
    !registeredDictationHotkey
  ) {
    const registered = globalShortcut.register(settings.dictationToggleHotkey, () => {
      void durationAwareDictationHotkey(settings.dictationToggleHotkey);
    });
    registeredDictationHotkey = registered ? settings.dictationToggleHotkey : null;
  }

  if (
    settings.dictationHoldHotkey.trim() &&
    settings.dictationHoldHotkey !== settings.showWindowHotkey &&
    settings.dictationHoldHotkey !== settings.dictationToggleHotkey &&
    !registeredDictationHoldHotkey
  ) {
    const registered = globalShortcut.register(settings.dictationHoldHotkey, () => {
      void holdDictationHotkey();
    });
    registeredDictationHoldHotkey = registered ? settings.dictationHoldHotkey : null;
  }
}

function startFullscreenSuspensionWatch(): void {
  if (fullscreenSuspensionTimer) {
    return;
  }

  fullscreenSuspensionTimer = setInterval(() => {
    void refreshFullscreenHotkeySuspension();
  }, 2000);
}

function stopFullscreenSuspensionWatch(): void {
  if (!fullscreenSuspensionTimer) {
    return;
  }

  clearInterval(fullscreenSuspensionTimer);
  fullscreenSuspensionTimer = null;
}

async function refreshFullscreenHotkeySuspension(): Promise<void> {
  const settings = await settingsStore.get();

  if (hotkeysManuallySuspended) {
    return;
  }

  if (!settings.suspendDictationHotkeysInFullscreenApps) {
    stopFullscreenSuspensionWatch();
    dictationSuspendedForFullscreen = false;
    fullscreenSuspensionProcessName = null;
    await registerDictationHotkeys(settings);
    return;
  }

  startFullscreenSuspensionWatch();

  const activeWindow = await windowsHelperService.getActiveWindow().catch(() => null);
  const profile = findAppProfile(settings.appProfiles, activeWindow?.processName ?? null);
  const shouldSuspend = Boolean(
    activeWindow?.fullscreen && !profile?.neverSuspendDictationInFullscreen
  );

  if (shouldSuspend) {
    unregisterDictationHotkeys();
    dictationSuspendedForFullscreen = true;
    fullscreenSuspensionProcessName = activeWindow?.processName ?? null;
    return;
  }

  dictationSuspendedForFullscreen = false;
  fullscreenSuspensionProcessName = null;
  await registerDictationHotkeys(settings);
}

function getHotkeyStatus(): {
  showWindowHotkey: string | null;
  dictationToggleHotkey: string | null;
  dictationHoldHotkey: string | null;
  dictationSuspendedForFullscreen: boolean;
  fullscreenProcessName: string | null;
} {
  return {
    showWindowHotkey: registeredShowWindowHotkey,
    dictationToggleHotkey: registeredDictationHotkey,
    dictationHoldHotkey: registeredDictationHoldHotkey,
    dictationSuspendedForFullscreen,
    fullscreenProcessName: fullscreenSuspensionProcessName
  };
}

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("app:get-info", () => {
  const version = app.getVersion();

  return {
    isDeveloperBuild,
    version,
    versionLabel: isDeveloperBuild ? `${version}-dev` : version
  };
});
ipcMain.handle("app:update-status", () => updateService.getStatus());
ipcMain.handle("app:check-for-updates", async () => {
  const checkPromise = updateService.check();
  sendUpdateStatus();
  const status = await checkPromise;
  sendUpdateStatus();
  return status;
});
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
  startAutomaticUpdateChecks(settings);
  await registerConfiguredHotkeys();
  return settings;
});
ipcMain.handle("settings:reset", async () => {
  const settings = await settingsStore.reset();
  applyStartupSettings(settings);
  startAutomaticUpdateChecks(settings);
  await registerConfiguredHotkeys();
  return settings;
});

ipcMain.handle("openai-credentials:get-status", () => openAiCredentialStore.getStatus());

ipcMain.handle("openai-credentials:set-api-key", async (_event, apiKey: string) => {
  await openAiCredentialStore.setApiKey(apiKey);
  return openAiCredentialStore.getStatus();
});

ipcMain.handle("openai-credentials:clear-api-key", async () => {
  await openAiCredentialStore.clearApiKey();
  return openAiCredentialStore.getStatus();
});

ipcMain.handle("openai:test-connection", async () => {
  const settings = await settingsStore.get();

  if (settings.offlineMode) {
    return {
      ok: false,
      message: "OpenAI test connection is disabled while Offline Mode is on."
    };
  }

  const hasApiKey = await openAiCredentialStore.hasApiKey();

  if (!hasApiKey) {
    return {
      ok: false,
      message: "OpenAI test connection requires an API key before any network request."
    };
  }

  const mode = getCloudDictationReadiness({
    settings,
    profile: null,
    hasApiKey
  });

  const dictationMode = getDictationMode(mode.modeId);
  const modelId = getOpenAiModelIdForMode(dictationMode.id) ?? OPENAI_TRANSCRIBE_MODEL_ID;

  return openAiFileAsrProvider.testConnection(modelId);
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
  "transcription:preview-prompt-pack",
  async (
    _event,
    context?: { processName?: string | null; ocrContext?: OcrPromptContext | null }
  ) => {
    const settings = await settingsStore.get();
    const processName = context?.processName ?? null;
    const profile = findAppProfile(settings.appProfiles, processName);
    const readiness = getCloudDictationReadiness({
      settings,
      profile,
      hasApiKey: await openAiCredentialStore.hasApiKey()
    });

    if (!readiness.cloud) {
      return null;
    }

    return buildCloudPromptPack(dictionaryStore, {
      processName,
      ocrContext: context?.ocrContext ?? null,
      includeOcrContext: settings.cloudPromptPackOcrEnabled,
      consentAccepted: settings.cloudDictationConsentAccepted
    });
});

ipcMain.handle("transcription:get-readiness", async (_event, processName?: string | null) => {
  const settings = await settingsStore.get();
  const profile = findAppProfile(settings.appProfiles, processName ?? null);

  return getCloudDictationReadiness({
    settings,
    profile,
    hasApiKey: await openAiCredentialStore.hasApiKey()
  });
});

ipcMain.handle(
  "transcription:transcribe-wav",
  (
    _event,
    bytes: Uint8Array,
    context?: {
      processName?: string | null;
      ocrContext?: OcrPromptContext | null;
      forceModeId?: "local.custom";
    }
  ) =>
    transcriptionService.transcribeWav(bytes, context)
);

ipcMain.handle(
  "transcription:realtime-start",
  async (
    _event,
    context?: { processName?: string | null; ocrContext?: OcrPromptContext | null }
  ) => {
    const settings = await settingsStore.get();
    const processName = context?.processName ?? null;
    const profile = findAppProfile(settings.appProfiles, processName);
    const readiness = getCloudDictationReadiness({
      settings,
      profile,
      hasApiKey: await openAiCredentialStore.hasApiKey()
    });

    if (!readiness.ready || readiness.modeId !== "openai.realtime") {
      throw new Error(readiness.reason ?? "Realtime Cloud Dictation is not ready.");
    }

    cancelActiveRealtimeCloudSession("Realtime Cloud Dictation session replaced by a new recording.");
    activeRealtimeCloudSession = new RealtimeCloudSession(openAiCredentialStore, settings, updateOverlay);
    activeRealtimeCloudProcessName = processName;

    const promptPack = await buildCloudPromptPack(dictionaryStore, {
      processName,
      ocrContext: context?.ocrContext ?? null,
      includeOcrContext: settings.cloudPromptPackOcrEnabled,
      consentAccepted: settings.cloudDictationConsentAccepted
    });

    await activeRealtimeCloudSession.start(promptPack);
  }
);

ipcMain.handle("transcription:realtime-append-pcm16", (_event, bytes: Uint8Array) => {
  if (!activeRealtimeCloudSession) {
    throw new Error("Realtime Cloud Dictation has not started.");
  }

  activeRealtimeCloudSession.appendPcm16Audio(bytes);
});

ipcMain.handle("transcription:realtime-finalize", async () => {
  if (!activeRealtimeCloudSession) {
    throw new Error("Realtime Cloud Dictation has not started.");
  }

  const session = activeRealtimeCloudSession;
  activeRealtimeCloudSession = null;
  const processName = activeRealtimeCloudProcessName;
  activeRealtimeCloudProcessName = null;
  const snapshot = session.finalize();
  const mode = getDictationMode("openai.realtime");

  if (snapshot.preConnectionDroppedBytes > 0) {
    updateOverlay({
      mode: "finalizing",
      cloudProviderLabel: "Cloud Dictation",
      message: "Realtime pre-connection buffer limit reached; oldest audio was dropped."
    });
  }

  return realtimeCloudHistoryService.save({
    mode,
    turns: snapshot.turns,
    startedAtMs: snapshot.startedAtMs,
    endedAtMs: Date.now(),
    processName
  });
});

ipcMain.handle("transcription:realtime-cancel", (_event, reason?: string) => {
  cancelActiveRealtimeCloudSession(reason ?? "Realtime Cloud Dictation session cancelled");
});
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
ipcMain.handle("hotkeys:suspend", () => {
  hotkeysManuallySuspended = true;
  unregisterConfiguredHotkeys();
  return getHotkeyStatus();
});
ipcMain.handle("hotkeys:resume", async () => {
  hotkeysManuallySuspended = false;
  await registerConfiguredHotkeys();
  return getHotkeyStatus();
});
ipcMain.handle("windows-helper:status", () => windowsHelperService.getStatus());
ipcMain.handle("windows-helper:active-window", async () => {
  const activeWindow = await windowsHelperService.getActiveWindow();
  await settingsStore.ensureAppProfile(activeWindow);
  return activeWindow;
});
ipcMain.handle("windows-helper:input-devices", () => windowsHelperService.listInputDevices());
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
      | "neverSuspendDictationInFullscreen"
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
  windowsHelperService.startRecording(options, (level, pcm16Chunk) => {
    updateOverlay({
      level: Math.max(level.rms * 3, level.peak)
    });

    if (pcm16Chunk && activeRealtimeCloudSession) {
      activeRealtimeCloudSession.appendPcm16Audio(pcm16Chunk);
    }
  })
);
ipcMain.handle("windows-helper:stop-recording", () =>
  windowsHelperService.stopRecording()
);
ipcMain.handle("recording-overlay:show-recording", (_event, state?: Partial<RecordingOverlayState>) => {
  showOverlay({ mode: "recording", level: 0, message: "Recording", ...state });
});
ipcMain.handle("recording-overlay:show-transcribing", (_event, state?: Partial<RecordingOverlayState>) => {
  showOverlay({ mode: "transcribing", level: 0, message: "Transcribing", ...state });
});
ipcMain.handle("recording-overlay:show-finalizing", (_event, state?: Partial<RecordingOverlayState>) => {
  showOverlay({ mode: "finalizing", level: 0, message: "Finalizing", ...state });
});
ipcMain.handle("recording-overlay:hide", () => {
  hideOverlay();
});
ipcMain.handle("recording-overlay:get-state", () => overlayState);

app.whenReady().then(async () => {
  await cleanupStartupStorage().catch(() => undefined);
  await historyStore.cleanup().catch(() => undefined);
  Menu.setApplicationMenu(null);
  void settingsStore.get().then((settings) => {
    applyStartupSettings(settings);
    startAutomaticUpdateChecks(settings);
    void checkForUpdates({ revealWindowOnAvailable: true });
  });
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
  cancelActiveRealtimeCloudSession("Realtime Cloud Dictation cancelled because VoxType is quitting.");
  stopAutomaticUpdateChecks();
  stopFullscreenSuspensionWatch();
  overlayWindow?.destroy();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
