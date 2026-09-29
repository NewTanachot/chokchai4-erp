/** Employees (พนักงาน): personal data and pay rate. */
import { z } from "zod";
import { idSchema, moneySchema, optDateSchema, optText, pageSchema, reqText, type ID, type Millis, type Paged } from "./common";

export type PayType = "monthly" | "daily";

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  monthly: "เงินเดือน (รายเดือน)",
  daily: "ค่าแรงรายวัน",
};

/** Suffix of a pay rate, e.g. "฿12,000 / เดือน". */
export const PAY_RATE_UNIT: Record<PayType, string> = { monthly: "เดือน", daily: "วัน" };

export interface Employee {
  id: ID;
  code: string | null;
  firstName: string;
  lastName: string | null;
  nickname: string | null;
  /** nickname, else first name - what the shop calls them (time clock, lists). */
  displayName: string;
  /** "ชื่อ นามสกุล" */
  fullName: string;
  position: string | null;
  phone: string | null;
  lineId: string | null;
  nationalId: string | null;
  birthDate: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  payType: PayType;
  /** Satang per month (monthly) or per day (daily). */
  payRate: number;
  socialSecurity: boolean;
  bankName: string | null;
  bankAccount: string | null;
  note: string | null;
  /** Linked login account, if any. */
  userId: ID | null;
  userName: string | null;
  createdAt: Millis;
  updatedAt: Millis;
}

/** Thai national id: 13 digits (dashes / spaces allowed when typing). */
const nationalIdSchema = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.replace(/[\s-]/g, "") : null))
  .refine((v) => v === null || /^\d{13}$/.test(v), "เลขบัตรประชาชนต้องมี 13 หลัก");

const employeeFields = z.object({
  code: optText,
  firstName: reqText("ชื่อ", 100),
  lastName: optText,
  nickname: optText,
  position: optText,
  phone: optText,
  lineId: optText,
  nationalId: nationalIdSchema,
  birthDate: optDateSchema,
  address: optText,
  emergencyName: optText,
  emergencyPhone: optText,
  startDate: optDateSchema,
  endDate: optDateSchema,
  isActive: z.boolean().default(true),
  payType: z.enum(["monthly", "daily"]).default("monthly"),
  payRate: moneySchema.default(0),
  socialSecurity: z.boolean().default(false),
  bankName: optText,
  bankAccount: optText,
  note: optText,
});

const datesInOrder = (v: { startDate: string | null; endDate: string | null }, ctx: z.RefinementCtx) => {
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    ctx.addIssue({ code: "custom", message: "วันสิ้นสุดการทำงานต้องไม่ก่อนวันเริ่มงาน", path: ["endDate"] });
  }
};

export const employeeInputSchema = employeeFields.superRefine(datesInOrder);
export type EmployeeInput = z.input<typeof employeeInputSchema>;

export const employeeUpdateSchema = employeeFields.extend({ id: idSchema }).superRefine(datesInOrder);
export type EmployeeUpdate = z.input<typeof employeeUpdateSchema>;

export const employeeListQuerySchema = z.object({
  /** Matches names, nickname, code, position and phone; every word must match. */
  search: z.string().trim().optional(),
  /** active (default) | resigned | all */
  status: z.enum(["active", "resigned", "all"]).default("active"),
  ...pageSchema,
});
export type EmployeeListQuery = z.input<typeof employeeListQuerySchema>;

export interface EmployeesApi {
  /** Sorted by display name. */
  list(query: EmployeeListQuery): Promise<Paged<Employee>>;
  get(id: ID): Promise<Employee>;
  /** `code` is unique among non-deleted employees (CONFLICT). */
  create(input: EmployeeInput): Promise<Employee>;
  update(input: EmployeeUpdate): Promise<Employee>;
  /** Soft delete; attendance and payslips stay. A linked login account is unlinked. */
  remove(id: ID): Promise<void>;
}

export function employeeDisplayName(e: { firstName: string; nickname: string | null }): string {
  return e.nickname?.trim() || e.firstName;
}

export function employeeFullName(e: { firstName: string; lastName: string | null }): string {
  return [e.firstName, e.lastName].filter(Boolean).join(" ");
}
