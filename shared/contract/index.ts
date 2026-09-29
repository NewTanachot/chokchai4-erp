/**
 * The complete API between the UI (renderer) and the data layer (main process).
 *
 * The renderer only ever talks to `ErpApi` (see src/lib/api.ts). Today it is served
 * over Electron IPC from a local SQLite DB; in a later phase the same interface can be
 * implemented over HTTP against a web backend without touching UI code.
 *
 * Method names on the wire are "<namespace>.<method>", e.g. "products.list".
 */
import type { AttendanceApi } from "./attendance";
import type { AuditApi } from "./audit";
import type { AuthApi, UsersApi } from "./auth";
import type { CategoriesApi, ProductsApi, ServiceItemsApi } from "./catalog";
import type { Handlers } from "./common";
import type { CustomersApi } from "./customers";
import type { EmployeesApi } from "./employees";
import type { PayrollApi } from "./payroll";
import type { ReportsApi } from "./reports";
import type { SettingsApi } from "./settings";
import type { PrintApi, SystemApi } from "./system";
import type { TransactionsApi } from "./transactions";

export interface ErpApi {
  auth: AuthApi;
  users: UsersApi;
  categories: CategoriesApi;
  products: ProductsApi;
  serviceItems: ServiceItemsApi;
  customers: CustomersApi;
  transactions: TransactionsApi;
  reports: ReportsApi;
  settings: SettingsApi;
  employees: EmployeesApi;
  attendance: AttendanceApi;
  payroll: PayrollApi;
  audit: AuditApi;
  print: PrintApi;
  system: SystemApi;
}

export type ErpNamespace = keyof ErpApi;

export type ErpHandlers = { [NS in keyof ErpApi]: Handlers<ErpApi[NS]> };

export * from "./common";
export * from "./auth";
export * from "./audit";
export * from "./employees";
export * from "./attendance";
export * from "./payroll";
export * from "./catalog";
export * from "./customers";
export * from "./transactions";
export * from "./reports";
export * from "./settings";
export * from "./system";
