import type { ErpBridge } from "@shared/bridge";

declare global {
  interface Window {
    /** Present when running inside the Electron app (see electron/preload.ts). */
    erp?: ErpBridge;
  }
}

export {};
