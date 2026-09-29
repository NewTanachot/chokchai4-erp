import type { ApiResult } from "./contract/common";
import type { Lang } from "./i18n";

/** Object exposed by electron/preload.ts as `window.erp`. */
export interface ErpBridge {
  invoke(method: string, input?: unknown): Promise<ApiResult<unknown>>;
  platform: string;
  isElectron: true;
  /** Program language when the page loaded (changing it reloads the page). */
  language: Lang;
}

export const IPC_INVOKE_CHANNEL = "erp:invoke";
/** Synchronous (sendSync) request for the program language, used once by the preload. */
export const IPC_LANGUAGE_CHANNEL = "erp:language";
