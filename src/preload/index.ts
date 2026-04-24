import { contextBridge, ipcRenderer } from "electron";
import { type AppSettings, type SettingsPatch } from "../shared/settings";

const voxtype = {
  getVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  settings: {
    get: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
    update: (patch: SettingsPatch) =>
      ipcRenderer.invoke("settings:update", patch) as Promise<AppSettings>,
    reset: () => ipcRenderer.invoke("settings:reset") as Promise<AppSettings>
  }
};

contextBridge.exposeInMainWorld("voxtype", voxtype);

export type VoxTypeApi = typeof voxtype;
