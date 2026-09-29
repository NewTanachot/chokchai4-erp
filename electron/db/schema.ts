/**
 * SQLite schema (Drizzle ORM).
 *
 * Conventions (keep these so a future cloud sync / web backend is easy):
 * - Primary keys are UUIDv7 text ids generated in the app (time-sortable, globally unique).
 * - Money columns are INTEGER satang. Quantities are REAL rounded to 2 decimals.
 * - Timestamps are INTEGER epoch milliseconds.
 * - Top-level entities have created_at / updated_at / deleted_at (soft delete).
 *   Every read of those tables must filter `deleted_at IS NULL`.
 * - Child rows (transaction_items, stock_movements) belong to an aggregate and are
 *   replaced wholesale when the parent changes, so they have no deleted_at.
 *
 * After changing this file run `npm run db:generate` to create a migration in /drizzle.
 */
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
};

/**
 * Staff records (พนักงาน): personal data and pay. Not every employee uses the program - a login account is a
 * `users` row linked through users.employee_id. Dates without a time are local "YYYY-MM-DD" strings.
 */
export const employees = sqliteTable(
  "employees",
  {
    id: text("id").primaryKey(),
    /** Shop's own employee code, optional. */
    code: text("code"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    /** ชื่อเล่น - what the shop calls them; shown on the time clock. */
    nickname: text("nickname"),
    position: text("position"),
    phone: text("phone"),
    lineId: text("line_id"),
    /** เลขบัตรประชาชน */
    nationalId: text("national_id"),
    birthDate: text("birth_date"),
    address: text("address"),
    emergencyName: text("emergency_name"),
    emergencyPhone: text("emergency_phone"),
    startDate: text("start_date"),
    /** Last working day after resigning. */
    endDate: text("end_date"),
    /** false = resigned / no longer working (hidden from the time clock and new payroll runs). */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    /** monthly = เงินเดือน (payRate per month), daily = ค่าแรงรายวัน (payRate per day worked). */
    payType: text("pay_type", { enum: ["monthly", "daily"] }).notNull().default("monthly"),
    /** Satang per month (monthly) or per day (daily). */
    payRate: integer("pay_rate").notNull().default(0),
    /** Deduct social security (ประกันสังคม) on payslips. */
    socialSecurity: integer("social_security", { mode: "boolean" }).notNull().default(false),
    bankName: text("bank_name"),
    bankAccount: text("bank_account"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [index("employees_name_idx").on(t.firstName)],
);

/**
 * Program login accounts. Owners have every permission; staff have the permissions listed in `permissions`
 * (JSON array, see shared/contract/auth.ts). Soft-deleted rows stay so history keeps pointing at them.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    /** Shown on the login screen and in history. Unique (case-insensitive) among non-deleted users. */
    name: text("name").notNull(),
    role: text("role", { enum: ["owner", "staff"] }).notNull().default("staff"),
    permissions: text("permissions").notNull().default("[]"),
    /** scrypt hash (electron/api/session.ts hashPassword); null = no password (log in by tapping the name). */
    passwordHash: text("password_hash"),
    employeeId: text("employee_id").references(() => employees.id),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastLoginAt: integer("last_login_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_name_unique").on(t.name).where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex("users_employee_unique").on(t.employeeId).where(sql`${t.employeeId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
);

/** Product categories, e.g. ยางรถยนต์, แบตเตอรี่, ช่วงล่าง. */
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    /** Shop's own code / SKU. Optional, unique among non-deleted products. */
    sku: text("sku"),
    barcode: text("barcode"),
    name: text("name").notNull(),
    categoryId: text("category_id").references(() => categories.id),
    brand: text("brand"),
    model: text("model"),
    /** Free-form spec, e.g. tyre size "205/55R16 91V" or battery "12V 65Ah". */
    spec: text("spec"),
    unit: text("unit").notNull().default("ชิ้น"),
    /** Latest cost price (satang). Updated by purchases when enabled in settings. */
    costPrice: integer("cost_price").notNull().default(0),
    /** Default selling price (satang). */
    sellPrice: integer("sell_price").notNull().default(0),
    /** Cached SUM(stock_movements.qty). Never edit directly - use recomputeStock(). */
    stockQty: real("stock_qty").notNull().default(0),
    /** Low-stock alert threshold. */
    minStock: real("min_stock").notNull().default(0),
    /** false = non-stock item (e.g. consumables you don't count). */
    trackStock: integer("track_stock", { mode: "boolean" }).notNull().default(true),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_sku_unique").on(t.sku).where(sql`${t.sku} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index("products_name_idx").on(t.name),
    index("products_category_idx").on(t.categoryId),
  ],
);

/** Catalog of labour / services (บริการ) with a default price. */
export const serviceItems = sqliteTable(
  "service_items",
  {
    id: text("id").primaryKey(),
    code: text("code"),
    name: text("name").notNull(),
    /** Default price (satang); can be overridden per transaction line. */
    defaultPrice: integer("default_price").notNull().default(0),
    unit: text("unit").notNull().default("ครั้ง"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    note: text("note"),
    ...timestamps,
  },
  (t) => [index("service_items_name_idx").on(t.name)],
);

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    lineId: text("line_id"),
    email: text("email"),
    /** ชื่อร้านค้า / บริษัท */
    shopName: text("shop_name"),
    taxId: text("tax_id"),
    address: text("address"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [index("customers_name_idx").on(t.name), index("customers_phone_idx").on(t.phone)],
);

/**
 * A sale (รายการขาย: revenue, stock out) or a purchase (รายการซื้อ: cost, stock in).
 * Header values (subtotal/vat/total) are computed by shared/calc.ts in the main process.
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["sale", "purchase"] }).notNull(),
    /** Human document number, e.g. S6909-0001. Unique. */
    docNo: text("doc_no").notNull(),
    status: text("status", { enum: ["completed", "void"] }).notNull().default("completed"),
    /** When the sale/purchase happened (epoch ms). Reports group by this. */
    occurredAt: integer("occurred_at").notNull(),
    customerId: text("customer_id").references(() => customers.id),
    /** Walk-in customer name or supplier name (snapshot / free text). */
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    vehiclePlate: text("vehicle_plate"),
    vehicleModel: text("vehicle_model"),
    mileage: integer("mileage"),
    subtotal: integer("subtotal").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    vatMode: text("vat_mode", { enum: ["none", "inclusive", "exclusive"] }).notNull().default("none"),
    /** Percent, e.g. 7. */
    vatRate: real("vat_rate").notNull().default(0),
    vatAmount: integer("vat_amount").notNull().default(0),
    total: integer("total").notNull().default(0),
    paymentMethod: text("payment_method", { enum: ["cash", "transfer", "card", "credit", "other"] })
      .notNull()
      .default("cash"),
    paymentStatus: text("payment_status", { enum: ["paid", "unpaid"] }).notNull().default("paid"),
    /**
     * When the money was received / paid (epoch ms), null while unpaid. A bill entered as paid is paid at its
     * occurredAt; "รับชำระแล้ว" later sets the time of that change. Cash-flow figures (money received today)
     * group by this, sales/expense figures by occurredAt.
     */
    paidAt: integer("paid_at"),
    note: text("note"),
    voidedAt: integer("voided_at"),
    voidReason: text("void_reason"),
    /** User who created / last changed / voided the bill (null: before the user system, or a system write). */
    createdBy: text("created_by").references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    voidedBy: text("voided_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("transactions_doc_no_unique").on(t.docNo),
    index("transactions_occurred_idx").on(t.occurredAt),
    index("transactions_customer_idx").on(t.customerId),
    index("transactions_type_occurred_idx").on(t.type, t.occurredAt),
    index("transactions_plate_idx").on(t.vehiclePlate),
    index("transactions_paid_idx").on(t.paidAt),
    index("transactions_created_by_idx").on(t.createdBy),
  ],
);

export const transactionItems = sqliteTable(
  "transaction_items",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    itemType: text("item_type", { enum: ["product", "service", "custom"] }).notNull(),
    productId: text("product_id").references(() => products.id),
    serviceItemId: text("service_item_id").references(() => serviceItems.id),
    /** Snapshot of the item name at the time of the transaction. */
    name: text("name").notNull(),
    unit: text("unit"),
    qty: real("qty").notNull(),
    /** Price per unit actually used on this bill (satang) - editable at creation. */
    unitPrice: integer("unit_price").notNull(),
    /** Line discount amount (satang). */
    discount: integer("discount").notNull().default(0),
    /** lineTotal() = qty × unitPrice rounded half up (shared/calc.ts mulQty) - discount */
    total: integer("total").notNull(),
    /**
     * Cost per unit (satang). Sale: product cost snapshot (for gross profit).
     * Purchase: equals unitPrice.
     */
    unitCost: integer("unit_cost").notNull().default(0),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("transaction_items_tx_idx").on(t.transactionId),
    index("transaction_items_product_idx").on(t.productId),
    index("transaction_items_service_idx").on(t.serviceItemId),
  ],
);

/**
 * Stock ledger. products.stock_qty = SUM(qty) for the product.
 * Rows linked to a transaction are deleted & re-created when that transaction is edited/voided.
 */
export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    type: text("type", { enum: ["initial", "purchase", "sale", "adjust"] }).notNull(),
    /** Signed quantity: + stock in, - stock out. */
    qty: real("qty").notNull(),
    unitCost: integer("unit_cost"),
    transactionId: text("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
    transactionItemId: text("transaction_item_id"),
    note: text("note"),
    occurredAt: integer("occurred_at").notNull(),
    /** Who recorded an opening stock / adjustment (bill movements: see the bill's created_by). */
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("stock_movements_product_idx").on(t.productId, t.occurredAt),
    index("stock_movements_tx_idx").on(t.transactionId),
  ],
);

/** Key/value app settings; value is JSON. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Running numbers for document numbers, keyed by prefix+period (e.g. "S6909"). */
export const docSequences = sqliteTable("doc_sequences", {
  key: text("key").primaryKey(),
  lastNo: integer("last_no").notNull().default(0),
});

/**
 * Who changed what (ประวัติการแก้ไข). Append-only. `changes` is JSON (shared/contract/audit.ts AuditChanges);
 * user_name / entity_label are snapshots so an entry still reads correctly after renames and deletes.
 */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    at: integer("at").notNull(),
    userId: text("user_id").references(() => users.id),
    userName: text("user_name"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    entityLabel: text("entity_label"),
    action: text("action").notNull(),
    changes: text("changes"),
    note: text("note"),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.at),
    index("audit_logs_at_idx").on(t.at),
    index("audit_logs_user_idx").on(t.userId, t.at),
  ],
);

/**
 * Price history of products (cost / sell) and services (sell = default price). One row per changed value:
 * set on create, by hand, or by a purchase that moved the product's cost. Append-only.
 */
export const priceChanges = sqliteTable(
  "price_changes",
  {
    id: text("id").primaryKey(),
    itemType: text("item_type", { enum: ["product", "service"] }).notNull(),
    itemId: text("item_id").notNull(),
    field: text("field", { enum: ["cost", "sell"] }).notNull(),
    /** null on the first price (create). */
    oldValue: integer("old_value"),
    newValue: integer("new_value").notNull(),
    source: text("source", { enum: ["create", "manual", "purchase"] }).notNull(),
    /** Purchase bill the new cost comes from (source "purchase"). */
    transactionId: text("transaction_id").references(() => transactions.id),
    userId: text("user_id").references(() => users.id),
    userName: text("user_name"),
    at: integer("at").notNull(),
    note: text("note"),
  },
  (t) => [index("price_changes_item_idx").on(t.itemType, t.itemId, t.at)],
);

/**
 * Time clock (ลงเวลา): one row per work session. clock_out is null while the employee is still at work.
 * work_date = local date of clock_in.
 */
export const attendance = sqliteTable(
  "attendance",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    workDate: text("work_date").notNull(),
    clockIn: integer("clock_in").notNull(),
    clockOut: integer("clock_out"),
    /** clock = tapped on the time clock, manual = entered / corrected by a manager. */
    source: text("source", { enum: ["clock", "manual"] }).notNull().default("clock"),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("attendance_employee_idx").on(t.employeeId, t.workDate), index("attendance_date_idx").on(t.workDate)],
);

/** Leave days (ลางาน). One row per employee per date; half_day = ลาครึ่งวัน. */
export const leaves = sqliteTable(
  "leaves",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    date: text("date").notNull(),
    type: text("type", { enum: ["sick", "personal", "vacation", "unpaid"] }).notNull(),
    halfDay: integer("half_day", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("leaves_employee_date_unique").on(t.employeeId, t.date).where(sql`${t.deletedAt} IS NULL`),
    index("leaves_date_idx").on(t.date),
  ],
);

/** A pay period (งวดเงินเดือน). Its payslips are child rows. */
export const payrollRuns = sqliteTable(
  "payroll_runs",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    /** Inclusive local dates "YYYY-MM-DD". */
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("payroll_runs_period_idx").on(t.periodStart)],
);

/**
 * One employee's pay for a run (สลิปเงินเดือน). Name / position / pay type and rate are snapshots taken when the
 * payslip is (re)calculated; `stats` is JSON (shared/contract/payroll.ts PayslipStats). Totals are Σ items.
 */
export const payslips = sqliteTable(
  "payslips",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    employeeName: text("employee_name").notNull(),
    position: text("position"),
    payType: text("pay_type", { enum: ["monthly", "daily"] }).notNull(),
    payRate: integer("pay_rate").notNull(),
    stats: text("stats").notNull(),
    earnings: integer("earnings").notNull().default(0),
    deductions: integer("deductions").notNull().default(0),
    net: integer("net").notNull().default(0),
    status: text("status", { enum: ["unpaid", "paid"] }).notNull().default("unpaid"),
    paidAt: integer("paid_at"),
    paymentMethod: text("payment_method", { enum: ["cash", "transfer"] }),
    paidBy: text("paid_by").references(() => users.id),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("payslips_run_employee_unique").on(t.runId, t.employeeId),
    index("payslips_employee_idx").on(t.employeeId),
  ],
);

/** Earnings and deductions of a payslip. `auto` lines are regenerated by "คำนวณใหม่"; manual lines are kept. */
export const payslipItems = sqliteTable(
  "payslip_items",
  {
    id: text("id").primaryKey(),
    payslipId: text("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    kind: text("kind", { enum: ["earning", "deduction"] }).notNull(),
    /** shared/contract/payroll.ts PayItemCode */
    code: text("code").notNull(),
    label: text("label").notNull(),
    amount: integer("amount").notNull(),
    /** Optional "22 วัน × ฿450" breakdown: qty and rate (satang per unit, may have decimals). */
    qty: real("qty"),
    rate: real("rate"),
    auto: integer("auto", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("payslip_items_payslip_idx").on(t.payslipId)],
);

/**
 * Salary advances (เบิกเงินล่วงหน้า). An advance is outstanding until a payslip takes it (payslip_id);
 * it is settled when that payslip is paid.
 */
export const salaryAdvances = sqliteTable(
  "salary_advances",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    date: text("date").notNull(),
    amount: integer("amount").notNull(),
    note: text("note"),
    payslipId: text("payslip_id").references(() => payslips.id),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("salary_advances_employee_idx").on(t.employeeId, t.date), index("salary_advances_payslip_idx").on(t.payslipId)],
);
