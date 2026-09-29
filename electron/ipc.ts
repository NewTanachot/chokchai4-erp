import { ipcMain } from "electron";
import type { ApiResult, ErpHandlers } from "@shared/contract";
import { IPC_INVOKE_CHANNEL, IPC_LANGUAGE_CHANNEL } from "@shared/bridge";
import { toApiError } from "./api/errors";
import { mainLanguage } from "./i18n";

/** "<namespace>.<method>": exactly two plain identifiers (no "__proto__", no third segment). */
const METHOD_RE = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/;
const MAX_METHOD_LENGTH = 100;

type Handler = (input: unknown) => unknown;

const isMethodName = (m: unknown): m is string => typeof m === "string" && m.length <= MAX_METHOD_LENGTH && METHOD_RE.test(m);

/**
 * The handler for `method`, or null. Only OWN properties of the api object and of the namespace object count, so
 * inherited keys ("constructor.keys" -> Object.keys, "products.toString", "products.hasOwnProperty") are unreachable.
 */
export function resolveHandler(api: ErpHandlers, method: unknown): Handler | null {
  if (!isMethodName(method)) return null;
  const [ns, fn] = method.split(".");
  if (!Object.hasOwn(api, ns)) return null;
  const nsObj: unknown = (api as unknown as Record<string, unknown>)[ns];
  if (typeof nsObj !== "object" || nsObj === null || !Object.hasOwn(nsObj, fn)) return null;
  const handler: unknown = (nsObj as Record<string, unknown>)[fn];
  return typeof handler === "function" ? (handler as Handler) : null;
}

/**
 * One generic channel: renderer calls invoke("<namespace>.<method>", input).
 * Handlers are responsible for validating `input` with the zod schemas in shared/contract.
 */
export function registerIpc(api: ErpHandlers, isTrustedUrl: (url: string) => boolean): void {
  ipcMain.on(IPC_LANGUAGE_CHANNEL, (event) => {
    event.returnValue = isTrustedUrl(event.senderFrame?.url ?? "") ? mainLanguage() : "th";
  });
  ipcMain.handle(IPC_INVOKE_CHANNEL, async (event, method: unknown, input: unknown): Promise<ApiResult<unknown>> => {
    const senderUrl = event.senderFrame?.url ?? "";
    if (!isTrustedUrl(senderUrl)) {
      return { ok: false, error: { code: "INTERNAL", message: "คำขอไม่ได้มาจากแอป" } };
    }
    if (!isMethodName(method)) {
      return { ok: false, error: { code: "NOT_FOUND", message: "คำสั่งไม่ถูกต้อง" } };
    }
    const handler = resolveHandler(api, method);
    if (!handler) {
      return { ok: false, error: { code: "NOT_FOUND", message: `ไม่พบคำสั่ง ${method}` } };
    }
    try {
      const data = await handler(input);
      return { ok: true, data };
    } catch (e) {
      const error = toApiError(e);
      if (error.code === "INTERNAL") console.error(`[ipc] ${method} failed:`, e);
      return { ok: false, error };
    }
  });
}
