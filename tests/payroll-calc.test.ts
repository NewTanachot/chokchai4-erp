import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type AttendanceStats, type PayrollSettings } from "@shared/contract";
import { addDays, dateTimeMs, dayOfWeek, diffDays, eachDate, endOfMonth, isDateStr, toDateStr } from "@shared/dates";
import { attendanceStats, calcPayslipLines, isWorkDay, lateMinutesOf, otMinutesOf, payrollTitle, payslipTotals, proratedSalary, socialSecurityOf } from "@shared/payroll";

const S: PayrollSettings = DEFAULT_SETTINGS.payroll;
const B = (baht: number) => Math.round(baht * 100);
const at = (date: string, hhmm: string) => dateTimeMs(date, hhmm);
const session = (date: string, inAt: string, outAt: string | null) => ({ workDate: date, clockIn: at(date, inAt), clockOut: outAt ? at(date, outAt) : null });
const zeroStats = (over: Partial<AttendanceStats> = {}): AttendanceStats => ({
  workDays: 0,
  daysWorked: 0,
  minutesWorked: 0,
  lateCount: 0,
  lateMinutes: 0,
  absentDays: 0,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  otMinutes: 0,
  forgotOutCount: 0,
  ...over,
});

describe("dates", () => {
  it("works in local calendar days", () => {
    expect(isDateStr("2026-02-29")).toBe(false);
    expect(isDateStr("2028-02-29")).toBe(true);
    expect(isDateStr("2026-9-1")).toBe(false);
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(diffDays("2026-09-01", "2026-10-01")).toBe(30);
    expect(eachDate("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(eachDate("2026-09-02", "2026-09-01")).toEqual([]);
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(dayOfWeek("2026-09-01")).toBe(2); // Tuesday
    expect(toDateStr(at("2026-09-01", "23:59"))).toBe("2026-09-01");
  });
});

describe("attendance rules", () => {
  it("work days follow the weekly schedule and shop holidays", () => {
    expect(isWorkDay("2026-09-06", S)).toBe(false); // Sunday
    expect(isWorkDay("2026-09-07", S)).toBe(true);
    expect(isWorkDay("2026-09-07", { ...S, holidays: ["2026-09-07"] })).toBe(false);
  });

  it("late counts from the start time once past the grace minutes, on work days only", () => {
    expect(lateMinutesOf("2026-09-07", at("2026-09-07", "08:15"), S)).toBe(0);
    expect(lateMinutesOf("2026-09-07", at("2026-09-07", "08:16"), S)).toBe(16);
    expect(lateMinutesOf("2026-09-07", at("2026-09-07", "07:30"), S)).toBe(0);
    expect(lateMinutesOf("2026-09-06", at("2026-09-06", "10:00"), S)).toBe(0);
    expect(lateMinutesOf("2026-09-07", at("2026-09-07", "08:05"), { ...S, lateGraceMinutes: 0 })).toBe(5);
  });

  it("OT is time after the end of the work day, from the minimum up", () => {
    expect(otMinutesOf("2026-09-07", [session("2026-09-07", "08:00", "17:29")], S)).toBe(0);
    expect(otMinutesOf("2026-09-07", [session("2026-09-07", "08:00", "17:45")], S)).toBe(45);
    expect(otMinutesOf("2026-09-07", [session("2026-09-07", "08:00", "12:00"), session("2026-09-07", "13:00", "19:00")], S)).toBe(120);
    expect(otMinutesOf("2026-09-07", [session("2026-09-07", "18:00", "20:00")], S)).toBe(120);
    expect(otMinutesOf("2026-09-07", [session("2026-09-07", "08:00", null)], S)).toBe(0);
    expect(otMinutesOf("2026-09-06", [session("2026-09-06", "08:00", "20:00")], S)).toBe(0);
  });

  it("summarises a period: days, minutes, late, OT, leave, absence (past days only) and forgotten clock-outs", () => {
    const stats = attendanceStats({
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-10",
      startDate: "2026-09-02",
      endDate: null,
      sessions: [
        session("2026-09-02", "07:55", "17:00"), // 545 min
        session("2026-09-03", "08:20", "17:40"), // late 20, OT 40, 560 min
        session("2026-09-04", "08:00", "12:00"),
        session("2026-09-04", "13:00", "17:00"), // two sessions, one day, 480 min
        session("2026-09-05", "08:00", null), // forgot to clock out
        session("2026-09-06", "09:00", "12:00"), // Sunday: worked, not late, 180 min
        session("2026-10-01", "08:00", "17:00"), // outside the period
      ],
      leaves: [
        { date: "2026-09-07", type: "sick", halfDay: false },
        { date: "2026-09-08", type: "unpaid", halfDay: true },
        { date: "2026-09-13", type: "vacation", halfDay: false }, // Sunday: not a work day, ignored
        { date: "2026-09-15", type: "personal", halfDay: false }, // future, still counted as leave
      ],
      settings: S,
    });
    // work days: 2..30 without Sundays (6, 13, 20, 27) = 29 - 4 = 25
    expect(stats).toEqual({
      workDays: 25,
      daysWorked: 5,
      minutesWorked: 545 + 560 + 480 + 180,
      lateCount: 1,
      lateMinutes: 20,
      // past work days without work or leave: 8th (half, unpaid leave the other half), 9th
      absentDays: 1.5,
      paidLeaveDays: 2,
      unpaidLeaveDays: 0.5,
      otMinutes: 40,
      forgotOutCount: 1,
    });
  });

  it("does not count absence outside employment", () => {
    const stats = attendanceStats({ from: "2026-09-01", to: "2026-09-30", today: "2026-10-05", startDate: "2026-09-21", endDate: "2026-09-26", sessions: [], leaves: [], settings: S });
    expect(stats.workDays).toBe(6);
    expect(stats.absentDays).toBe(6);
  });
});

describe("pay", () => {
  it("prorates a monthly salary by calendar days of each month while employed", () => {
    expect(proratedSalary(B(15000), "2026-09-01", "2026-09-30", null, null)).toBe(B(15000));
    expect(proratedSalary(B(15000), "2026-10-01", "2026-10-31", null, null)).toBe(B(15000));
    expect(proratedSalary(B(15000), "2026-09-01", "2026-09-15", null, null)).toBe(B(7500));
    expect(proratedSalary(B(15000), "2026-09-01", "2026-09-30", "2026-09-21", null)).toBe(B(5000));
    expect(proratedSalary(B(15000), "2026-09-01", "2026-09-30", null, "2026-09-10")).toBe(B(5000));
    // 16 Sep - 15 Oct: 15/30 + 15/31
    expect(proratedSalary(B(31000), "2026-09-16", "2026-10-15", null, null)).toBe(Math.round((B(31000) * 15) / 30 + (B(31000) * 15) / 31));
    expect(proratedSalary(B(15000), "2026-09-01", "2026-09-30", "2026-10-01", null)).toBe(0);
  });

  it("social security: rate of the wage between the floor and the ceiling, whole baht", () => {
    expect(socialSecurityOf(B(12000), S)).toBe(B(600));
    expect(socialSecurityOf(B(30000), S)).toBe(B(875));
    expect(socialSecurityOf(B(1000), S)).toBe(B(83)); // 1,650 × 5% = 82.50 -> 83
    expect(socialSecurityOf(B(12345.67), S)).toBe(B(617)); // 617.28
    expect(socialSecurityOf(0, S)).toBe(0);
  });

  it("monthly staff: salary, OT, late, absence, unpaid leave, social security, advances", () => {
    const settings: PayrollSettings = { ...S, otEnabled: true, lateDeduction: "per_minute" };
    const lines = calcPayslipLines({
      payType: "monthly",
      payRate: B(15000),
      socialSecurity: true,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      startDate: null,
      endDate: null,
      stats: zeroStats({ lateCount: 2, lateMinutes: 30, absentDays: 1, unpaidLeaveDays: 0.5, otMinutes: 90 }),
      advances: [{ amount: B(1000) }, { amount: B(500) }],
      settings,
    });
    const daily = B(15000) / 30; // 500 baht
    const hourly = daily / 8; // 62.50
    expect(lines.map((l) => [l.code, l.amount, l.qty])).toEqual([
      ["base", B(15000), null],
      ["ot", Math.round(90 * hourly * 1.5 / 60), 1.5],
      ["late", Math.round((30 * hourly) / 60), 30],
      ["absent", B(500), 1],
      ["unpaid_leave", B(250), 0.5],
      // wage = 15,000 + 140.63 - 31.25 - 500 - 250 = 14,359.38 -> 5% = 717.97 -> 718
      ["social_security", B(718), null],
      ["advance", B(1500), null],
    ]);
    expect(lines.every((l) => l.auto)).toBe(true);
    expect(lines.find((l) => l.code === "advance")?.label).toContain("2 ครั้ง");
    const t = payslipTotals(lines);
    expect(t.earnings).toBe(B(15000) + 14063);
    expect(t.net).toBe(t.earnings - t.deductions);
  });

  it("daily staff: days worked + paid leave × rate; no absence deduction; per-time late fee", () => {
    const lines = calcPayslipLines({
      payType: "daily",
      payRate: B(450),
      socialSecurity: false,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      startDate: null,
      endDate: null,
      stats: zeroStats({ daysWorked: 11, paidLeaveDays: 1, absentDays: 1, lateCount: 3, lateMinutes: 50 }),
      advances: [],
      settings: { ...S, lateDeduction: "per_time", lateDeductionAmount: B(20) },
    });
    expect(lines.map((l) => [l.code, l.amount, l.qty, l.rate])).toEqual([
      ["base", B(4950), 11, B(450)],
      ["paid_leave", B(450), 1, B(450)],
      ["late", B(60), 3, B(20)],
    ]);
  });

  it("with default settings: no OT pay, no late deduction", () => {
    const lines = calcPayslipLines({
      payType: "monthly",
      payRate: B(12000),
      socialSecurity: false,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      startDate: "2026-09-16",
      endDate: null,
      stats: zeroStats({ lateCount: 5, lateMinutes: 100, otMinutes: 600 }),
      advances: [],
      settings: S,
    });
    expect(lines.map((l) => [l.code, l.amount, l.label])).toEqual([["base", B(6000), "เงินเดือน (ตามวันที่ทำงาน)"]]);
  });

  it("titles a run by its period", () => {
    expect(payrollTitle("2026-09-01", "2026-09-30")).toMatch(/^เงินเดือน ก\.ย\. 2569$/);
    expect(payrollTitle("2026-09-01", "2026-09-15")).toMatch(/^เงินเดือน 1–15 ก\.ย\. 2569$/);
    expect(payrollTitle("2026-09-16", "2026-10-15")).toMatch(/^เงินเดือน 16 ก\.ย\.–15 ต\.ค\. 2569$/);
  });
});
