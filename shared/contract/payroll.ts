/** Payroll (เงินเดือน): pay periods, payslips, salary advances. */
import { z } from "zod";
import type { DateStr } from "../dates";
import type { AttendanceStats } from "./attendance";
import { dateSchema, idSchema, moneySchema, optText, pageSchema, reqText, type ID, type Millis, type Paged } from "./common";
import type { PayType } from "./employees";

export type PayItemKind = "earning" | "deduction";

export type PayItemCode =
  | "base"
  | "paid_leave"
  | "ot"
  | "bonus"
  | "allowance"
  | "commission"
  | "other_income"
  | "late"
  | "absent"
  | "unpaid_leave"
  | "social_security"
  | "advance"
  | "other_deduction";

export const PAY_ITEM_KIND: Record<PayItemCode, PayItemKind> = {
  base: "earning",
  paid_leave: "earning",
  ot: "earning",
  bonus: "earning",
  allowance: "earning",
  commission: "earning",
  other_income: "earning",
  late: "deduction",
  absent: "deduction",
  unpaid_leave: "deduction",
  social_security: "deduction",
  advance: "deduction",
  other_deduction: "deduction",
};

export const PAY_ITEM_LABELS: Record<PayItemCode, string> = {
  base: "เงินเดือน / ค่าแรง",
  paid_leave: "วันลาที่ได้รับค่าจ้าง",
  ot: "ค่าล่วงเวลา (OT)",
  bonus: "โบนัส / เบี้ยขยัน",
  allowance: "ค่าสวัสดิการ / ค่าเดินทาง",
  commission: "ค่าคอมมิชชัน",
  other_income: "รายได้อื่น ๆ",
  late: "หักมาสาย",
  absent: "หักขาดงาน",
  unpaid_leave: "หักลาไม่รับค่าจ้าง",
  social_security: "หักประกันสังคม",
  advance: "หักเงินเบิกล่วงหน้า",
  other_deduction: "รายการหักอื่น ๆ",
};

/** Codes offered when adding a line by hand. */
export const MANUAL_EARNING_CODES: PayItemCode[] = ["bonus", "allowance", "commission", "ot", "other_income"];
export const MANUAL_DEDUCTION_CODES: PayItemCode[] = ["other_deduction", "late", "absent", "social_security"];

export interface PayslipItem {
  id: ID;
  kind: PayItemKind;
  code: PayItemCode;
  label: string;
  /** Satang, >= 0 (deductions are subtracted). */
  amount: number;
  /** Optional breakdown "qty × rate", e.g. 22 วัน × ฿450. rate in satang (may have decimals). */
  qty: number | null;
  rate: number | null;
  /** Calculated from attendance / settings; "คำนวณใหม่" replaces it. Manual lines are kept. */
  auto: boolean;
}

export type PayslipStatus = "unpaid" | "paid";
export type PayMethod = "cash" | "transfer";

export const PAY_METHOD_LABELS: Record<PayMethod, string> = { cash: "เงินสด", transfer: "โอนเงิน" };

export interface Payslip {
  id: ID;
  runId: ID;
  runTitle: string;
  periodStart: DateStr;
  periodEnd: DateStr;
  employeeId: ID;
  employeeName: string;
  position: string | null;
  payType: PayType;
  payRate: number;
  stats: AttendanceStats;
  items: PayslipItem[];
  earnings: number;
  deductions: number;
  /** earnings - deductions (may be negative when advances exceed the pay). */
  net: number;
  status: PayslipStatus;
  paidAt: Millis | null;
  paymentMethod: PayMethod | null;
  paidByName: string | null;
  bankName: string | null;
  bankAccount: string | null;
  note: string | null;
  updatedAt: Millis;
}

export interface PayrollRunSummary {
  id: ID;
  title: string;
  periodStart: DateStr;
  periodEnd: DateStr;
  note: string | null;
  payslipCount: number;
  paidCount: number;
  totalEarnings: number;
  totalDeductions: number;
  totalNet: number;
  createdAt: Millis;
  createdByName: string | null;
  updatedAt: Millis;
}

export interface PayrollRunDetail extends PayrollRunSummary {
  payslips: Payslip[];
}

/** An employee that could be put in a new run. */
export interface PayrollCandidate {
  employeeId: ID;
  name: string;
  fullName: string;
  position: string | null;
  payType: PayType;
  payRate: number;
  isActive: boolean;
  /** Already has a payslip in a run whose period overlaps (would be paid twice). */
  overlap: { runId: ID; title: string } | null;
}

export interface SalaryAdvance {
  id: ID;
  employeeId: ID;
  employeeName: string;
  date: DateStr;
  amount: number;
  note: string | null;
  /** Payslip that deducts it (null = outstanding). */
  payslipId: ID | null;
  runId: ID | null;
  runTitle: string | null;
  /** The deducting payslip has been paid. */
  settled: boolean;
  createdAt: Millis;
  createdByName: string | null;
}

const periodFields = { periodStart: dateSchema, periodEnd: dateSchema };
const periodInOrder = (v: { periodStart: string; periodEnd: string }, ctx: z.RefinementCtx) => {
  if (v.periodEnd < v.periodStart) ctx.addIssue({ code: "custom", message: "วันสิ้นสุดงวดต้องไม่ก่อนวันเริ่มงวด", path: ["periodEnd"] });
};

export const payrollPeriodSchema = z.object(periodFields).superRefine(periodInOrder);
export type PayrollPeriod = z.input<typeof payrollPeriodSchema>;

export const payrollRunCreateSchema = z
  .object({
    ...periodFields,
    /** Defaults to "เงินเดือน <period>". */
    title: optText,
    employeeIds: z.array(idSchema).min(1, "กรุณาเลือกพนักงานอย่างน้อย 1 คน").max(500),
    note: optText,
  })
  .superRefine(periodInOrder);
export type PayrollRunCreate = z.input<typeof payrollRunCreateSchema>;

export const payrollRunUpdateSchema = z.object({ id: idSchema, title: reqText("ชื่องวด", 100), note: optText });
export type PayrollRunUpdate = z.input<typeof payrollRunUpdateSchema>;

export const payslipItemInputSchema = z.object({
  code: z.enum([
    "base",
    "paid_leave",
    "ot",
    "bonus",
    "allowance",
    "commission",
    "other_income",
    "late",
    "absent",
    "unpaid_leave",
    "social_security",
    "advance",
    "other_deduction",
  ]),
  label: reqText("ชื่อรายการ", 100),
  amount: moneySchema,
  qty: z.number().finite().nullish().transform((v) => v ?? null),
  rate: z.number().finite().nullish().transform((v) => v ?? null),
  /** Keep true only for untouched calculated lines. */
  auto: z.boolean().default(false),
});
export type PayslipItemInput = z.input<typeof payslipItemInputSchema>;

export const payslipUpdateSchema = z.object({
  id: idSchema,
  items: z.array(payslipItemInputSchema).max(100),
  note: optText,
});
export type PayslipUpdate = z.input<typeof payslipUpdateSchema>;

export const payslipPaySchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
  paymentMethod: z.enum(["cash", "transfer"]),
  /** Defaults to now. */
  paidAt: z.number().int().optional(),
});
export type PayslipPay = z.input<typeof payslipPaySchema>;

export const addPayslipSchema = z.object({ runId: idSchema, employeeId: idSchema });

export const payrollRunsQuerySchema = z.object({ ...pageSchema });
export type PayrollRunsQuery = z.input<typeof payrollRunsQuerySchema>;

export const employeePayslipsQuerySchema = z.object({ employeeId: idSchema, ...pageSchema });
export type EmployeePayslipsQuery = z.input<typeof employeePayslipsQuerySchema>;

export const advanceInputSchema = z.object({
  employeeId: idSchema,
  date: dateSchema,
  amount: moneySchema.refine((n) => n > 0, "จำนวนเงินต้องมากกว่า 0"),
  note: optText,
});
export type AdvanceInput = z.input<typeof advanceInputSchema>;

export const advanceListQuerySchema = z.object({
  employeeId: z.string().optional(),
  /** outstanding = not yet taken by a payslip */
  status: z.enum(["all", "outstanding"]).default("all"),
  ...pageSchema,
});
export type AdvanceListQuery = z.input<typeof advanceListQuerySchema>;

export interface PayrollApi {
  /** Newest period first. */
  listRuns(query: PayrollRunsQuery): Promise<Paged<PayrollRunSummary>>;
  getRun(id: ID): Promise<PayrollRunDetail>;
  /** Employees for a new run: active ones plus anyone employed during the period, with overlap warnings. */
  candidates(period: PayrollPeriod): Promise<PayrollCandidate[]>;
  /**
   * Creates the run and one payslip per employee, calculated from attendance, leaves, settings and outstanding
   * advances (which the payslip takes). CONFLICT when an employee already has a payslip in an overlapping run.
   */
  createRun(input: PayrollRunCreate): Promise<PayrollRunDetail>;
  updateRun(input: PayrollRunUpdate): Promise<PayrollRunSummary>;
  /** Only while no payslip is paid. Advances become outstanding again. */
  removeRun(id: ID): Promise<void>;
  addPayslip(input: z.input<typeof addPayslipSchema>): Promise<Payslip>;
  getPayslip(id: ID): Promise<Payslip>;
  /** Replaces the lines (unpaid payslips only). */
  updatePayslip(input: PayslipUpdate): Promise<Payslip>;
  /** Re-reads attendance / advances and replaces the calculated lines; manual lines stay. Unpaid only. */
  recalculate(id: ID): Promise<Payslip>;
  removePayslip(id: ID): Promise<void>;
  /** Marks payslips paid (unpaid ones; paid ones are left as they are). */
  pay(input: PayslipPay): Promise<Payslip[]>;
  /** Back to unpaid (to correct it). */
  unpay(id: ID): Promise<Payslip>;
  /** Payslips of one employee, newest period first. */
  employeePayslips(query: EmployeePayslipsQuery): Promise<Paged<Payslip>>;
  listAdvances(query: AdvanceListQuery): Promise<Paged<SalaryAdvance>>;
  createAdvance(input: AdvanceInput): Promise<SalaryAdvance>;
  /** Not when a paid payslip already deducted it. */
  removeAdvance(id: ID): Promise<void>;
}
