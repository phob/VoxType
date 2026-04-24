import { contextBridge, ipcRenderer } from "electron";

const voxtype = {
  getVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>
};

contextBridge.exposeInMainWorld("voxtype", voxtype);

export type VoxTypeApi = typeof voxtype;

