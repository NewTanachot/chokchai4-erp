import type { ErpHandlers, Permission } from "@shared/contract";
import { withAccessControl } from "../../electron/api/access";
import { toApiError } from "../../electron/api/errors";
import type { createTestApi } from "./db";

type T = ReturnType<typeof createTestApi>;

/** First-run owner account (logged in afterwards). */
export async function setupOwner(t: T, name = "เจ้าของร้าน", password = "1234") {
  return t.api.auth.setupOwner({ name, password });
}

/** A staff user (the current session must be an owner, or none in raw tests). */
export async function addStaff(t: T, name: string, permissions: Permission[] = [], password = "1111") {
  return t.api.users.create({ name, role: "staff", permissions, password });
}

export async function loginAs(t: T, userId: string, password: string) {
  return t.api.auth.login({ userId, password });
}

/** The API as the renderer sees it through IPC: every call checked by the access rules. */
export function guardedApi(t: T): ErpHandlers {
  const stub = () => {
    throw new Error("not available in tests");
  };
  const api: ErpHandlers = {
    ...t.api,
    print: { printers: stub, print: stub, savePdf: stub, printPayslip: stub, savePayslipPdf: stub },
    system: { info: stub, backup: stub, listBackups: stub, restore: stub, openDataFolder: stub, openExternal: stub, setLanguage: stub },
  };
  return withAccessControl(api, t.ctx);
}

/** Runs `fn` and returns the mapped API error. */
export async function apiError(fn: () => unknown): Promise<{ code: string; message: string; details?: unknown }> {
  try {
    await fn();
  } catch (e) {
    return toApiError(e);
  }
  throw new Error("expected the call to fail");
}
