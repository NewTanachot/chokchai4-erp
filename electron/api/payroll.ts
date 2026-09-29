/**
 * payroll.* - pay periods (payroll_runs), payslips with earning / deduction lines, and salary advances.
 *
 * A payslip is calculated from the employee's pay rate, attendance, leaves, the payroll settings and their
 * outstanding advances (shared/payroll.ts). Calculated lines are `auto`; the owner may edit amounts or add lines,
 * which makes them manual. "คำนวณใหม่" replaces only auto lines whose code has no manual line. An advance is
 * taken by the payslip that deducts it (salary_advances.payslip_id) and is settled once that payslip is paid.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  PAY_ITEM_KIND,
  addPayslipSchema,
  advanceInputSchema,
  advanceListQuerySchema,
  employeeDisplayName,
  employeePayslipsQuerySchema,
  idSchema,
  payrollPeriodSchema,
  payrollRunCreateSchema,
  payrollRunsQuerySchema,
  payrollRunUpdateSchema,
  payslipPaySchema,
  payslipUpdateSchema,
  type AttendanceStats,
  type Handlers,
  type PayItemCode,
  type PayrollApi,
  type PayrollCandidate,
  type PayrollRunSummary,
  type PayrollSettings,
  type Payslip,
  type PayslipItem,
  type SalaryAdvance,
} from "@shared/contract";
import type { DateStr } from "@shared/dates";
import { calcPayslipLines, payrollTitle, payslipTotals, type PayLine } from "@shared/payroll";
import type { DbLike, Tx } from "../db/client";
import { employees, payrollRuns, payslipItems, payslips, salaryAdvances } from "../db/schema";
import { employeeStats } from "./attendance";
import { diffFields, initialFields, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { AppError, notFound } from "./errors";
import { actorOf, type Actor } from "./session";
import { readSettings } from "./settings";
import { loadUserNames } from "./transaction-read";
import { newId, now } from "./util";
import { mainLanguage } from "../i18n";

type RunRow = typeof payrollRuns.$inferSelect;
type PayslipRow = typeof payslips.$inferSelect;
type ItemRow = typeof payslipItems.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;

// ------------------------------------------------------------------------------------------ read model

function parseStats(json: string): AttendanceStats {
  try {
    return JSON.parse(json) as AttendanceStats;
  } catch {
    return { workDays: 0, daysWorked: 0, minutesWorked: 0, lateCount: 0, lateMinutes: 0, absentDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, otMinutes: 0, forgotOutCount: 0 };
  }
}

const toItem = (r: ItemRow): PayslipItem => ({
  id: r.id,
  kind: r.kind,
  code: r.code as PayItemCode,
  label: r.label,
  amount: r.amount,
  qty: r.qty,
  rate: r.rate,
  auto: r.auto,
});

/** Payslips by id (same order), with lines, run and payer info. */
export function loadPayslips(db: DbLike, ids: string[]): Payslip[] {
  if (!ids.length) return [];
  const rows = db.select().from(payslips).where(inArray(payslips.id, ids)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = db.select().from(payslipItems).where(inArray(payslipItems.payslipId, ids)).orderBy(asc(payslipItems.lineNo)).all();
  const runs = new Map(
    db
      .select()
      .from(payrollRuns)
      .where(inArray(payrollRuns.id, [...new Set(rows.map((r) => r.runId))]))
      .all()
      .map((r) => [r.id, r]),
  );
  const emps = new Map(
    db
      .select({ id: employees.id, bankName: employees.bankName, bankAccount: employees.bankAccount })
      .from(employees)
      .where(inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))]))
      .all()
      .map((e) => [e.id, e]),
  );
  const payers = loadUserNames(
    db,
    rows.map((r) => r.paidBy),
  );
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const run = runs.get(r.runId)!;
    const emp = emps.get(r.employeeId);
    return [
      {
        id: r.id,
        runId: r.runId,
        runTitle: run.title,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        position: r.position,
        payType: r.payType,
        payRate: r.payRate,
        stats: parseStats(r.stats),
        items: items.filter((i) => i.payslipId === id).map(toItem),
        earnings: r.earnings,
        deductions: r.deductions,
        net: r.net,
        status: r.status,
        paidAt: r.paidAt,
        paymentMethod: r.paymentMethod,
        paidByName: r.paidBy ? (payers.get(r.paidBy) ?? null) : null,
        bankName: emp?.bankName ?? null,
        bankAccount: emp?.bankAccount ?? null,
        note: r.note,
        updatedAt: r.updatedAt,
      },
    ];
  });
}

function runSummaries(db: DbLike, runs: RunRow[]): PayrollRunSummary[] {
  if (!runs.length) return [];
  const agg = new Map(
    db
      .select({
        runId: payslips.runId,
        count: sql<number>`count(*)`,
        paid: sql<number>`SUM(CASE WHEN ${payslips.status} = 'paid' THEN 1 ELSE 0 END)`,
        earnings: sql<number>`COALESCE(SUM(${payslips.earnings}), 0)`,
        deductions: sql<number>`COALESCE(SUM(${payslips.deductions}), 0)`,
        net: sql<number>`COALESCE(SUM(${payslips.net}), 0)`,
      })
      .from(payslips)
      .where(
        inArray(
          payslips.runId,
          runs.map((r) => r.id),
        ),
      )
      .groupBy(payslips.runId)
      .all()
      .map((a) => [a.runId, a]),
  );
  const creators = loadUserNames(
    db,
    runs.map((r) => r.createdBy),
  );
  return runs.map((r) => {
    const a = agg.get(r.id);
    return {
      id: r.id,
      title: r.title,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      note: r.note,
      payslipCount: a?.count ?? 0,
      paidCount: a?.paid ?? 0,
      totalEarnings: a?.earnings ?? 0,
      totalDeductions: a?.deductions ?? 0,
      totalNet: a?.net ?? 0,
      createdAt: r.createdAt,
      createdByName: r.createdBy ? (creators.get(r.createdBy) ?? null) : null,
      updatedAt: r.updatedAt,
    };
  });
}

function mustRun(db: DbLike, id: string): RunRow {
  const run = db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), isNull(payrollRuns.deletedAt))).get();
  if (!run) throw notFound("งวดเงินเดือน");
  return run;
}

function mustPayslipRow(db: DbLike, id: string): PayslipRow & { run: RunRow } {
  const row = db.select().from(payslips).where(eq(payslips.id, id)).get();
  if (!row) throw notFound("สลิปเงินเดือน");
  return { ...row, run: mustRun(db, row.runId) };
}

function assertUnpaid(p: PayslipRow): void {
  if (p.status === "paid") throw new AppError("CONFLICT", "สลิปนี้จ่ายเงินแล้ว แก้ไขไม่ได้ (ยกเลิกการจ่ายก่อนถ้าต้องการแก้)");
}

/** Payslips of these employees in other runs whose period overlaps [from, to]. */
function overlaps(db: DbLike, employeeIds: string[], from: DateStr, to: DateStr, exceptRunId?: string) {
  if (!employeeIds.length) return [];
  return db
    .select({ employeeId: payslips.employeeId, runId: payrollRuns.id, title: payrollRuns.title, name: payslips.employeeName })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(
      and(
        isNull(payrollRuns.deletedAt),
        inArray(payslips.employeeId, employeeIds),
        lte(payrollRuns.periodStart, to),
        gte(payrollRuns.periodEnd, from),
        exceptRunId ? ne(payrollRuns.id, exceptRunId) : undefined,
      ),
    )
    .all();
}

// ------------------------------------------------------------------------------------------ calculation

/** Outstanding (not taken) advances of an employee dated up to `to`. */
function outstandingAdvances(db: DbLike, employeeId: string, to: DateStr) {
  return db
    .select()
    .from(salaryAdvances)
    .where(and(isNull(salaryAdvances.deletedAt), isNull(salaryAdvances.payslipId), eq(salaryAdvances.employeeId, employeeId), lte(salaryAdvances.date, to)))
    .orderBy(asc(salaryAdvances.date))
    .all();
}

function writeItems(tx: Tx, payslipId: string, lines: Omit<PayLine, "kind">[]): void {
  tx.delete(payslipItems).where(eq(payslipItems.payslipId, payslipId)).run();
  lines.forEach((l, i) => {
    tx.insert(payslipItems)
      .values({ id: newId(), payslipId, lineNo: i + 1, kind: PAY_ITEM_KIND[l.code], code: l.code, label: l.label, amount: l.amount, qty: l.qty, rate: l.rate, auto: l.auto })
      .run();
  });
}

function currentLines(db: DbLike, payslipId: string): PayLine[] {
  return db
    .select()
    .from(payslipItems)
    .where(eq(payslipItems.payslipId, payslipId))
    .orderBy(asc(payslipItems.lineNo))
    .all()
    .map((r) => ({ kind: r.kind, code: r.code as PayItemCode, label: r.label, amount: r.amount, qty: r.qty, rate: r.rate, auto: r.auto }));
}

/** Stores the payslip totals from its lines. */
function saveTotals(tx: Tx, payslipId: string, at: number): void {
  const t = payslipTotals(currentLines(tx, payslipId));
  tx.update(payslips).set({ ...t, updatedAt: at }).where(eq(payslips.id, payslipId)).run();
}

/**
 * (Re)calculates a payslip: snapshot of the employee, attendance stats, auto lines (codes that have a manual line
 * keep only the manual line) and takes the employee's outstanding advances.
 */
function calculate(tx: Tx, payslipId: string, run: RunRow, e: EmployeeRow, settings: PayrollSettings, at: number, keep: PayLine[] = []): void {
  tx.update(salaryAdvances).set({ payslipId: null, updatedAt: at }).where(eq(salaryAdvances.payslipId, payslipId)).run();
  const stats = employeeStats(tx, e, run.periodStart, run.periodEnd, settings, at);
  const advances = outstandingAdvances(tx, e.id, run.periodEnd);
  const manual = keep.filter((l) => !l.auto);
  const manualCodes = new Set(manual.map((l) => l.code));
  const auto = calcPayslipLines({
    payType: e.payType,
    payRate: e.payRate,
    socialSecurity: e.socialSecurity,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    startDate: e.startDate,
    endDate: e.endDate,
    stats,
    advances,
    settings,
  }).filter((l) => !manualCodes.has(l.code));
  // Auto lines first (in calculation order), then the owner's own lines.
  const lines = [...auto.filter((l) => l.kind === "earning"), ...manual.filter((l) => l.kind === "earning"), ...auto.filter((l) => l.kind === "deduction"), ...manual.filter((l) => l.kind === "deduction")];
  tx.update(payslips)
    .set({ employeeName: employeeDisplayName(e), position: e.position, payType: e.payType, payRate: e.payRate, stats: JSON.stringify(stats), updatedAt: at })
    .where(eq(payslips.id, payslipId))
    .run();
  writeItems(tx, payslipId, lines);
  // The payslip takes the advances when it deducts them (auto line, or a manual advance line).
  if (advances.length && lines.some((l) => l.code === "advance")) {
    tx.update(salaryAdvances)
      .set({ payslipId, updatedAt: at })
      .where(
        inArray(
          salaryAdvances.id,
          advances.map((a) => a.id),
        ),
      )
      .run();
  }
  saveTotals(tx, payslipId, at);
}

function createPayslip(tx: Tx, run: RunRow, e: EmployeeRow, settings: PayrollSettings, at: number): string {
  const id = newId();
  tx.insert(payslips)
    .values({ id, runId: run.id, employeeId: e.id, employeeName: employeeDisplayName(e), position: e.position, payType: e.payType, payRate: e.payRate, stats: "{}", createdAt: at, updatedAt: at })
    .run();
  calculate(tx, id, run, e, settings, at);
  return id;
}

function mustEmployeeRow(db: DbLike, id: string): EmployeeRow {
  const e = db.select().from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).get();
  if (!e) throw notFound("พนักงาน");
  return e;
}

// ------------------------------------------------------------------------------------------ advances

function toAdvances(db: DbLike, rows: (typeof salaryAdvances.$inferSelect)[]): SalaryAdvance[] {
  const empIds = [...new Set(rows.map((r) => r.employeeId))];
  const names = new Map(
    empIds.length
      ? db
          .select({ id: employees.id, firstName: employees.firstName, nickname: employees.nickname })
          .from(employees)
          .where(inArray(employees.id, empIds))
          .all()
          .map((e) => [e.id, employeeDisplayName(e)])
      : [],
  );
  const slipIds = [...new Set(rows.flatMap((r) => (r.payslipId ? [r.payslipId] : [])))];
  const slips = new Map(
    slipIds.length
      ? db
          .select({ id: payslips.id, status: payslips.status, runId: payrollRuns.id, title: payrollRuns.title })
          .from(payslips)
          .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
          .where(inArray(payslips.id, slipIds))
          .all()
          .map((s) => [s.id, s])
      : [],
  );
  const creators = loadUserNames(
    db,
    rows.map((r) => r.createdBy),
  );
  return rows.map((r) => {
    const slip = r.payslipId ? slips.get(r.payslipId) : undefined;
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeName: names.get(r.employeeId) ?? "",
      date: r.date,
      amount: r.amount,
      note: r.note,
      payslipId: r.payslipId,
      runId: slip?.runId ?? null,
      runTitle: slip?.title ?? null,
      settled: slip?.status === "paid",
      createdAt: r.createdAt,
      createdByName: r.createdBy ? (creators.get(r.createdBy) ?? null) : null,
    };
  });
}

/** After an advance of an unpaid payslip is removed, its auto advance line follows the advances still taken. */
function refreshAdvanceLine(tx: Tx, payslipId: string, at: number): void {
  const taken = tx
    .select({ amount: salaryAdvances.amount })
    .from(salaryAdvances)
    .where(and(isNull(salaryAdvances.deletedAt), eq(salaryAdvances.payslipId, payslipId)))
    .all();
  const total = taken.reduce((s, a) => s + a.amount, 0);
  const lines = currentLines(tx, payslipId);
  const auto = lines.find((l) => l.code === "advance" && l.auto);
  if (!auto) return;
  const next = total > 0 ? lines.map((l) => (l === auto ? { ...l, amount: total, label: taken.length > 1 ? `หักเงินเบิกล่วงหน้า (${taken.length} ครั้ง)` : "หักเงินเบิกล่วงหน้า" } : l)) : lines.filter((l) => l !== auto);
  writeItems(tx, payslipId, next);
  saveTotals(tx, payslipId, at);
}

// ------------------------------------------------------------------------------------------ api

export function createPayrollApi(ctx: ApiContext): Handlers<PayrollApi> {
  const { db, session } = ctx;

  const getRunDetail = (id: string) => {
    const run = mustRun(db, id);
    const ids = db
      .select({ id: payslips.id })
      .from(payslips)
      .where(eq(payslips.runId, id))
      .orderBy(asc(payslips.employeeName))
      .all()
      .map((r) => r.id);
    return { ...runSummaries(db, [run])[0], payslips: loadPayslips(db, ids) };
  };
  const getPayslip = (id: string) => {
    const [p] = loadPayslips(db, [mustPayslipRow(db, id).id]);
    return p;
  };
  const audit = (tx: DbLike, actor: Actor, entityType: "payroll" | "payslip" | "advance", entityId: string, entityLabel: string, action: "create" | "update" | "delete" | "pay" | "unpay", extra: { changes?: ReturnType<typeof diffFields>; note?: string | null; at?: number } = {}) =>
    writeAudit(tx, actor, { entityType, entityId, entityLabel, action, ...extra });
  const slipLabel = (p: { employeeName: string }, run: RunRow) => `${p.employeeName} · ${run.title}`;

  return {
    listRuns: (input) => {
      const q = payrollRunsQuerySchema.parse(input ?? {});
      const where = isNull(payrollRuns.deletedAt);
      const runs = db.select().from(payrollRuns).where(where).orderBy(desc(payrollRuns.periodStart), desc(payrollRuns.createdAt)).limit(q.limit).offset(q.offset).all();
      const total = db.select({ n: sql<number>`count(*)` }).from(payrollRuns).where(where).get()?.n ?? 0;
      return { items: runSummaries(db, runs), total };
    },

    getRun: (input) => getRunDetail(idSchema.parse(input)),

    candidates: (input) => {
      const p = payrollPeriodSchema.parse(input);
      const rows = db
        .select()
        .from(employees)
        .where(
          and(
            isNull(employees.deletedAt),
            sql`(${employees.isActive} = 1 OR (${employees.endDate} IS NOT NULL AND ${employees.endDate} >= ${p.periodStart}))`,
            sql`(${employees.startDate} IS NULL OR ${employees.startDate} <= ${p.periodEnd})`,
          ),
        )
        .all();
      const clash = new Map(
        overlaps(
          db,
          rows.map((r) => r.id),
          p.periodStart,
          p.periodEnd,
        ).map((o) => [o.employeeId, { runId: o.runId, title: o.title }]),
      );
      return rows
        .map(
          (e): PayrollCandidate => ({
            employeeId: e.id,
            name: employeeDisplayName(e),
            fullName: [e.firstName, e.lastName].filter(Boolean).join(" "),
            position: e.position,
            payType: e.payType,
            payRate: e.payRate,
            isActive: e.isActive,
            overlap: clash.get(e.id) ?? null,
          }),
        )
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "th"));
    },

    createRun: (input) => {
      const v = payrollRunCreateSchema.parse(input);
      const settings = readSettings(db).payroll;
      const at = now();
      const id = newId();
      db.transaction((tx) => {
        const ids = [...new Set(v.employeeIds)];
        const emps = ids.map((eid) => mustEmployeeRow(tx, eid));
        const clash = overlaps(tx, ids, v.periodStart, v.periodEnd);
        if (clash.length) {
          const names = [...new Set(clash.map((c) => `${c.name} (${c.title})`))].join(", ");
          throw new AppError("CONFLICT", `พนักงานต่อไปนี้มีสลิปในงวดที่ช่วงวันที่ซ้อนกันแล้ว: ${names}`, clash);
        }
        const actor = actorOf(tx, session);
        const title = v.title ?? payrollTitle(v.periodStart, v.periodEnd, mainLanguage());
        tx.insert(payrollRuns)
          .values({ id, title, periodStart: v.periodStart, periodEnd: v.periodEnd, note: v.note, createdBy: actor.id, createdAt: at, updatedAt: at })
          .run();
        const run = mustRun(tx, id);
        for (const e of emps) createPayslip(tx, run, e, settings, at);
        const [summary] = runSummaries(tx, [run]);
        audit(tx, actor, "payroll", id, title, "create", {
          changes: initialFields({ periodStart: v.periodStart, periodEnd: v.periodEnd, payslips: summary.payslipCount, net: summary.totalNet }, ["periodStart", "periodEnd", "payslips", "net"]),
          at,
        });
      });
      return getRunDetail(id);
    },

    updateRun: (input) => {
      const v = payrollRunUpdateSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const before = mustRun(tx, v.id);
        tx.update(payrollRuns).set({ title: v.title, note: v.note, updatedAt: at }).where(eq(payrollRuns.id, v.id)).run();
        const changes = diffFields(before, v, ["title", "note"]);
        if (changes.length) audit(tx, actorOf(tx, session), "payroll", v.id, v.title, "update", { changes, at });
      });
      return runSummaries(db, [mustRun(db, v.id)])[0];
    },

    removeRun: (input) => {
      const id = idSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const run = mustRun(tx, id);
        const slips = tx.select().from(payslips).where(eq(payslips.runId, id)).all();
        if (slips.some((p) => p.status === "paid")) throw new AppError("CONFLICT", "งวดนี้มีสลิปที่จ่ายเงินแล้ว ลบไม่ได้ (ยกเลิกการจ่ายของสลิปนั้นก่อน)");
        const [summary] = runSummaries(tx, [run]);
        if (slips.length) {
          const slipIds = slips.map((p) => p.id);
          tx.update(salaryAdvances).set({ payslipId: null, updatedAt: at }).where(inArray(salaryAdvances.payslipId, slipIds)).run();
          tx.delete(payslips).where(eq(payslips.runId, id)).run();
        }
        tx.update(payrollRuns).set({ deletedAt: at, updatedAt: at }).where(eq(payrollRuns.id, id)).run();
        audit(tx, actorOf(tx, session), "payroll", id, run.title, "delete", {
          changes: [
            { field: "payslips", from: summary.payslipCount, to: null },
            { field: "net", from: summary.totalNet, to: null },
          ],
          at,
        });
      });
    },

    addPayslip: (input) => {
      const v = addPayslipSchema.parse(input);
      const settings = readSettings(db).payroll;
      const at = now();
      const id = db.transaction((tx) => {
        const run = mustRun(tx, v.runId);
        const e = mustEmployeeRow(tx, v.employeeId);
        if (tx.select({ id: payslips.id }).from(payslips).where(and(eq(payslips.runId, run.id), eq(payslips.employeeId, e.id))).get()) {
          throw new AppError("CONFLICT", "พนักงานคนนี้อยู่ในงวดนี้แล้ว");
        }
        const clash = overlaps(tx, [e.id], run.periodStart, run.periodEnd, run.id);
        if (clash.length) throw new AppError("CONFLICT", `พนักงานคนนี้มีสลิปใน "${clash[0].title}" ซึ่งช่วงวันที่ซ้อนกันแล้ว`);
        const slipId = createPayslip(tx, run, e, settings, at);
        const [p] = loadPayslips(tx, [slipId]);
        audit(tx, actorOf(tx, session), "payslip", slipId, slipLabel(p, run), "create", { changes: initialFields(p, ["net"]), at });
        return slipId;
      });
      return getPayslip(id);
    },

    getPayslip: (input) => getPayslip(idSchema.parse(input)),

    updatePayslip: (input) => {
      const v = payslipUpdateSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const p = mustPayslipRow(tx, v.id);
        assertUnpaid(p);
        writeItems(
          tx,
          v.id,
          v.items.map((i) => ({ ...i, amount: Math.round(i.amount) })),
        );
        if (!v.items.some((i) => i.code === "advance")) {
          // No advance deduction any more: the advances become outstanding again.
          tx.update(salaryAdvances).set({ payslipId: null, updatedAt: at }).where(eq(salaryAdvances.payslipId, v.id)).run();
        }
        tx.update(payslips).set({ note: v.note, updatedAt: at }).where(eq(payslips.id, v.id)).run();
        saveTotals(tx, v.id, at);
        const after = tx.select().from(payslips).where(eq(payslips.id, v.id)).get()!;
        const changes = diffFields(p, after, ["earnings", "deductions", "net", "note"]);
        if (changes.length) audit(tx, actorOf(tx, session), "payslip", v.id, slipLabel(p, p.run), "update", { changes, at });
      });
      return getPayslip(v.id);
    },

    recalculate: (input) => {
      const id = idSchema.parse(input);
      const settings = readSettings(db).payroll;
      const at = now();
      db.transaction((tx) => {
        const p = mustPayslipRow(tx, id);
        assertUnpaid(p);
        const e = tx.select().from(employees).where(eq(employees.id, p.employeeId)).get();
        if (!e) throw notFound("พนักงาน");
        calculate(tx, id, p.run, e, settings, at, currentLines(tx, id));
        const after = tx.select().from(payslips).where(eq(payslips.id, id)).get()!;
        const changes = diffFields(p, after, ["earnings", "deductions", "net"]);
        if (changes.length) audit(tx, actorOf(tx, session), "payslip", id, slipLabel(after, p.run), "update", { changes, note: "คำนวณใหม่", at });
      });
      return getPayslip(id);
    },

    removePayslip: (input) => {
      const id = idSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const p = mustPayslipRow(tx, id);
        assertUnpaid(p);
        tx.update(salaryAdvances).set({ payslipId: null, updatedAt: at }).where(eq(salaryAdvances.payslipId, id)).run();
        tx.delete(payslips).where(eq(payslips.id, id)).run();
        audit(tx, actorOf(tx, session), "payslip", id, slipLabel(p, p.run), "delete", { changes: [{ field: "net", from: p.net, to: null }], at });
      });
    },

    pay: (input) => {
      const v = payslipPaySchema.parse(input);
      const at = now();
      const paidAt = v.paidAt ?? at;
      const ids = [...new Set(v.ids)];
      db.transaction((tx) => {
        const actor = actorOf(tx, session);
        for (const id of ids) {
          const p = mustPayslipRow(tx, id);
          if (p.status === "paid") continue;
          tx.update(payslips).set({ status: "paid", paidAt, paymentMethod: v.paymentMethod, paidBy: actor.id, updatedAt: at }).where(eq(payslips.id, id)).run();
          audit(tx, actor, "payslip", id, slipLabel(p, p.run), "pay", {
            changes: [
              { field: "net", from: null, to: p.net },
              { field: "paymentMethod", from: null, to: v.paymentMethod },
            ],
            at,
          });
        }
      });
      return loadPayslips(db, ids);
    },

    unpay: (input) => {
      const id = idSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const p = mustPayslipRow(tx, id);
        if (p.status !== "paid") throw new AppError("CONFLICT", "สลิปนี้ยังไม่ได้จ่ายเงิน");
        tx.update(payslips).set({ status: "unpaid", paidAt: null, paymentMethod: null, paidBy: null, updatedAt: at }).where(eq(payslips.id, id)).run();
        audit(tx, actorOf(tx, session), "payslip", id, slipLabel(p, p.run), "unpay", { changes: [{ field: "net", from: p.net, to: null }], at });
      });
      return getPayslip(id);
    },

    employeePayslips: (input) => {
      const q = employeePayslipsQuerySchema.parse(input);
      const where = and(eq(payslips.employeeId, q.employeeId), isNull(payrollRuns.deletedAt));
      const ids = db
        .select({ id: payslips.id })
        .from(payslips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
        .where(where)
        .orderBy(desc(payrollRuns.periodStart), desc(payslips.createdAt))
        .limit(q.limit)
        .offset(q.offset)
        .all()
        .map((r) => r.id);
      const total =
        db
          .select({ n: sql<number>`count(*)` })
          .from(payslips)
          .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
          .where(where)
          .get()?.n ?? 0;
      return { items: loadPayslips(db, ids), total };
    },

    listAdvances: (input) => {
      const q = advanceListQuerySchema.parse(input ?? {});
      const where = and(
        isNull(salaryAdvances.deletedAt),
        q.employeeId ? eq(salaryAdvances.employeeId, q.employeeId) : undefined,
        q.status === "outstanding" ? isNull(salaryAdvances.payslipId) : undefined,
      );
      const rows = db.select().from(salaryAdvances).where(where).orderBy(desc(salaryAdvances.date), desc(salaryAdvances.createdAt)).limit(q.limit).offset(q.offset).all();
      const total = db.select({ n: sql<number>`count(*)` }).from(salaryAdvances).where(where).get()?.n ?? 0;
      return { items: toAdvances(db, rows), total };
    },

    createAdvance: (input) => {
      const v = advanceInputSchema.parse(input);
      const at = now();
      const id = newId();
      db.transaction((tx) => {
        const e = mustEmployeeRow(tx, v.employeeId);
        const actor = actorOf(tx, session);
        tx.insert(salaryAdvances)
          .values({ id, employeeId: v.employeeId, date: v.date, amount: v.amount, note: v.note, createdBy: actor.id, createdAt: at, updatedAt: at })
          .run();
        audit(tx, actor, "advance", id, `${employeeDisplayName(e)} · ${v.date}`, "create", { changes: initialFields(v, ["date", "amount", "note"]), at });
      });
      return toAdvances(db, [db.select().from(salaryAdvances).where(eq(salaryAdvances.id, id)).get()!])[0];
    },

    removeAdvance: (input) => {
      const id = idSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const a = tx.select().from(salaryAdvances).where(and(eq(salaryAdvances.id, id), isNull(salaryAdvances.deletedAt))).get();
        if (!a) throw notFound("รายการเบิกเงิน");
        const slip = a.payslipId ? tx.select().from(payslips).where(eq(payslips.id, a.payslipId)).get() : undefined;
        if (slip?.status === "paid") throw new AppError("CONFLICT", "เงินเบิกนี้ถูกหักในสลิปที่จ่ายแล้ว ลบไม่ได้");
        tx.update(salaryAdvances).set({ deletedAt: at, updatedAt: at, payslipId: null }).where(eq(salaryAdvances.id, id)).run();
        if (slip) refreshAdvanceLine(tx, slip.id, at);
        const e = tx.select({ firstName: employees.firstName, nickname: employees.nickname }).from(employees).where(eq(employees.id, a.employeeId)).get();
        const name = e ? employeeDisplayName(e) : "";
        audit(tx, actorOf(tx, session), "advance", id, `${name} · ${a.date}`, "delete", { changes: [{ field: "amount", from: a.amount, to: null }], at });
      });
    },
  };
}
