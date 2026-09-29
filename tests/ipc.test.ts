import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, ErpHandlers } from "@shared/contract";
import { IPC_INVOKE_CHANNEL, IPC_LANGUAGE_CHANNEL } from "@shared/bridge";

type InvokeListener = (event: unknown, method: unknown, input: unknown) => Promise<ApiResult<unknown>>;
type SyncListener = (event: { returnValue?: unknown; senderFrame?: { url: string } }) => void;

const electron = vi.hoisted(() => ({ listeners: new Map<string, InvokeListener>(), syncListeners: new Map<string, SyncListener>() }));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: InvokeListener) => electron.listeners.set(channel, fn),
    on: (channel: string, fn: SyncListener) => electron.syncListeners.set(channel, fn),
  },
  // Only touched when windows / the protocol are created, never by these tests.
  BrowserWindow: class {},
  nativeTheme: {},
  shell: {},
  net: {},
  protocol: {},
}));

import { AppError } from "../electron/api/errors";
import { setMainLanguage } from "../electron/i18n";
import { registerIpc, resolveHandler } from "../electron/ipc";
import { isTrustedUrl } from "../electron/window";
import { createTestApi } from "./helpers/db";

const APP_URL = "app://erp/transactions/";
const frame = (url: string | undefined) => (url === undefined ? {} : { senderFrame: { url } });

/** Registers `api` on the mocked ipcMain and returns a caller that goes through the real router. */
function router(api: unknown, trusted: (url: string) => boolean = isTrustedUrl) {
  electron.listeners.clear();
  registerIpc(api as ErpHandlers, trusted);
  const listener = electron.listeners.get(IPC_INVOKE_CHANNEL);
  if (!listener) throw new Error("registerIpc did not register the invoke channel");
  return (method: unknown, input?: unknown, event: unknown = frame(APP_URL)) => listener(event, method, input);
}

/** Inherited / non-API keys on either level; none may resolve to a handler. */
const INHERITED = [
  "constructor.keys",
  "constructor.entries",
  "constructor.assign",
  "constructor.getOwnPropertyNames",
  "constructor.defineProperty",
  "__proto__.toString",
  "__proto__.valueOf",
  "__proto__.hasOwnProperty",
  "toString.call",
  "hasOwnProperty.call",
  "valueOf.apply",
  "products.toString",
  "products.valueOf",
  "products.hasOwnProperty",
  "products.isPrototypeOf",
  "products.propertyIsEnumerable",
  "products.toLocaleString",
  "products.constructor",
  "products.__proto__",
  "products.__defineGetter__",
  "products.__lookupGetter__",
];

describe("ipc router", () => {
  let t: ReturnType<typeof createTestApi>;
  let call: ReturnType<typeof router>;
  beforeEach(() => {
    t = createTestApi();
    call = router(t.api);
  });
  afterEach(() => t.close());

  it("routes '<namespace>.<method>' to the handler and wraps the result", async () => {
    const created = await call("products.create", { name: "ยาง Michelin", costPrice: 150000, sellPrice: 200000 });
    expect(created.ok).toBe(true);
    const list = await call("products.list", {});
    expect(list).toMatchObject({ ok: true });
    expect((list as { ok: true; data: { items: { name: string }[] } }).data.items.map((p) => p.name)).toContain("ยาง Michelin");
  });

  it("maps handler errors: zod -> VALIDATION, AppError -> its code, anything else -> INTERNAL", async () => {
    const invalid = await call("products.create", { name: "" });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION" } });

    const missing = await call("products.get", "0190a000-0000-7000-8000-000000000000");
    expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND", message: "ไม่พบสินค้า" } });

    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const boom = router({
        demo: {
          fail: () => {
            throw new Error("disk on fire");
          },
          conflict: () => {
            throw new AppError("CONFLICT", "บิลนี้ถูกยกเลิกแล้ว");
          },
          later: async () => {
            await Promise.resolve();
            throw new Error("async failure");
          },
        },
      });
      expect(await boom("demo.fail")).toEqual({ ok: false, error: { code: "INTERNAL", message: "เกิดข้อผิดพลาด: disk on fire" } });
      expect(await boom("demo.conflict")).toMatchObject({ ok: false, error: { code: "CONFLICT", message: "บิลนี้ถูกยกเลิกแล้ว" } });
      expect(await boom("demo.later")).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
      // Only unexpected (INTERNAL) errors are logged.
      expect(quiet).toHaveBeenCalledTimes(2);
    } finally {
      quiet.mockRestore();
    }
  });

  it("returns NOT_FOUND for an unknown namespace or method", async () => {
    expect(await call("nope.list")).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "ไม่พบคำสั่ง nope.list" } });
    expect(await call("products.nope")).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "ไม่พบคำสั่ง products.nope" } });
  });

  it.each(INHERITED)("never reaches inherited or non-API keys: %s", async (method) => {
    const res = await call(method, { a: 1 });
    expect(res.ok).toBe(false);
    expect((res as { ok: false; error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("rejects malformed method names instead of guessing (no third segment, no empty parts)", async () => {
    for (const method of ["products.list.extra", "products..list", ".list", "products.", "products", "", "products.list ", "products/list", "สินค้า.list"]) {
      expect(await call(method, {}), method).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "คำสั่งไม่ถูกต้อง" } });
    }
    expect(await call(`products.${"x".repeat(200)}`)).toMatchObject({ ok: false, error: { message: "คำสั่งไม่ถูกต้อง" } });
  });

  it("rejects non-string method values", async () => {
    for (const method of [123, null, undefined, {}, ["products", "list"], { toString: () => "products.list" }]) {
      expect(await call(method, {})).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "คำสั่งไม่ถูกต้อง" } });
    }
  });
});

describe("ipc sender check", () => {
  it("refuses requests from pages that are not the app, without running the handler", async () => {
    const list = vi.fn(() => []);
    const call = router({ products: { list } });
    for (const event of [frame("https://evil.example/"), frame("app://erp.evil.example/"), frame("file:///C:/x.html"), frame(""), frame(undefined), {}]) {
      expect(await call("products.list", {}, event)).toEqual({ ok: false, error: { code: "INTERNAL", message: "คำขอไม่ได้มาจากแอป" } });
    }
    expect(list).not.toHaveBeenCalled();
    expect(await call("products.list", {}, frame("app://erp/"))).toEqual({ ok: true, data: [] });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("tells the app's pages (only) the program language, synchronously", () => {
    router({});
    const language = electron.syncListeners.get(IPC_LANGUAGE_CHANNEL)!;
    const ask = (url: string) => {
      const event: { returnValue?: unknown; senderFrame: { url: string } } = { senderFrame: { url } };
      language(event);
      return event.returnValue;
    };
    expect(ask(APP_URL)).toBe("th");
    setMainLanguage("en");
    try {
      expect(ask(APP_URL)).toBe("en");
      expect(ask("https://evil.example/")).toBe("th");
    } finally {
      setMainLanguage("th");
    }
  });

  it("isTrustedUrl accepts only the app origin (exact, or followed by a path)", () => {
    expect(isTrustedUrl("app://erp")).toBe(true);
    expect(isTrustedUrl("app://erp/")).toBe(true);
    expect(isTrustedUrl("app://erp/print/?id=1&kind=receipt")).toBe(true);
    expect(isTrustedUrl("app://erp.evil/")).toBe(false);
    expect(isTrustedUrl("app://erpx/")).toBe(false);
    expect(isTrustedUrl("http://localhost:3123/")).toBe(false); // dev origin only when ERP_DEV_URL is set
    expect(isTrustedUrl("")).toBe(false);
  });
});

describe("resolveHandler", () => {
  const fn = () => "ok";
  const api = { products: { list: fn, label: "not a function", nested: { deep: fn } }, empty: null } as unknown as ErpHandlers;

  it("returns own function properties only", () => {
    expect(resolveHandler(api, "products.list")).toBe(fn);
    expect(resolveHandler(api, "products.label")).toBeNull();
    expect(resolveHandler(api, "products.nested")).toBeNull();
    expect(resolveHandler(api, "empty.list")).toBeNull();
    expect(resolveHandler(api, "products.nested.deep")).toBeNull();
    for (const method of INHERITED) expect(resolveHandler(api, method), method).toBeNull();
  });

  it("ignores properties inherited through a namespace's prototype", () => {
    const withProto = { reports: Object.create({ secret: fn }) } as unknown as ErpHandlers;
    expect(resolveHandler(withProto, "reports.secret")).toBeNull();
  });
});
