import { contextBridge, ipcRenderer } from "electron";
import { IPC_INVOKE_CHANNEL, IPC_LANGUAGE_CHANNEL, type ErpBridge } from "@shared/bridge";

const language: unknown = ipcRenderer.sendSync(IPC_LANGUAGE_CHANNEL);

const bridge: ErpBridge = {
  invoke: (method, input) => ipcRenderer.invoke(IPC_INVOKE_CHANNEL, method, input),
  platform: process.platform,
  isElectron: true,
  language: language === "en" ? "en" : "th",
};

contextBridge.exposeInMainWorld("erp", bridge);
