/**
 * Typed client for the data layer. Usage: `await api.products.list({ search: "มิชลิน" })`.
 *
 * Transport today: Electron IPC (window.erp). A future web build can swap this file for an
 * HTTP implementation of the same `ErpApi` interface; UI code stays unchanged.
 */
import { APP_NAME } from "@shared/app";
import type { ApiError, ErpApi } from "@shared/contract";
import { tr } from "@/lib/i18n";

export class ApiClientError extends Error {
  code: ApiError["code"];
  details?: unknown;
  constructor(error: ApiError) {
    // The main process writes messages in Thai; show them in the page's language.
    super(tr(error.message));
    this.name = "ApiClientError";
    this.code = error.code;
    this.details = error.details;
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.erp?.isElectron;
}

async function invoke(method: string, input: unknown): Promise<unknown> {
  if (typeof window === "undefined" || !window.erp) {
    throw new ApiClientError({ code: "INTERNAL", message: tr("กรุณาเปิดผ่านโปรแกรม {0} (ไม่พบการเชื่อมต่อฐานข้อมูล)", APP_NAME) });
  }
  const res = await window.erp.invoke(method, input);
  if (!res.ok) {
    // Logged out (auto-lock, account disabled...): the auth gate shows the login screen.
    if (res.error.code === "UNAUTHORIZED") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiClientError(res.error);
  }
  return res.data;
}

/** Fired on window when a call fails because nobody is logged in. */
export const UNAUTHORIZED_EVENT = "erp:unauthorized";

function namespaceProxy(ns: string): unknown {
  return new Proxy(
    {},
    {
      get(_t, fn) {
        if (typeof fn !== "string" || fn === "then") return undefined;
        return (input?: unknown) => invoke(`${ns}.${fn}`, input);
      },
    },
  );
}

const cache = new Map<string, unknown>();

export const api = new Proxy({} as ErpApi, {
  get(_t, ns) {
    if (typeof ns !== "string" || ns === "then") return undefined;
    if (!cache.has(ns)) cache.set(ns, namespaceProxy(ns));
    return cache.get(ns);
  },
});

/** Human-readable message for any thrown error (for toasts / inline errors). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
