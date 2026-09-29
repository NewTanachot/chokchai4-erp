import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateTimeMs } from "@shared/dates";
import { apiError, setupOwner } from "./helpers/auth";
import { createTestApi } from "./helpers/db";

type T = ReturnType<typeof createTestApi>;
let t: T;
const B = (baht: number) => Math.round(baht * 100);
const at = (date: string, hhmm: string) => dateTimeMs(date, hhmm);
const setNow = (date: string, hhmm: string) => vi.setSystemTime(new Date(at(date, hhmm)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setNow("2026-09-01", "07:00");
  t = createTestApi();
});
afterEach(() => {
  vi.useRealTimers();
  t.close();
});

describe("employees", () => {
  it("creates, validates, searches and soft-deletes", async () => {
    await setupOwner(t);
    const e = await t.api.employees.create({
      code: "E01",
      firstName: "สมศักดิ์",
      lastName: "ทองดี",
      nickname: "ศักดิ์",
      position: "ช่างยาง",
      phone: "081-234-5678",
      nationalId: "1-1037-00123-45-6",
      birthDate: "1990-05-20",
      startDate: "2024-01-15",
      payType: "daily",
      payRate: B(450),
      socialSecurity: true,
      bankName: "กสิกรไทย",
      bankAccount: "123-4-56789-0",
    });
    expect(e).toMatchObject({ displayName: "ศักดิ์", fullName: "สมศักดิ์ ทองดี", nationalId: "1103700123456", isActive: true, userId: null });
    await t.api.employees.create({ firstName: "มานี", position: "พนักงานขาย", payRate: B(12000) });

    expect((await apiError(() => t.api.employees.create({ firstName: "x", code: "e01" }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.employees.create({ firstName: "x", nationalId: "123" }))).message).toContain("13 หลัก");
    expect((await apiError(() => t.api.employees.create({ firstName: "x", birthDate: "2026-02-30" }))).message).toContain("วันที่");
    expect((await apiError(() => t.api.employees.create({ firstName: "x", startDate: "2026-09-10", endDate: "2026-09-01" }))).message).toContain("วันสิ้นสุด");

    expect((await t.api.employees.list({ search: "ช่าง" })).items.map((x) => x.displayName)).toEqual(["ศักดิ์"]);
    expect((await t.api.employees.list({ search: "0812345678" })).total).toBe(1);
    expect((await t.api.employees.list({})).items.map((x) => x.displayName)).toEqual(["มานี", "ศักดิ์"]);

    await t.api.employees.update({ ...e, isActive: false, endDate: "2026-09-30" });
    expect((await t.api.employees.list({})).total).toBe(1);
    expect((await t.api.employees.list({ status: "resigned" })).items[0].id).toBe(e.id);
    expect((await t.api.employees.list({ status: "all" })).total).toBe(2);

    const u = await t.api.users.create({ name: "ศักดิ์", employeeId: e.id, password: "1111" });
    await t.api.employees.remove(e.id);
    expect((await apiError(() => t.api.employees.get(e.id))).code).toBe("NOT_FOUND");
    expect((await t.api.users.list()).find((x) => x.id === u.id)?.employeeId).toBeNull();

    const log = (await t.api.audit.list({ entityType: "employee", entityId: e.id })).items;
    expect(log.map((x) => x.action)).toEqual(["delete", "update", "create"]);
    expect(log[1].changes.map((c) => c.field)).toEqual(["endDate", "isActive"]);
  });
});

describe("time clock", () => {
  it("taps in and out, rejects double taps, and shows the board", async () => {
    await setupOwner(t);
    const e = await t.api.employees.create({ firstName: "เอก" });
    const m = await t.api.employees.create({ firstName: "มานี" });
    await t.api.attendance.saveLeave({ employeeId: m.id, date: "2026-09-01", type: "sick" });
    await t.api.auth.logout(); // the time clock is used without logging in

    let board = await t.api.attendance.board();
    expect(board).toMatchObject({ date: "2026-09-01", workStart: "08:00", workEnd: "17:00" });
    expect(board.rows.map((r) => [r.name, r.status])).toEqual([
      ["มานี", "leave"],
      ["เอก", "out"],
    ]);

    setNow("2026-09-01", "08:20");
    expect(await t.api.attendance.clock({ employeeId: e.id })).toMatchObject({ action: "in", employeeName: "เอก", lateMinutes: 20 });
    setNow("2026-09-01", "08:20");
    expect((await apiError(() => t.api.attendance.clock({ employeeId: e.id }))).message).toContain("เพิ่งลงเวลา");
    board = await t.api.attendance.board();
    expect(board.rows.find((r) => r.employeeId === e.id)).toMatchObject({ status: "in", since: at("2026-09-01", "08:20"), late: true });

    setNow("2026-09-01", "17:05");
    expect(await t.api.attendance.clock({ employeeId: e.id })).toMatchObject({ action: "out", minutes: 525 });
    board = await t.api.attendance.board();
    expect(board.rows.find((r) => r.employeeId === e.id)).toMatchObject({ status: "done", firstIn: at("2026-09-01", "08:20"), lastOut: at("2026-09-01", "17:05") });

    // a leave does not stop someone from clocking in
    expect((await t.api.attendance.clock({ employeeId: m.id })).action).toBe("in");

    // the kiosk session has no user; manual records do
    const rec = await t.api.attendance.list({ from: "2026-09-01", to: "2026-09-01", employeeId: e.id });
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ source: "clock", createdByName: null, lateMinutes: 20, minutes: 525 });
  });

  it("a forgotten clock-out does not turn the next morning's tap into a clock-out", async () => {
    await setupOwner(t);
    const e = await t.api.employees.create({ firstName: "เอก" });
    setNow("2026-09-01", "08:00");
    await t.api.attendance.clock({ employeeId: e.id });
    setNow("2026-09-02", "08:01"); // 24h later: the old session is stale
    expect((await t.api.attendance.clock({ employeeId: e.id })).action).toBe("in");
    const row = (await t.api.attendance.board()).rows[0];
    expect(row).toMatchObject({ status: "in", forgotOutDate: "2026-09-01" });
    // working past midnight (within 16 hours) still clocks out
    setNow("2026-09-03", "00:00");
    expect((await t.api.attendance.clock({ employeeId: e.id })).action).toBe("out");
  });

  it("inactive or unknown employees cannot clock in", async () => {
    await setupOwner(t);
    const e = await t.api.employees.create({ firstName: "เอก", isActive: false });
    expect((await apiError(() => t.api.attendance.clock({ employeeId: e.id }))).code).toBe("VALIDATION");
    expect((await apiError(() => t.api.attendance.clock({ employeeId: "nope" }))).code).toBe("NOT_FOUND");
    expect((await t.api.attendance.board()).rows).toEqual([]);
  });
});

describe("attendance records and leave", () => {
  it("manual sessions: overlap check, edits and history", async () => {
    await setupOwner(t);
    const e = await t.api.employees.create({ firstName: "เอก" });
    const r = await t.api.attendance.create({ employeeId: e.id, clockIn: at("2026-09-01", "08:30"), clockOut: at("2026-09-01", "17:00"), note: "ลืมลงเวลา" });
    expect(r).toMatchObject({ workDate: "2026-09-01", source: "manual", createdByName: "เจ้าของร้าน", lateMinutes: 30, minutes: 510 });
    expect((await apiError(() => t.api.attendance.create({ employeeId: e.id, clockIn: at("2026-09-01", "16:00"), clockOut: at("2026-09-01", "18:00") }))).message).toContain("ซ้อน");
    expect((await apiError(() => t.api.attendance.create({ employeeId: e.id, clockIn: at("2026-09-01", "18:00"), clockOut: at("2026-09-01", "17:00") }))).code).toBe("VALIDATION");
    await t.api.attendance.create({ employeeId: e.id, clockIn: at("2026-09-01", "17:30"), clockOut: at("2026-09-01", "19:00") });

    const moved = await t.api.attendance.update({ id: r.id, employeeId: e.id, clockIn: at("2026-09-01", "08:00"), clockOut: at("2026-09-01", "17:00"), note: null });
    expect(moved.lateMinutes).toBe(0);
    await t.api.attendance.remove(r.id);
    expect(await t.api.attendance.list({ from: "2026-09-01", to: "2026-09-01" })).toHaveLength(1);
    const log = (await t.api.audit.list({ entityType: "attendance", entityId: r.id })).items;
    expect(log.map((x) => x.action)).toEqual(["delete", "update", "create"]);
    expect(log[1].changes.map((c) => c.field)).toEqual(["clockIn", "note"]);
  });

  it("one leave per employee per day; summary for the month", async () => {
    await setupOwner(t);
    const e = await t.api.employees.create({ firstName: "เอก", startDate: "2026-01-01" });
    const leave = await t.api.attendance.saveLeave({ employeeId: e.id, date: "2026-09-03", type: "personal", halfDay: true, note: "ธุระ" });
    expect((await apiError(() => t.api.attendance.saveLeave({ employeeId: e.id, date: "2026-09-03", type: "sick" }))).code).toBe("CONFLICT");
    await t.api.attendance.saveLeave({ id: leave.id, employeeId: e.id, date: "2026-09-03", type: "sick", halfDay: false });
    expect(await t.api.attendance.leaves({ from: "2026-09-01", to: "2026-09-30" })).toMatchObject([{ type: "sick", halfDay: false, note: null }]);

    for (const d of ["2026-09-01", "2026-09-02", "2026-09-04"]) {
      await t.api.attendance.create({ employeeId: e.id, clockIn: at(d, "08:00"), clockOut: at(d, "17:00") });
    }
    setNow("2026-09-08", "12:00");
    const [row] = await t.api.attendance.summary({ from: "2026-09-01", to: "2026-09-30" });
    // past work days 1-7 (6th is Sunday): 1,2,3,4,5,7 -> worked 1,2,4; sick 3; absent 5,7
    expect(row.stats).toMatchObject({ workDays: 26, daysWorked: 3, absentDays: 2, paidLeaveDays: 1, minutesWorked: 3 * 540 });
    await t.api.attendance.removeLeave(leave.id);
    expect(await t.api.attendance.leaves({ from: "2026-09-01", to: "2026-09-30" })).toEqual([]);
  });
});

describe("payroll", () => {
  async function staffWithAttendance() {
    await setupOwner(t);
    const monthly = await t.api.employees.create({ firstName: "มานี", payType: "monthly", payRate: B(15000), socialSecurity: true, startDate: "2025-01-01", bankName: "SCB", bankAccount: "111" });
    const daily = await t.api.employees.create({ firstName: "เอก", payType: "daily", payRate: B(450), startDate: "2025-01-01" });
    // September 2026: 26 work days (Mon-Sat)
    for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      await t.api.attendance.create({ employeeId: monthly.id, clockIn: at(d, "08:00"), clockOut: at(d, "17:00") });
      await t.api.attendance.create({ employeeId: daily.id, clockIn: at(d, d === "2026-09-02" ? "08:40" : "08:00"), clockOut: at(d, "17:00") });
    }
    setNow("2026-09-04", "12:00"); // the 4th is not over: not absent yet
    return { monthly, daily };
  }

  it("creates a run with one payslip per employee from attendance, settings and advances", async () => {
    const { monthly, daily } = await staffWithAttendance();
    const adv = await t.api.payroll.createAdvance({ employeeId: monthly.id, date: "2026-09-02", amount: B(2000), note: "เบิกค่ารถ" });
    await t.api.payroll.createAdvance({ employeeId: monthly.id, date: "2026-10-02", amount: B(999) }); // after the period
    await t.api.settings.update({ payroll: { lateDeduction: "per_time", lateDeductionAmount: B(50) } });

    const cands = await t.api.payroll.candidates({ periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(cands.map((c) => [c.name, c.overlap])).toEqual([
      ["มานี", null],
      ["เอก", null],
    ]);

    const run = await t.api.payroll.createRun({ periodStart: "2026-09-01", periodEnd: "2026-09-30", employeeIds: [monthly.id, daily.id] });
    expect(run.title).toBe("เงินเดือน ก.ย. 2569");
    expect(run.payslipCount).toBe(2);
    const m = run.payslips.find((p) => p.employeeId === monthly.id)!;
    const d = run.payslips.find((p) => p.employeeId === daily.id)!;

    expect(m.stats).toMatchObject({ workDays: 26, daysWorked: 3, absentDays: 0 });
    expect(m.items.map((i) => [i.code, i.amount])).toEqual([
      ["base", B(15000)],
      ["social_security", B(750)],
      ["advance", B(2000)],
    ]);
    expect(m).toMatchObject({ earnings: B(15000), deductions: B(2750), net: B(12250), status: "unpaid", bankName: "SCB", bankAccount: "111" });
    expect(d.items.map((i) => [i.code, i.amount, i.qty])).toEqual([
      ["base", B(1350), 3],
      ["late", B(50), 1],
    ]);
    expect(run.totalNet).toBe(B(12250) + B(1300));

    const advances = await t.api.payroll.listAdvances({ employeeId: monthly.id });
    expect(advances.items.map((a) => [a.amount, a.runTitle, a.settled])).toEqual([
      [B(999), null, false],
      [B(2000), "เงินเดือน ก.ย. 2569", false],
    ]);
    expect(advances.items[1].id).toBe(adv.id);
    expect((await t.api.payroll.listAdvances({ status: "outstanding" })).total).toBe(1);

    // overlapping period for the same people is refused and flagged
    expect((await apiError(() => t.api.payroll.createRun({ periodStart: "2026-09-16", periodEnd: "2026-10-15", employeeIds: [daily.id] }))).code).toBe("CONFLICT");
    const c2 = await t.api.payroll.candidates({ periodStart: "2026-09-16", periodEnd: "2026-10-15" });
    expect(c2.find((c) => c.employeeId === daily.id)?.overlap?.title).toBe("เงินเดือน ก.ย. 2569");

    const log = (await t.api.audit.list({ entityType: "payroll", entityId: run.id })).items;
    expect(log[0]).toMatchObject({ action: "create", entityLabel: "เงินเดือน ก.ย. 2569" });
  });

  it("manual lines survive a recalculation; pay locks the payslip; unpay unlocks it", async () => {
    const { monthly } = await staffWithAttendance();
    await t.api.payroll.createAdvance({ employeeId: monthly.id, date: "2026-09-02", amount: B(2000) });
    const run = await t.api.payroll.createRun({ periodStart: "2026-09-01", periodEnd: "2026-09-30", employeeIds: [monthly.id] });
    const slip = run.payslips[0];

    // owner adds a bonus and overrides social security
    const edited = await t.api.payroll.updatePayslip({
      id: slip.id,
      note: "ขยัน",
      items: [
        ...slip.items.filter((i) => i.code !== "social_security").map((i) => ({ ...i })),
        { code: "bonus", label: "เบี้ยขยัน", amount: B(500) },
        { code: "social_security", label: "หักประกันสังคม", amount: B(700) },
      ],
    });
    expect(edited).toMatchObject({ earnings: B(15500), deductions: B(2700), net: B(12800), note: "ขยัน" });

    // more attendance and a new advance, then recalculate: auto lines follow, manual lines stay once
    setNow("2026-09-10", "12:00");
    await t.api.payroll.createAdvance({ employeeId: monthly.id, date: "2026-09-09", amount: B(1000) });
    const re = await t.api.payroll.recalculate(slip.id);
    expect(re.stats.absentDays).toBe(5); // 4,5,7,8,9
    expect(re.items.map((i) => [i.code, i.amount, i.auto])).toEqual([
      ["base", B(15000), true],
      ["bonus", B(500), false],
      ["absent", B(2500), true],
      ["advance", B(3000), true],
      ["social_security", B(700), false],
    ]);

    const [paid] = await t.api.payroll.pay({ ids: [slip.id], paymentMethod: "transfer" });
    expect(paid).toMatchObject({ status: "paid", paymentMethod: "transfer", paidByName: "เจ้าของร้าน" });
    expect((await apiError(() => t.api.payroll.updatePayslip({ id: slip.id, items: [] }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.payroll.recalculate(slip.id))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.payroll.removeRun(run.id))).message).toContain("จ่ายเงินแล้ว");
    const advances = await t.api.payroll.listAdvances({ employeeId: monthly.id });
    expect(advances.items.every((a) => a.settled)).toBe(true);
    expect((await apiError(() => t.api.payroll.removeAdvance(advances.items[0].id))).code).toBe("CONFLICT");

    const back = await t.api.payroll.unpay(slip.id);
    expect(back).toMatchObject({ status: "unpaid", paidAt: null, paymentMethod: null });
    expect((await t.api.audit.list({ entityType: "payslip", entityId: slip.id })).items.map((e) => e.action)).toEqual(["unpay", "pay", "update", "update"]);
  });

  it("removing the advance line, an advance or the run gives the advances back", async () => {
    const { monthly, daily } = await staffWithAttendance();
    const a1 = await t.api.payroll.createAdvance({ employeeId: monthly.id, date: "2026-09-02", amount: B(2000) });
    await t.api.payroll.createAdvance({ employeeId: monthly.id, date: "2026-09-03", amount: B(500) });
    const run = await t.api.payroll.createRun({ periodStart: "2026-09-01", periodEnd: "2026-09-30", employeeIds: [monthly.id] });
    let slip = run.payslips[0];
    expect(slip.items.find((i) => i.code === "advance")?.amount).toBe(B(2500));

    await t.api.payroll.removeAdvance(a1.id);
    slip = await t.api.payroll.getPayslip(slip.id);
    expect(slip.items.find((i) => i.code === "advance")).toMatchObject({ amount: B(500), label: "หักเงินเบิกล่วงหน้า" });

    await t.api.payroll.updatePayslip({ id: slip.id, items: slip.items.filter((i) => i.code !== "advance") });
    expect((await t.api.payroll.listAdvances({ status: "outstanding" })).total).toBe(1);

    // add an employee later, then remove them again
    const added = await t.api.payroll.addPayslip({ runId: run.id, employeeId: daily.id });
    expect((await apiError(() => t.api.payroll.addPayslip({ runId: run.id, employeeId: daily.id }))).code).toBe("CONFLICT");
    await t.api.payroll.removePayslip(added.id);

    await t.api.payroll.recalculate(slip.id); // takes the outstanding advance again
    expect((await t.api.payroll.listAdvances({ status: "outstanding" })).total).toBe(0);
    await t.api.payroll.removeRun(run.id);
    expect((await t.api.payroll.listAdvances({ status: "outstanding" })).total).toBe(1);
    expect((await t.api.payroll.listRuns({})).total).toBe(0);
    expect((await apiError(() => t.api.payroll.getRun(run.id))).code).toBe("NOT_FOUND");
    // the same people can be put in a new run for that period
    await t.api.payroll.createRun({ periodStart: "2026-09-01", periodEnd: "2026-09-30", employeeIds: [monthly.id, daily.id] });
    expect((await t.api.payroll.employeePayslips({ employeeId: monthly.id })).total).toBe(1);
  });
});

describe("demo data", () => {
  it("has users, staff, attendance, a paid payroll run, bill creators and history", async () => {
    vi.useRealTimers();
    const { seedDemo } = await import("../electron/dev/demo-seed");
    await seedDemo(t.ctx);
    const s = await t.api.auth.status();
    expect(s.needsSetup).toBe(false);
    expect(s.users.map((u) => [u.name, u.role, u.hasPassword])).toEqual([
      ["เจ้าของร้าน", "owner", true],
      ["ช่างเอก", "staff", false],
      ["น้องเมย์", "staff", true],
      ["พี่ต้น", "staff", true],
    ]);
    expect((await t.api.auth.login({ userId: s.users[0].id, password: "1234" })).role).toBe("owner");
    expect((await t.api.employees.list({})).total).toBe(5);
    const runs = await t.api.payroll.listRuns({});
    expect(runs.total).toBe(1);
    expect(runs.items[0]).toMatchObject({ payslipCount: 5, paidCount: 5 });
    expect(runs.items[0].totalNet).toBeGreaterThan(0);
    const bills = await t.api.transactions.list({ limit: 1000 });
    expect(bills.items.every((b) => b.createdByName)).toBe(true);
    expect((await t.api.audit.list({ entityType: "transaction" })).total).toBe(bills.total + 1); // + the void
    expect((await t.api.payroll.listAdvances({ status: "outstanding" })).total).toBe(2);
    const board = await t.api.attendance.board();
    expect(board.rows).toHaveLength(5);
  });
});
