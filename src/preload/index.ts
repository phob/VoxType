import { contextBridge, ipcRenderer } from "electron";
import { type HotkeyStatus } from "../shared/hotkeys";
import { type LocalModel } from "../shared/models";
import { type WhisperRuntime } from "../shared/runtimes";
import { type AppSettings, type SettingsPatch } from "../shared/settings";
import { type TranscriptEntry, type TranscriptionResult } from "../shared/transcripts";
import {
  type DictationHotkeyPayload,
  type DictationHotkeyState,
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
    transcribeWav: (bytes: Uint8Array) =>
      ipcRenderer.invoke("transcription:transcribe-wav", bytes) as Promise<TranscriptionResult>
  },
  history: {
    list: () => ipcRenderer.invoke("history:list") as Promise<TranscriptEntry[]>
  },
  insertion: {
    copy: (text: string) => ipcRenderer.invoke("insertion:copy", text) as Promise<void>,
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
  windowsHelper: {
    status: () =>
      ipcRenderer.invoke("windows-helper:status") as Promise<WindowsHelperStatus>,
    activeWindow: () =>
      ipcRenderer.invoke("windows-helper:active-window") as Promise<ActiveWindowInfo>
  }
};

contextBridge.exposeInMainWorld("voxtype", voxtype);

export type VoxTypeApi = typeof voxtype;
