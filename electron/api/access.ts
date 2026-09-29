/**
 * Who may call what. Every API method has exactly one rule here (the table is typed over ErpHandlers, so a new
 * method does not compile until it gets one). The IPC router wraps the API with `withAccessControl`, so the rules
 * hold whatever the renderer does; handlers themselves stay permission-free and are used as-is by tests.
 */
import { eq } from "drizzle-orm";
import { PERMISSION_INFO, type ErpHandlers, type Permission } from "@shared/contract";
import { transactions } from "../db/schema";
import type { ApiContext } from "./context";
import { AppError } from "./errors";
import { currentUser, hasPermission } from "./session";

/**
 * public = no login needed; user = any logged-in user; owner = owners only; a permission; all of a list of
 * permissions; or any one of `anyOf`.
 */
export type AccessRule = "public" | "user" | "owner" | Permission | Permission[] | { anyOf: Permission[] };
/** A rule, or a function of the call's input that picks one (e.g. purchases need more than sales). */
export type Access = AccessRule | ((input: unknown, ctx: ApiContext) => AccessRule);

type AccessTable = { [NS in keyof ErpHandlers]: { [M in keyof ErpHandlers[NS]]: Access } };

const field = (input: unknown, key: string): unknown => (typeof input === "object" && input !== null ? (input as Record<string, unknown>)[key] : undefined);
const isPurchaseInput = (input: unknown) => field(input, "type") === "purchase";

function billIsPurchase(ctx: ApiContext, id: unknown): boolean {
  if (typeof id !== "string") return false;
  return ctx.db.select({ type: transactions.type }).from(transactions).where(eq(transactions.id, id)).get()?.type === "purchase";
}

/** Settings sections: pay rules belong to whoever manages payroll, everything else to settings.manage. */
function settingsRule(input: unknown): AccessRule {
  const keys = typeof input === "object" && input !== null ? Object.keys(input).filter((k) => field(input, k) !== undefined) : [];
  const need = new Set<Permission>();
  for (const k of keys) need.add(k === "payroll" ? "employees.manage" : "settings.manage");
  return need.size ? [...need] : "settings.manage";
}

const STAFF_DATA: { anyOf: Permission[] } = { anyOf: ["attendance.manage", "employees.manage"] };
const PRICE_HISTORY: { anyOf: Permission[] } = { anyOf: ["catalog.manage", "audit.view"] };

export const ACCESS: AccessTable = {
  auth: {
    status: "public",
    setupOwner: "public",
    login: "public",
    logout: "public",
    changePassword: "user",
    recover: "public",
    newRecoveryCode: "owner",
  },
  users: { list: "owner", create: "owner", update: "owner", resetPassword: "owner", remove: "owner" },
  categories: { list: "user", create: "catalog.manage", update: "catalog.manage", remove: "catalog.manage", reorder: "catalog.manage" },
  products: {
    list: "user",
    get: "user",
    create: "catalog.manage",
    update: "catalog.manage",
    remove: "catalog.manage",
    adjustStock: "stock.adjust",
    movements: "user",
    stats: "user",
    priceHistory: PRICE_HISTORY,
  },
  serviceItems: { list: "user", get: "user", create: "catalog.manage", update: "catalog.manage", remove: "catalog.manage", priceHistory: PRICE_HISTORY },
  customers: { list: "user", get: "user", create: "user", update: "customers.manage", remove: "customers.manage", history: "user" },
  transactions: {
    list: "user",
    get: "user",
    nextDocNo: "user",
    create: (input) => (isPurchaseInput(input) ? "purchases.create" : "user"),
    update: (input) => (isPurchaseInput(input) ? ["transactions.edit", "purchases.create"] : "transactions.edit"),
    void: (input, ctx) => (billIsPurchase(ctx, field(input, "id")) ? ["transactions.void", "purchases.create"] : "transactions.void"),
    markPaid: (input, ctx) => (billIsPurchase(ctx, field(input, "id")) ? "purchases.create" : "user"),
  },
  reports: { summary: "reports.view", daily: "reports.view", topItems: "reports.view", lowStock: "user", recent: "user" },
  settings: { get: "user", update: settingsRule },
  employees: { list: "employees.manage", get: "employees.manage", create: "employees.manage", update: "employees.manage", remove: "employees.manage" },
  attendance: {
    board: "public",
    clock: "public",
    list: STAFF_DATA,
    create: STAFF_DATA,
    update: STAFF_DATA,
    remove: STAFF_DATA,
    leaves: STAFF_DATA,
    saveLeave: STAFF_DATA,
    removeLeave: STAFF_DATA,
    summary: STAFF_DATA,
  },
  payroll: {
    listRuns: "employees.manage",
    getRun: "employees.manage",
    candidates: "employees.manage",
    createRun: "employees.manage",
    updateRun: "employees.manage",
    removeRun: "employees.manage",
    addPayslip: "employees.manage",
    getPayslip: "employees.manage",
    updatePayslip: "employees.manage",
    recalculate: "employees.manage",
    removePayslip: "employees.manage",
    pay: "employees.manage",
    unpay: "employees.manage",
    employeePayslips: "employees.manage",
    listAdvances: "employees.manage",
    createAdvance: "employees.manage",
    removeAdvance: "employees.manage",
  },
  audit: { list: "audit.view" },
  print: { printers: "user", print: "user", savePdf: "user", printPayslip: "employees.manage", savePayslipPdf: "employees.manage" },
  system: {
    info: "user",
    backup: "settings.manage",
    listBackups: "settings.manage",
    restore: "owner",
    openDataFolder: "settings.manage",
    openExternal: "user",
    setLanguage: "public",
  },
};

const forbidden = (p: Permission) => new AppError("FORBIDDEN", `คุณไม่มีสิทธิ์ "${PERMISSION_INFO[p].label}" กรุณาให้เจ้าของร้านเพิ่มสิทธิ์ให้`, { permission: p });

/** Throws UNAUTHORIZED / FORBIDDEN unless the session may call `ns.method` with this input. */
export function checkAccess(ctx: ApiContext, ns: string, method: string, input: unknown): void {
  const access = (ACCESS as unknown as Record<string, Record<string, Access> | undefined>)[ns]?.[method];
  if (access === undefined) throw new AppError("FORBIDDEN", "ไม่อนุญาตให้ใช้คำสั่งนี้");
  const rule = typeof access === "function" ? access(input, ctx) : access;
  if (rule === "public") return;
  const user = currentUser(ctx.db, ctx.session);
  if (!user) throw new AppError("UNAUTHORIZED", "กรุณาเข้าสู่ระบบก่อนใช้งาน");
  if (rule === "user") return;
  if (rule === "owner") {
    if (user.role !== "owner") throw new AppError("FORBIDDEN", "เฉพาะเจ้าของร้านเท่านั้น");
    return;
  }
  if (typeof rule === "object" && !Array.isArray(rule)) {
    if (!rule.anyOf.some((p) => hasPermission(user, p))) throw forbidden(rule.anyOf[0]);
    return;
  }
  for (const p of Array.isArray(rule) ? rule : [rule]) if (!hasPermission(user, p)) throw forbidden(p);
}

/** The API with every method guarded by its rule (used for IPC). */
export function withAccessControl(api: ErpHandlers, ctx: ApiContext): ErpHandlers {
  const out: Record<string, Record<string, (input: unknown) => unknown>> = {};
  for (const [ns, methods] of Object.entries(api as unknown as Record<string, Record<string, (input: unknown) => unknown>>)) {
    out[ns] = {};
    for (const [name, fn] of Object.entries(methods)) {
      out[ns][name] = (input: unknown) => {
        checkAccess(ctx, ns, name, input);
        return fn(input);
      };
    }
  }
  return out as unknown as ErpHandlers;
}
