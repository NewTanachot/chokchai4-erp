import type { ErpHandlers } from "@shared/contract";
import type { ApiContext } from "./context";
import { createAttendanceApi } from "./attendance";
import { createAuditApi } from "./audit";
import { createAuthApi } from "./auth";
import { createCategoriesApi } from "./categories";
import { createCustomersApi } from "./customers";
import { createEmployeesApi } from "./employees";
import { createPayrollApi } from "./payroll";
import { createProductsApi } from "./products";
import { createReportsApi } from "./reports";
import { createServiceItemsApi } from "./service-items";
import { createSettingsApi } from "./settings";
import { createTransactionsApi } from "./transactions";
import { createUsersApi } from "./users";

export type CoreHandlers = Omit<ErpHandlers, "print" | "system">;

/** Pure data namespaces (no Electron dependency) - used by the app and by tests. */
export function createCoreApi(ctx: ApiContext): CoreHandlers {
  return {
    auth: createAuthApi(ctx),
    users: createUsersApi(ctx),
    categories: createCategoriesApi(ctx),
    products: createProductsApi(ctx),
    serviceItems: createServiceItemsApi(ctx),
    customers: createCustomersApi(ctx),
    transactions: createTransactionsApi(ctx),
    reports: createReportsApi(ctx),
    settings: createSettingsApi(ctx),
    employees: createEmployeesApi(ctx),
    attendance: createAttendanceApi(ctx),
    payroll: createPayrollApi(ctx),
    audit: createAuditApi(ctx),
  };
}
