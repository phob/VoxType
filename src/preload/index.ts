import { contextBridge, ipcRenderer } from "electron";
import { type LocalModel } from "../shared/models";
import { type WhisperRuntime } from "../shared/runtimes";
import { type AppSettings, type SettingsPatch } from "../shared/settings";
import { type TranscriptEntry, type TranscriptionResult } from "../shared/transcripts";

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
    copy: (text: string) => ipcRenderer.invoke("insertion:copy", text) as Promise<void>
  }
};

contextBridge.exposeInMainWorld("voxtype", voxtype);

export type VoxTypeApi = typeof voxtype;
