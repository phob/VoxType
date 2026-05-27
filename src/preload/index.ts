import { contextBridge, ipcRenderer } from "electron";
import {
  type DictionaryCreateInput,
  type DictionaryEntry,
  type DictionaryPatch
} from "../shared/dictionary";
import { type PromptPack } from "../shared/asr";
import { type CloudDictationReadiness } from "../shared/cloud-status";
import { type HardwareAccelerationReport } from "../shared/hardware";
import { type HotkeyStatus } from "../shared/hotkeys";
import { type LocalModel } from "../shared/models";
import { type OcrPromptContext } from "../shared/ocr-context";
import { type OcrResult } from "../shared/ocr";
import { type OpenAiCredentialStatus } from "../shared/openai-credentials";
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
  type NativeInputDevice,
  type RecordingOverlayState,
  type ScreenshotCaptureMode,
  type ScreenshotCaptureResult,
  type ActiveWindowInfo,
  type WindowsHelperStatus
} from "../shared/windows-helper";

type IpcInvoke = <T>(channel: string, ...args: unknown[]) => Promise<T>;

const invoke: IpcInvoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args) as Promise<never>;

function invokeVoid(channel: string, ...args: unknown[]): Promise<void> {
  return ipcRenderer.invoke(channel, ...args) as Promise<void>;
}

function onChannel(channel: string, callback: (payload: unknown) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}

const voxtype = {
  getVersion: () => invoke<string>("app:get-version"),
  getAppInfo: () =>
    invoke<{
      isDeveloperBuild: boolean;
      version: string;
      versionLabel: string;
    }>("app:get-info"),
  updates: {
    status: () => invoke<UpdateStatus>("app:update-status"),
    check: () => invoke<UpdateStatus>("app:check-for-updates"),
    install: () => invoke<UpdateStatus>("app:install-update"),
    onStatus: (callback: (status: UpdateStatus) => void) =>
      onChannel("app-update-status", (payload) => {
        callback(payload as UpdateStatus);
      })
  },
  window: {
    minimize: () => invokeVoid("window:minimize"),
    close: () => invokeVoid("window:close")
  },
  diagnostics: {
    logRealtimeTiming: (event: string, details?: Record<string, unknown>) =>
      invokeVoid("diagnostics:realtime-timing", event, details)
  },
  settings: {
    get: () => invoke<AppSettings>("settings:get"),
    update: (patch: SettingsPatch) =>
      invoke<AppSettings>("settings:update", patch),
    reset: () => invoke<AppSettings>("settings:reset")
  },
  openaiCredentials: {
    testConnection: () =>
      invoke<{ ok: boolean; message: string }>("openai:test-connection"),
    getStatus: () =>
      invoke<OpenAiCredentialStatus>("openai-credentials:get-status"),
    setApiKey: (apiKey: string) =>
      invoke<OpenAiCredentialStatus>("openai-credentials:set-api-key", apiKey),
    clearApiKey: () =>
      invoke<OpenAiCredentialStatus>("openai-credentials:clear-api-key")
  },
  models: {
    list: () => invoke<LocalModel[]>("models:list"),
    download: (modelId: string) =>
      invoke<LocalModel[]>("models:download", modelId),
    delete: (modelId: string) =>
      invoke<LocalModel[]>("models:delete", modelId)
  },
  runtime: {
    getWhisper: () => invoke<WhisperRuntime>("runtime:get-whisper"),
    listWhisper: () => invoke<WhisperRuntime[]>("runtime:list-whisper"),
    installWhisper: () =>
      invoke<WhisperRuntime>("runtime:install-whisper"),
    installWhisperRuntime: (runtimeId: string) =>
      invoke<WhisperRuntime>("runtime:install-whisper", runtimeId),
    setupFirstRunCuda: () =>
      invoke<{
        runtime: WhisperRuntime;
        settings: AppSettings;
        hardware: HardwareAccelerationReport;
        installed: boolean;
        message: string;
      }>("runtime:setup-first-run-cuda")
  },
  hardware: {
    getAccelerationReport: () =>
      invoke<HardwareAccelerationReport>("hardware:get-acceleration-report")
  },
  ocr: {
    recognizeScreenshot: (imagePath: string, mode: ScreenshotCaptureMode) =>
      invoke<OcrResult>("ocr:recognize-screenshot", imagePath, mode)
  },
  transcription: {
    previewPromptPack: (context?: {
      processName?: string | null;
      ocrContext?: OcrPromptContext | null;
    }) =>
      invoke<PromptPack | null>("transcription:preview-prompt-pack", context),
    getReadiness: (processName?: string | null) =>
      invoke<CloudDictationReadiness>("transcription:get-readiness", processName),
    transcribeWav: (
      bytes: Uint8Array,
      context?: {
        processName?: string | null;
        ocrContext?: OcrPromptContext | null;
        forceModeId?: "local.custom";
      }
    ) =>
      invoke<TranscriptionResult>(
        "transcription:transcribe-wav",
        bytes,
        context
      ),
    startRealtime: (context?: { processName?: string | null; ocrContext?: OcrPromptContext | null }) =>
      invokeVoid("transcription:realtime-start", context),
    appendRealtimePcm16: (bytes: Uint8Array) =>
      invokeVoid("transcription:realtime-append-pcm16", bytes),
    finalizeRealtime: (fallbackWavBytes?: Uint8Array) =>
      invoke<TranscriptEntry>("transcription:realtime-finalize", fallbackWavBytes),
    cancelRealtime: (reason?: string) =>
      invokeVoid("transcription:realtime-cancel", reason)
  },
  history: {
    list: () => invoke<TranscriptEntry[]>("history:list"),
    audio: (entryId: string) => invoke<Uint8Array>("history:audio", entryId),
    cleanup: () => invoke<TranscriptEntry[]>("history:cleanup")
  },
  dictionary: {
    list: () => invoke<DictionaryEntry[]>("dictionary:list"),
    add: (input: DictionaryCreateInput) =>
      invoke<DictionaryEntry[]>("dictionary:add", input),
    update: (id: string, patch: DictionaryPatch) =>
      invoke<DictionaryEntry[]>("dictionary:update", id, patch),
    remove: (id: string) =>
      invoke<DictionaryEntry[]>("dictionary:remove", id)
  },
  insertion: {
    copy: (text: string) => invokeVoid("insertion:copy", text),
    insertActive: (text: string) =>
      invokeVoid("insertion:insert-active", text),
    insertWindow: (text: string, hwnd: string, processName?: string | null) =>
      invokeVoid("insertion:insert-window", text, hwnd, processName),
    testWindow: (text: string, hwnd: string, mode: InsertionMode, processName?: string | null) =>
      invokeVoid("insertion:test-window", text, hwnd, mode, processName),
    pasteActive: (text: string) =>
      invokeVoid("insertion:paste-active", text),
    pasteWindow: (text: string, hwnd: string) =>
      invokeVoid("insertion:paste-window", text, hwnd)
  },
  dictation: {
    getHotkeyState: () =>
      invoke<DictationHotkeyState>("dictation:get-hotkey-state"),
    setHotkeyRecording: (recording: boolean) =>
      invoke<DictationHotkeyState>(
        "dictation:set-hotkey-recording",
        recording
      ),
    onHotkeyStart: (callback: (payload: DictationHotkeyPayload) => void) =>
      onChannel("dictation-hotkey-start", (payload) => {
        callback(payload as DictationHotkeyPayload);
      }),
    onHotkeyStop: (callback: (payload: DictationHotkeyPayload) => void) =>
      onChannel("dictation-hotkey-stop", (payload) => {
        callback(payload as DictationHotkeyPayload);
      }),
    onOcrContext: (callback: (payload: DictationOcrContextPayload) => void) =>
      onChannel("dictation-ocr-context", (payload) => {
        callback(payload as DictationOcrContextPayload);
      })
  },
  hotkeys: {
    status: () => invoke<HotkeyStatus>("hotkeys:status"),
    suspend: () => invoke<HotkeyStatus>("hotkeys:suspend"),
    resume: () => invoke<HotkeyStatus>("hotkeys:resume")
  },
  recordingOverlay: {
    showRecording: (state?: Partial<RecordingOverlayState>) =>
      invokeVoid("recording-overlay:show-recording", state),
    showTranscribing: (state?: Partial<RecordingOverlayState>) =>
      invokeVoid("recording-overlay:show-transcribing", state),
    showFinalizing: (state?: Partial<RecordingOverlayState>) =>
      invokeVoid("recording-overlay:show-finalizing", state),
    hide: () => invokeVoid("recording-overlay:hide"),
    getState: () =>
      invoke<RecordingOverlayState>("recording-overlay:get-state"),
    onState: (callback: (state: RecordingOverlayState) => void) =>
      onChannel("recording-overlay-state", (payload) => {
        callback(payload as RecordingOverlayState);
      })
  },
  appProfiles: {
    ensure: (windowInfo: ActiveWindowInfo | null) =>
      invoke<AppProfile | null>("app-profiles:ensure", windowInfo),
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
        | "dictationModeId"
        | "forbidCloudDictation"
        | "cloudPromptPackOcrEnabled"
        | "neverSuspendDictationInFullscreen"
      >
    ) => invoke<AppSettings>("app-profiles:update", processName, patch),
    remove: (processName: string) =>
      invoke<AppSettings>("app-profiles:remove", processName)
  },
  windowsHelper: {
    status: () =>
      invoke<WindowsHelperStatus>("windows-helper:status"),
    activeWindow: () =>
      invoke<ActiveWindowInfo>("windows-helper:active-window"),
    inputDevices: () =>
      invoke<NativeInputDevice[]>("windows-helper:input-devices"),
    startRecording: (options: NativeRecordingOptions) =>
      invokeVoid("windows-helper:start-recording", options),
    stopRecording: () =>
      invoke<NativeRecordingResult>("windows-helper:stop-recording"),
    sendHotkey: (accelerator: string) =>
      invokeVoid("windows-helper:send-hotkey", accelerator),
    captureScreenshot: (mode: ScreenshotCaptureMode) =>
      invoke<ScreenshotCaptureResult>(
        "windows-helper:capture-screenshot",
        mode
      ),
    setSystemMute: (muted: boolean) =>
      invokeVoid("windows-helper:set-system-mute", muted)
  }
};

contextBridge.exposeInMainWorld("voxtype", voxtype);

export type VoxTypeApi = typeof voxtype;
