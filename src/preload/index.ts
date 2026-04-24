import { contextBridge, ipcRenderer } from "electron";
import {
  type DictionaryCreateInput,
  type DictionaryEntry,
  type DictionaryPatch
} from "../shared/dictionary";
import { type HotkeyStatus } from "../shared/hotkeys";
import { type LocalModel } from "../shared/models";
import { type WhisperRuntime } from "../shared/runtimes";
import {
  type AppProfile,
  type AppSettings,
  type InsertionMode,
  type SettingsPatch
} from "../shared/settings";
import { type TranscriptEntry, type TranscriptionResult } from "../shared/transcripts";
import {
  type DictationHotkeyPayload,
  type DictationHotkeyState,
  type NativeRecordingOptions,
  type NativeRecordingResult,
  type ActiveWindowInfo,
  type WindowsHelperStatus
} from "../shared/windows-helper";

const voxtype = {
  getVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  settings: {
    get: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
    update: (patch: SettingsPatch) =>
      ipcRenderer.invoke("settings:update", patch) as Promise<AppSettings>,
    reset: () => ipcRenderer.invoke("settings:reset") as Promise<AppSettings>
  },
  models: {
    list: () => ipcRenderer.invoke("models:list") as Promise<LocalModel[]>,
    download: (modelId: string) =>
      ipcRenderer.invoke("models:download", modelId) as Promise<LocalModel[]>
  },
  runtime: {
    getWhisper: () => ipcRenderer.invoke("runtime:get-whisper") as Promise<WhisperRuntime>,
    installWhisper: () =>
      ipcRenderer.invoke("runtime:install-whisper") as Promise<WhisperRuntime>
  },
  transcription: {
    transcribeWav: (bytes: Uint8Array, context?: { processName?: string | null }) =>
      ipcRenderer.invoke(
        "transcription:transcribe-wav",
        bytes,
        context
      ) as Promise<TranscriptionResult>
  },
  history: {
    list: () => ipcRenderer.invoke("history:list") as Promise<TranscriptEntry[]>,
    audio: (entryId: string) => ipcRenderer.invoke("history:audio", entryId) as Promise<Uint8Array>
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
    }
  },
  hotkeys: {
    status: () => ipcRenderer.invoke("hotkeys:status") as Promise<HotkeyStatus>
  },
  appProfiles: {
    ensure: (windowInfo: ActiveWindowInfo | null) =>
      ipcRenderer.invoke("app-profiles:ensure", windowInfo) as Promise<AppProfile | null>,
    update: (
      processName: string,
      patch: Pick<AppProfile, "insertionMode" | "writingStyle">
    ) => ipcRenderer.invoke("app-profiles:update", processName, patch) as Promise<AppSettings>
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
    setSystemMute: (muted: boolean) =>
      ipcRenderer.invoke("windows-helper:set-system-mute", muted) as Promise<void>
  }
};

contextBridge.exposeInMainWorld("voxtype", voxtype);

export type VoxTypeApi = typeof voxtype;
