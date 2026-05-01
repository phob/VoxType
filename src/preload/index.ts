import { contextBridge, ipcRenderer } from "electron";
import {
  type DictionaryCreateInput,
  type DictionaryEntry,
  type DictionaryPatch
} from "../shared/dictionary";
import { type HardwareAccelerationReport } from "../shared/hardware";
import { type HotkeyStatus } from "../shared/hotkeys";
import { type LocalModel } from "../shared/models";
import { type OcrPromptContext } from "../shared/ocr-context";
import { type OcrResult } from "../shared/ocr";
import { type WhisperRuntime } from "../shared/runtimes";
import {
  type AppProfile,
  type AppSettings,
  type InsertionMode,
  type SettingsPatch
} from "../shared/settings";
import { type TranscriptEntry, type TranscriptionResult } from "../shared/transcripts";
import { type UpdateStatus } from "../shared/updates";
import {
  type DictationOcrContextPayload,
  type DictationHotkeyPayload,
  type DictationHotkeyState,
  type NativeRecordingOptions,
  type NativeRecordingResult,
  type RecordingOverlayState,
  type ScreenshotCaptureMode,
  type ScreenshotCaptureResult,
  type ActiveWindowInfo,
  type WindowsHelperStatus
} from "../shared/windows-helper";

const voxtype = {
  getVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  getAppInfo: () =>
    ipcRenderer.invoke("app:get-info") as Promise<{
      isDeveloperBuild: boolean;
      version: string;
      versionLabel: string;
    }>,
  updates: {
    status: () => ipcRenderer.invoke("app:update-status") as Promise<UpdateStatus>,
    check: () => ipcRenderer.invoke("app:check-for-updates") as Promise<UpdateStatus>,
    install: () => ipcRenderer.invoke("app:install-update") as Promise<UpdateStatus>
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
    close: () => ipcRenderer.invoke("window:close") as Promise<void>
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
    update: (patch: SettingsPatch) =>
      ipcRenderer.invoke("settings:update", patch) as Promise<AppSettings>,
    reset: () => ipcRenderer.invoke("settings:reset") as Promise<AppSettings>
  },
  models: {
    list: () => ipcRenderer.invoke("models:list") as Promise<LocalModel[]>,
    download: (modelId: string) =>
      ipcRenderer.invoke("models:download", modelId) as Promise<LocalModel[]>,
    delete: (modelId: string) =>
      ipcRenderer.invoke("models:delete", modelId) as Promise<LocalModel[]>
  },
  runtime: {
    getWhisper: () => ipcRenderer.invoke("runtime:get-whisper") as Promise<WhisperRuntime>,
    listWhisper: () => ipcRenderer.invoke("runtime:list-whisper") as Promise<WhisperRuntime[]>,
    installWhisper: () =>
      ipcRenderer.invoke("runtime:install-whisper") as Promise<WhisperRuntime>,
    installWhisperRuntime: (runtimeId: string) =>
      ipcRenderer.invoke("runtime:install-whisper", runtimeId) as Promise<WhisperRuntime>,
    setupFirstRunCuda: () =>
      ipcRenderer.invoke("runtime:setup-first-run-cuda") as Promise<{
        runtime: WhisperRuntime;
        settings: AppSettings;
        hardware: HardwareAccelerationReport;
        installed: boolean;
        message: string;
      }>
  },
  hardware: {
    getAccelerationReport: () =>
      ipcRenderer.invoke("hardware:get-acceleration-report") as Promise<HardwareAccelerationReport>
  },
  ocr: {
    recognizeScreenshot: (imagePath: string, mode: ScreenshotCaptureMode) =>
      ipcRenderer.invoke("ocr:recognize-screenshot", imagePath, mode) as Promise<OcrResult>
  },
  transcription: {
    transcribeWav: (
      bytes: Uint8Array,
      context?: { processName?: string | null; ocrContext?: OcrPromptContext | null }
    ) =>
      ipcRenderer.invoke(
        "transcription:transcribe-wav",
        bytes,
        context
      ) as Promise<TranscriptionResult>
  },
  history: {
    list: () => ipcRenderer.invoke("history:list") as Promise<TranscriptEntry[]>,
    audio: (entryId: string) => ipcRenderer.invoke("history:audio", entryId) as Promise<Uint8Array>,
    cleanup: () => ipcRenderer.invoke("history:cleanup") as Promise<TranscriptEntry[]>
  },
  dictionary: {
    list: () => ipcRenderer.invoke("dictionary:list") as Promise<DictionaryEntry[]>,
    add: (input: DictionaryCreateInput) =>
      ipcRenderer.invoke("dictionary:add", input) as Promise<DictionaryEntry[]>,
    update: (id: string, patch: DictionaryPatch) =>
      ipcRenderer.invoke("dictionary:update", id, patch) as Promise<DictionaryEntry[]>,
    remove: (id: string) =>
      ipcRenderer.invoke("dictionary:remove", id) as Promise<DictionaryEntry[]>
  },
  insertion: {
    copy: (text: string) => ipcRenderer.invoke("insertion:copy", text) as Promise<void>,
    insertActive: (text: string) =>
      ipcRenderer.invoke("insertion:insert-active", text) as Promise<void>,
    insertWindow: (text: string, hwnd: string, processName?: string | null) =>
      ipcRenderer.invoke("insertion:insert-window", text, hwnd, processName) as Promise<void>,
    testWindow: (text: string, hwnd: string, mode: InsertionMode, processName?: string | null) =>
      ipcRenderer.invoke("insertion:test-window", text, hwnd, mode, processName) as Promise<void>,
    pasteActive: (text: string) =>
      ipcRenderer.invoke("insertion:paste-active", text) as Promise<void>,
    pasteWindow: (text: string, hwnd: string) =>
      ipcRenderer.invoke("insertion:paste-window", text, hwnd) as Promise<void>
  },
  dictation: {
    getHotkeyState: () =>
      ipcRenderer.invoke("dictation:get-hotkey-state") as Promise<DictationHotkeyState>,
    setHotkeyRecording: (recording: boolean) =>
      ipcRenderer.invoke(
        "dictation:set-hotkey-recording",
        recording
      ) as Promise<DictationHotkeyState>,
    onHotkeyStart: (callback: (payload: DictationHotkeyPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: DictationHotkeyPayload) =>
        callback(payload);
      ipcRenderer.on("dictation-hotkey-start", listener);
      return () => ipcRenderer.off("dictation-hotkey-start", listener);
    },
    onHotkeyStop: (callback: (payload: DictationHotkeyPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: DictationHotkeyPayload) =>
        callback(payload);
      ipcRenderer.on("dictation-hotkey-stop", listener);
      return () => ipcRenderer.off("dictation-hotkey-stop", listener);
    },
    onOcrContext: (callback: (payload: DictationOcrContextPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: DictationOcrContextPayload) =>
        callback(payload);
      ipcRenderer.on("dictation-ocr-context", listener);
      return () => ipcRenderer.off("dictation-ocr-context", listener);
    }
  },
  hotkeys: {
    status: () => ipcRenderer.invoke("hotkeys:status") as Promise<HotkeyStatus>,
    suspend: () => ipcRenderer.invoke("hotkeys:suspend") as Promise<HotkeyStatus>,
    resume: () => ipcRenderer.invoke("hotkeys:resume") as Promise<HotkeyStatus>
  },
  recordingOverlay: {
    showRecording: () => ipcRenderer.invoke("recording-overlay:show-recording") as Promise<void>,
    showTranscribing: () =>
      ipcRenderer.invoke("recording-overlay:show-transcribing") as Promise<void>,
    hide: () => ipcRenderer.invoke("recording-overlay:hide") as Promise<void>,
    getState: () =>
      ipcRenderer.invoke("recording-overlay:get-state") as Promise<RecordingOverlayState>,
    onState: (callback: (state: RecordingOverlayState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: RecordingOverlayState) =>
        callback(state);
      ipcRenderer.on("recording-overlay-state", listener);
      return () => ipcRenderer.off("recording-overlay-state", listener);
    }
  },
  appProfiles: {
    ensure: (windowInfo: ActiveWindowInfo | null) =>
      ipcRenderer.invoke("app-profiles:ensure", windowInfo) as Promise<AppProfile | null>,
    update: (
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
    ) => ipcRenderer.invoke("app-profiles:update", processName, patch) as Promise<AppSettings>,
    remove: (processName: string) =>
      ipcRenderer.invoke("app-profiles:remove", processName) as Promise<AppSettings>
  },
  windowsHelper: {
    status: () =>
      ipcRenderer.invoke("windows-helper:status") as Promise<WindowsHelperStatus>,
    activeWindow: () =>
      ipcRenderer.invoke("windows-helper:active-window") as Promise<ActiveWindowInfo>,
    startRecording: (options: NativeRecordingOptions) =>
      ipcRenderer.invoke("windows-helper:start-recording", options) as Promise<void>,
    stopRecording: () =>
      ipcRenderer.invoke("windows-helper:stop-recording") as Promise<NativeRecordingResult>,
    sendHotkey: (accelerator: string) =>
      ipcRenderer.invoke("windows-helper:send-hotkey", accelerator) as Promise<void>,
    captureScreenshot: (mode: ScreenshotCaptureMode) =>
      ipcRenderer.invoke(
        "windows-helper:capture-screenshot",
        mode
      ) as Promise<ScreenshotCaptureResult>,
    setSystemMute: (muted: boolean) =>
      ipcRenderer.invoke("windows-helper:set-system-mute", muted) as Promise<void>
  }
};

contextBridge.exposeInMainWorld("voxtype", voxtype);

export type VoxTypeApi = typeof voxtype;
