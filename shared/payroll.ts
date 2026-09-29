/**
 * Attendance and payroll math - pure functions shared by the main process (authoritative, stored values) and
 * the renderer (previews). Money is integer satang; amounts are rounded half up to whole satang, social
 * security to whole baht (SSO rule: 50 satang and up rounds up).
 */
import { PAID_LEAVE_TYPES, type AttendanceStats, type LeaveType } from "./contract/attendance";
import type { PayType } from "./contract/employees";
import { PAY_ITEM_KIND, PAY_ITEM_LABELS, type PayItemCode, type PayItemKind } from "./contract/payroll";
import type { PayrollSettings } from "./contract/settings";
import { dateTimeMs, dayOfWeek, daysInMonth, diffDays, eachDate, maxDate, minDate, parseDateStr, type DateStr } from "./dates";
import { intlLocaleOf, translate, type Lang } from "./i18n";

const MIN = 60_000;

export interface SessionLite {
  workDate: DateStr;
  clockIn: number;
  clockOut: number | null;
}

export interface LeaveLite {
  date: DateStr;
  type: LeaveType;
  halfDay: boolean;
}

type Schedule = Pick<PayrollSettings, "workStart" | "workEnd" | "lateGraceMinutes" | "workDays" | "holidays" | "otMinMinutes">;

export function isWorkDay(date: DateStr, s: Pick<PayrollSettings, "workDays" | "holidays">): boolean {
  return s.workDays.includes(dayOfWeek(date)) && !s.holidays.includes(date);
}

/** Minutes of a closed session (whole minutes); null while open. */
export function sessionMinutes(clockIn: number, clockOut: number | null): number | null {
  return clockOut === null ? null : Math.max(0, Math.floor((clockOut - clockIn) / MIN));
}

/**
 * Late minutes of a day's first clock-in, counted from workStart, when it is later than workStart + grace on a
 * work day; otherwise 0.
 */
export function lateMinutesOf(date: DateStr, firstIn: number, s: Schedule): number {
  if (!isWorkDay(date, s)) return 0;
  const late = Math.floor((firstIn - dateTimeMs(date, s.workStart)) / MIN);
  return late > s.lateGraceMinutes ? late : 0;
}

/** Minutes worked after workEnd on a work day (closed sessions), 0 below the OT minimum. */
export function otMinutesOf(date: DateStr, sessions: SessionLite[], s: Schedule): number {
  if (!isWorkDay(date, s)) return 0;
  const end = dateTimeMs(date, s.workEnd);
  let ms = 0;
  for (const x of sessions) {
    if (x.clockOut === null || x.clockOut <= end) continue;
    ms += x.clockOut - Math.max(x.clockIn, end);
  }
  const minutes = Math.floor(ms / MIN);
  return minutes >= s.otMinMinutes && minutes > 0 ? minutes : 0;
}

const leaveUnits = (l: LeaveLite) => (l.halfDay ? 0.5 : 1);
const isPaidLeave = (t: LeaveType) => PAID_LEAVE_TYPES.includes(t);

/**
 * Attendance figures of one employee for [from, to]. Absences are counted only for past work days
 * (before `today`) inside the employment period [startDate, endDate].
 */
export function attendanceStats(args: {
  from: DateStr;
  to: DateStr;
  today: DateStr;
  startDate: DateStr | null;
  endDate: DateStr | null;
  sessions: SessionLite[];
  leaves: LeaveLite[];
  settings: Schedule;
}): AttendanceStats {
  const { from, to, today, settings: s } = args;
  const empFrom = args.startDate ? maxDate(from, args.startDate) : from;
  const empTo = args.endDate ? minDate(to, args.endDate) : to;

  const byDate = new Map<DateStr, SessionLite[]>();
  for (const x of args.sessions) {
    if (x.workDate < from || x.workDate > to) continue;
    const list = byDate.get(x.workDate) ?? [];
    list.push(x);
    byDate.set(x.workDate, list);
  }
  const leaveByDate = new Map<DateStr, LeaveLite>();
  for (const l of args.leaves) if (l.date >= from && l.date <= to) leaveByDate.set(l.date, l);

  const stats: AttendanceStats = {
    workDays: 0,
    daysWorked: byDate.size,
    minutesWorked: 0,
    lateCount: 0,
    lateMinutes: 0,
    absentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    otMinutes: 0,
    forgotOutCount: 0,
  };

  for (const [date, list] of byDate) {
    for (const x of list) {
      stats.minutesWorked += sessionMinutes(x.clockIn, x.clockOut) ?? 0;
      if (x.clockOut === null && date < today) stats.forgotOutCount++;
    }
    const late = lateMinutesOf(date, Math.min(...list.map((x) => x.clockIn)), s);
    if (late > 0) {
      stats.lateCount++;
      stats.lateMinutes += late;
    }
    stats.otMinutes += otMinutesOf(date, list, s);
  }

  if (empFrom <= empTo) {
    for (const date of eachDate(empFrom, empTo)) {
      if (!isWorkDay(date, s)) continue;
      stats.workDays++;
      const leave = leaveByDate.get(date);
      const leaveDays = leave ? leaveUnits(leave) : 0;
      if (leave) {
        if (isPaidLeave(leave.type)) stats.paidLeaveDays += leaveDays;
        else stats.unpaidLeaveDays += leaveDays;
      }
      if (date < today && !byDate.has(date)) stats.absentDays += 1 - leaveDays;
    }
  }
  return stats;
}

/** Monthly salary for [periodStart, periodEnd], prorated by calendar days of each month while employed. */
export function proratedSalary(monthly: number, periodStart: DateStr, periodEnd: DateStr, startDate: DateStr | null, endDate: DateStr | null): number {
  const from = startDate ? maxDate(periodStart, startDate) : periodStart;
  const to = endDate ? minDate(periodEnd, endDate) : periodEnd;
  if (from > to) return 0;
  let total = 0;
  let cursor = from;
  while (cursor <= to) {
    const d = parseDateStr(cursor);
    const dim = daysInMonth(d.getFullYear(), d.getMonth());
    const monthEnd = `${cursor.slice(0, 8)}${String(dim).padStart(2, "0")}`;
    const segEnd = minDate(monthEnd, to);
    total += (monthly * (diffDays(cursor, segEnd) + 1)) / dim;
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  }
  return Math.round(total);
}

/** Employee's share of social security for a wage (satang), rounded to whole baht. */
export function socialSecurityOf(wage: number, s: Pick<PayrollSettings, "socialSecurityRate" | "socialSecurityMinBase" | "socialSecurityMaxBase">): number {
  if (wage <= 0 || s.socialSecurityRate <= 0) return 0;
  const base = Math.min(Math.max(wage, s.socialSecurityMinBase), Math.max(s.socialSecurityMinBase, s.socialSecurityMaxBase));
  return Math.round((base * s.socialSecurityRate) / 100 / 100) * 100;
}

export interface PayLine {
  kind: PayItemKind;
  code: PayItemCode;
  label: string;
  amount: number;
  qty: number | null;
  rate: number | null;
  auto: boolean;
}

const line = (code: PayItemCode, amount: number, extra: Partial<PayLine> = {}): PayLine => ({
  kind: PAY_ITEM_KIND[code],
  code,
  label: PAY_ITEM_LABELS[code],
  amount: Math.max(0, Math.round(amount)),
  qty: null,
  rate: null,
  auto: true,
  ...extra,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Daily and hourly rate (satang, unrounded) used for deductions and OT. */
export function payRates(payType: PayType, payRate: number, s: Pick<PayrollSettings, "daysPerMonth" | "hoursPerDay">) {
  const daily = payType === "monthly" ? payRate / s.daysPerMonth : payRate;
  return { daily, hourly: daily / s.hoursPerDay };
}

/**
 * The calculated (auto) lines of a payslip.
 * - monthly: salary prorated to the employment days of the period; absences (if enabled) and unpaid leave are
 *   deducted at salary / daysPerMonth per day.
 * - daily: days worked × rate, plus paid leave days × rate.
 * - both: OT (if enabled), late deduction (per settings), social security (if the employee has it) on the wage
 *   after those deductions, and outstanding advances.
 */
export function calcPayslipLines(args: {
  payType: PayType;
  payRate: number;
  socialSecurity: boolean;
  periodStart: DateStr;
  periodEnd: DateStr;
  startDate: DateStr | null;
  endDate: DateStr | null;
  stats: AttendanceStats;
  advances: { amount: number }[];
  settings: PayrollSettings;
}): PayLine[] {
  const { payType, payRate, stats: st, settings: s } = args;
  const { daily, hourly } = payRates(payType, payRate, s);
  const lines: PayLine[] = [];

  if (payType === "monthly") {
    const base = proratedSalary(payRate, args.periodStart, args.periodEnd, args.startDate, args.endDate);
    const full = proratedSalary(payRate, args.periodStart, args.periodEnd, null, null);
    lines.push(line("base", base, { label: base === full ? "เงินเดือน" : "เงินเดือน (ตามวันที่ทำงาน)" }));
  } else {
    lines.push(line("base", st.daysWorked * payRate, { label: "ค่าแรงรายวัน", qty: st.daysWorked, rate: payRate }));
    if (st.paidLeaveDays > 0) lines.push(line("paid_leave", st.paidLeaveDays * payRate, { qty: st.paidLeaveDays, rate: payRate }));
  }

  if (s.otEnabled && st.otMinutes > 0) {
    const rate = hourly * s.otMultiplier;
    lines.push(line("ot", (st.otMinutes * rate) / 60, { label: `ค่าล่วงเวลา (OT) ×${s.otMultiplier}`, qty: round2(st.otMinutes / 60), rate }));
  }

  if (st.lateCount > 0 && s.lateDeduction === "per_minute") {
    lines.push(line("late", (st.lateMinutes * hourly) / 60, { label: "หักมาสาย (นาที)", qty: st.lateMinutes, rate: hourly / 60 }));
  } else if (st.lateCount > 0 && s.lateDeduction === "per_time" && s.lateDeductionAmount > 0) {
    lines.push(line("late", st.lateCount * s.lateDeductionAmount, { label: "หักมาสาย (ครั้ง)", qty: st.lateCount, rate: s.lateDeductionAmount }));
  }

  if (payType === "monthly" && s.deductAbsence && st.absentDays > 0) {
    lines.push(line("absent", st.absentDays * daily, { qty: st.absentDays, rate: daily }));
  }
  if (payType === "monthly" && st.unpaidLeaveDays > 0) {
    lines.push(line("unpaid_leave", st.unpaidLeaveDays * daily, { qty: st.unpaidLeaveDays, rate: daily }));
  }

  if (args.socialSecurity) {
    const wage = lines.reduce((sum, l) => sum + (l.kind === "earning" ? l.amount : l.code === "late" || l.code === "absent" || l.code === "unpaid_leave" ? -l.amount : 0), 0);
    const ssf = socialSecurityOf(wage, s);
    if (ssf > 0) lines.push(line("social_security", ssf, { label: `หักประกันสังคม ${s.socialSecurityRate}%` }));
  }

  const advances = args.advances.reduce((sum, a) => sum + a.amount, 0);
  if (advances > 0) {
    lines.push(line("advance", advances, { label: args.advances.length > 1 ? `หักเงินเบิกล่วงหน้า (${args.advances.length} ครั้ง)` : "หักเงินเบิกล่วงหน้า" }));
  }
  return lines;
}

export function payslipTotals(items: { kind: PayItemKind; amount: number }[]): { earnings: number; deductions: number; net: number } {
  let earnings = 0;
  let deductions = 0;
  for (const i of items) {
    if (i.kind === "earning") earnings += i.amount;
    else deductions += i.amount;
  }
  return { earnings, deductions, net: earnings - deductions };
}

/**
 * Default pay run title: "เงินเดือน ก.ย. 2569" for a whole month, else "เงินเดือน 1–15 ก.ย. 2569" /
 * "เงินเดือน 16 ก.ย.–15 ต.ค. 2569" ("Salary Sep 2026" … in English).
 */
export function payrollTitle(from: DateStr, to: DateStr, lang: Lang = "th"): string {
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocaleOf(lang), o);
  const a = parseDateStr(from);
  const b = parseDateStr(to);
  const wholeMonth = from.slice(0, 7) === to.slice(0, 7) && a.getDate() === 1 && b.getDate() === daysInMonth(b.getFullYear(), b.getMonth());
  const dayMonthYear = fmt({ day: "numeric", month: "short", year: "numeric" });
  if (wholeMonth) return translate(lang, "เงินเดือน {0}", [fmt({ month: "short", year: "numeric" }).format(a)]);
  if (from.slice(0, 7) === to.slice(0, 7)) return translate(lang, "เงินเดือน {0}–{1}", [a.getDate(), dayMonthYear.format(b)]);
  return translate(lang, "เงินเดือน {0}–{1}", [fmt({ day: "numeric", month: "short" }).format(a), dayMonthYear.format(b)]);
}
