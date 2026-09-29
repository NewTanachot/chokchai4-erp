/** Time clock (ลงเวลาเข้า-ออกงาน), work sessions and leave days (วันลา). */
import { z } from "zod";
import type { DateStr } from "../dates";
import { dateSchema, idSchema, optText, type ID, type Millis } from "./common";
import type { PayType } from "./employees";

export type LeaveType = "sick" | "personal" | "vacation" | "unpaid";

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  sick: "ลาป่วย",
  personal: "ลากิจ",
  vacation: "ลาพักร้อน",
  unpaid: "ลาไม่รับค่าจ้าง",
};

/** Leave types that are paid (not deducted from a monthly salary, paid to daily workers). */
export const PAID_LEAVE_TYPES: readonly LeaveType[] = ["sick", "personal", "vacation"];

/**
 * out = not clocked in today, in = at work now, done = clocked out for the day, leave = on leave today
 * (a person on leave can still clock in).
 */
export type ClockStatus = "out" | "in" | "done" | "leave";

export interface ClockBoardRow {
  employeeId: ID;
  /** Nickname or first name. */
  name: string;
  fullName: string;
  position: string | null;
  status: ClockStatus;
  /** Clock-in of the open session (status "in"). */
  since: Millis | null;
  /** First clock-in / last clock-out today. */
  firstIn: Millis | null;
  lastOut: Millis | null;
  /** Today's first clock-in was late. */
  late: boolean;
  leave: LeaveType | null;
  /** Date of an older session still open (forgot to clock out), for the manager to fix. */
  forgotOutDate: DateStr | null;
}

export interface ClockBoard {
  now: Millis;
  date: DateStr;
  workStart: string;
  workEnd: string;
  rows: ClockBoardRow[];
}

export interface AttendanceRecord {
  id: ID;
  employeeId: ID;
  employeeName: string;
  workDate: DateStr;
  clockIn: Millis;
  clockOut: Millis | null;
  /** Worked minutes; null while open. */
  minutes: number | null;
  /** Late minutes if this is the day's first session on a work day, else 0. */
  lateMinutes: number;
  source: "clock" | "manual";
  note: string | null;
  createdByName: string | null;
  updatedAt: Millis;
}

export interface LeaveRecord {
  id: ID;
  employeeId: ID;
  employeeName: string;
  date: DateStr;
  type: LeaveType;
  halfDay: boolean;
  note: string | null;
  createdByName: string | null;
}

/** Attendance figures of one employee over a period (payslips use the same numbers). */
export interface AttendanceStats {
  /** Scheduled work days in the period while employed (future days included). */
  workDays: number;
  /** Days with at least one session. */
  daysWorked: number;
  minutesWorked: number;
  lateCount: number;
  lateMinutes: number;
  /** Past scheduled work days without a session or a leave. */
  absentDays: number;
  /** Leave days (half day = 0.5) on scheduled work days, paid / unpaid. */
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  /** Minutes after the end of the work day (counted per day when >= the OT minimum). */
  otMinutes: number;
  /** Sessions never clocked out (before today). */
  forgotOutCount: number;
}

export interface AttendanceSummaryRow {
  employeeId: ID;
  name: string;
  fullName: string;
  position: string | null;
  payType: PayType;
  isActive: boolean;
  stats: AttendanceStats;
}

export const clockInputSchema = z.object({ employeeId: idSchema });
export type ClockInput = z.input<typeof clockInputSchema>;

export interface ClockResult {
  action: "in" | "out";
  at: Millis;
  employeeName: string;
  /** Late minutes when clocking in late, else 0. */
  lateMinutes: number;
  /** Minutes of the session just closed (clock-out). */
  minutes: number | null;
}

export const attendanceQuerySchema = z
  .object({ from: dateSchema, to: dateSchema, employeeId: z.string().optional() })
  .refine((q) => q.from <= q.to, "วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด");
export type AttendanceQuery = z.input<typeof attendanceQuerySchema>;

const DAY_MS = 86_400_000;

const sessionFields = {
  employeeId: idSchema,
  clockIn: z.number().int(),
  clockOut: z
    .number()
    .int()
    .nullish()
    .transform((v) => v ?? null),
  note: optText,
};

const sessionTimes = (v: { clockIn: number; clockOut: number | null }, ctx: z.RefinementCtx) => {
  if (v.clockOut !== null && v.clockOut <= v.clockIn) ctx.addIssue({ code: "custom", message: "เวลาออกต้องหลังเวลาเข้า", path: ["clockOut"] });
  if (v.clockOut !== null && v.clockOut - v.clockIn > DAY_MS) ctx.addIssue({ code: "custom", message: "ช่วงเวลาทำงานยาวเกิน 24 ชั่วโมง", path: ["clockOut"] });
};

export const attendanceInputSchema = z.object(sessionFields).superRefine(sessionTimes);
export type AttendanceInput = z.input<typeof attendanceInputSchema>;
export const attendanceUpdateSchema = z.object({ id: idSchema, ...sessionFields }).superRefine(sessionTimes);
export type AttendanceUpdate = z.input<typeof attendanceUpdateSchema>;

export const leaveInputSchema = z.object({
  /** Set to change an existing leave. */
  id: z.string().nullish().transform((v) => v || null),
  employeeId: idSchema,
  date: dateSchema,
  type: z.enum(["sick", "personal", "vacation", "unpaid"]),
  halfDay: z.boolean().default(false),
  note: optText,
});
export type LeaveInput = z.input<typeof leaveInputSchema>;

export const attendanceSummaryQuerySchema = z
  .object({ from: dateSchema, to: dateSchema, includeInactive: z.boolean().optional() })
  .refine((q) => q.from <= q.to, "วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด");
export type AttendanceSummaryQuery = z.input<typeof attendanceSummaryQuerySchema>;

export interface AttendanceApi {
  /** Public (the time clock works without logging in): active employees and today's status. */
  board(): Promise<ClockBoard>;
  /**
   * Public. Clock in, or out when the employee has an open session (started less than 16 hours ago).
   * A second tap within a minute is rejected (CONFLICT) so a double tap does not clock straight out again.
   */
  clock(input: ClockInput): Promise<ClockResult>;
  /** Sessions whose work date is in [from, to], oldest first. */
  list(query: AttendanceQuery): Promise<AttendanceRecord[]>;
  /** Manual session (e.g. forgot to clock in). */
  create(input: AttendanceInput): Promise<AttendanceRecord>;
  update(input: AttendanceUpdate): Promise<AttendanceRecord>;
  remove(id: ID): Promise<void>;
  leaves(query: AttendanceQuery): Promise<LeaveRecord[]>;
  /** Create (no id) or change a leave; one leave per employee per date (CONFLICT). */
  saveLeave(input: LeaveInput): Promise<LeaveRecord>;
  removeLeave(id: ID): Promise<void>;
  /** Per employee figures for [from, to] (active employees, plus inactive ones with activity when asked). */
  summary(query: AttendanceSummaryQuery): Promise<AttendanceSummaryRow[]>;
}
