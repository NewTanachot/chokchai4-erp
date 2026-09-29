/**
 * attendance.* - the time clock (board + clock are public: employees tap their name without logging in),
 * work sessions, leave days and per-period figures. Managers' edits go to the history; time-clock taps don't
 * (the sessions themselves are the log).
 */
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import {
  attendanceInputSchema,
  attendanceQuerySchema,
  attendanceSummaryQuerySchema,
  attendanceUpdateSchema,
  clockInputSchema,
  employeeDisplayName,
  employeeFullName,
  idSchema,
  leaveInputSchema,
  type AttendanceApi,
  type AttendanceRecord,
  type AttendanceStats,
  type ClockBoardRow,
  type Handlers,
  type LeaveRecord,
  type PayrollSettings,
} from "@shared/contract";
import { toDateStr, type DateStr } from "@shared/dates";
import { attendanceStats, lateMinutesOf, sessionMinutes } from "@shared/payroll";
import type { DbLike } from "../db/client";
import { attendance, employees, leaves } from "../db/schema";
import { diffFields, initialFields, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { AppError, notFound } from "./errors";
import { EMPLOYEE_ORDER } from "./employees";
import { actorOf } from "./session";
import { readSettings } from "./settings";
import { loadUserNames } from "./transaction-read";
import { newId, now } from "./util";

/** An open session older than this is a forgotten clock-out: the next tap starts a new session. */
export const OPEN_SESSION_MAX_MS = 16 * 3_600_000;
/** A second tap within this time is rejected (double tap). */
export const DOUBLE_TAP_MS = 60_000;

type SessionRow = typeof attendance.$inferSelect;
type LeaveRow = typeof leaves.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;

function employeeNames(db: DbLike, ids: string[]): Map<string, string> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  return new Map(
    db
      .select({ id: employees.id, firstName: employees.firstName, nickname: employees.nickname })
      .from(employees)
      .where(inArray(employees.id, unique))
      .all()
      .map((e) => [e.id, employeeDisplayName(e)]),
  );
}

function sessionsIn(db: DbLike, from: DateStr, to: DateStr, employeeIds?: string[]): SessionRow[] {
  const conds: SQL[] = [isNull(attendance.deletedAt), gte(attendance.workDate, from), lte(attendance.workDate, to)];
  if (employeeIds) conds.push(inArray(attendance.employeeId, employeeIds.length ? employeeIds : [""]));
  return db.select().from(attendance).where(and(...conds)).orderBy(asc(attendance.clockIn), asc(attendance.id)).all();
}

function leavesIn(db: DbLike, from: DateStr, to: DateStr, employeeIds?: string[]): LeaveRow[] {
  const conds: SQL[] = [isNull(leaves.deletedAt), gte(leaves.date, from), lte(leaves.date, to)];
  if (employeeIds) conds.push(inArray(leaves.employeeId, employeeIds.length ? employeeIds : [""]));
  return db.select().from(leaves).where(and(...conds)).orderBy(asc(leaves.date)).all();
}

/** Attendance figures of one employee for [from, to] (payroll uses the same function). */
export function employeeStats(db: DbLike, e: Pick<EmployeeRow, "id" | "startDate" | "endDate">, from: DateStr, to: DateStr, settings: PayrollSettings, at = now()): AttendanceStats {
  return attendanceStats({
    from,
    to,
    today: toDateStr(at),
    startDate: e.startDate,
    endDate: e.endDate,
    sessions: sessionsIn(db, from, to, [e.id]),
    leaves: leavesIn(db, from, to, [e.id]).map((l) => ({ date: l.date, type: l.type, halfDay: l.halfDay })),
    settings,
  });
}

/** Late minutes per session: only the first session of an employee's work day can be late. */
function lateBySession(rows: SessionRow[], settings: PayrollSettings): Map<string, number> {
  const first = new Map<string, SessionRow>();
  for (const r of rows) {
    const key = `${r.employeeId}|${r.workDate}`;
    const cur = first.get(key);
    if (!cur || r.clockIn < cur.clockIn) first.set(key, r);
  }
  const out = new Map<string, number>();
  for (const r of first.values()) out.set(r.id, lateMinutesOf(r.workDate, r.clockIn, settings));
  return out;
}

function toRecords(db: DbLike, rows: SessionRow[], settings: PayrollSettings, dayRows: SessionRow[] = rows): AttendanceRecord[] {
  const names = employeeNames(
    db,
    rows.map((r) => r.employeeId),
  );
  const creators = loadUserNames(
    db,
    rows.map((r) => r.createdBy),
  );
  const late = lateBySession(dayRows, settings);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: names.get(r.employeeId) ?? "",
    workDate: r.workDate,
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    minutes: sessionMinutes(r.clockIn, r.clockOut),
    lateMinutes: late.get(r.id) ?? 0,
    source: r.source,
    note: r.note,
    createdByName: r.createdBy ? (creators.get(r.createdBy) ?? null) : null,
    updatedAt: r.updatedAt,
  }));
}

function toLeaveRecords(db: DbLike, rows: LeaveRow[]): LeaveRecord[] {
  const names = employeeNames(
    db,
    rows.map((r) => r.employeeId),
  );
  const creators = loadUserNames(
    db,
    rows.map((r) => r.createdBy),
  );
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: names.get(r.employeeId) ?? "",
    date: r.date,
    type: r.type,
    halfDay: r.halfDay,
    note: r.note,
    createdByName: r.createdBy ? (creators.get(r.createdBy) ?? null) : null,
  }));
}

function mustEmployee(db: DbLike, id: string): EmployeeRow {
  const e = db.select().from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).get();
  if (!e) throw notFound("พนักงาน");
  return e;
}

/** Rejects a session that overlaps another session of the same employee (open sessions count as their start). */
function assertNoOverlap(db: DbLike, employeeId: string, clockIn: number, clockOut: number | null, exceptId?: string): void {
  const end = clockOut ?? clockIn;
  const conds: SQL[] = [
    isNull(attendance.deletedAt),
    eq(attendance.employeeId, employeeId),
    sql`${attendance.clockIn} <= ${end}`,
    sql`COALESCE(${attendance.clockOut}, ${attendance.clockIn}) >= ${clockIn}`,
  ];
  if (exceptId) conds.push(ne(attendance.id, exceptId));
  const hit = db.select({ id: attendance.id }).from(attendance).where(and(...conds)).get();
  if (hit) throw new AppError("CONFLICT", "ช่วงเวลานี้ซ้อนกับเวลาทำงานที่บันทึกไว้แล้ว");
}

const sessionLabel = (name: string, workDate: DateStr) => `${name} · ${workDate}`;

export function createAttendanceApi(ctx: ApiContext): Handlers<AttendanceApi> {
  const { db, session } = ctx;
  const payroll = () => readSettings(db).payroll;

  const getRecord = (id: string): AttendanceRecord => {
    const row = db.select().from(attendance).where(and(eq(attendance.id, id), isNull(attendance.deletedAt))).get();
    if (!row) throw notFound("เวลาทำงาน");
    const sameDay = sessionsIn(db, row.workDate, row.workDate, [row.employeeId]);
    return toRecords(db, [row], payroll(), sameDay)[0];
  };

  const getLeave = (id: string): LeaveRecord => {
    const row = db.select().from(leaves).where(and(eq(leaves.id, id), isNull(leaves.deletedAt))).get();
    if (!row) throw notFound("วันลา");
    return toLeaveRecords(db, [row])[0];
  };

  return {
    board: () => {
      const at = now();
      const s = payroll();
      const today = toDateStr(at);
      const emps = db.select().from(employees).where(and(isNull(employees.deletedAt), eq(employees.isActive, true))).orderBy(EMPLOYEE_ORDER).all();
      const ids = emps.map((e) => e.id);
      const rows = ids.length
        ? db
            .select()
            .from(attendance)
            .where(and(isNull(attendance.deletedAt), inArray(attendance.employeeId, ids), or(eq(attendance.workDate, today), isNull(attendance.clockOut))))
            .orderBy(asc(attendance.clockIn))
            .all()
        : [];
      const todayLeaves = new Map(leavesIn(db, today, today, ids).map((l) => [l.employeeId, l.type]));
      const boardRows = emps.map((e): ClockBoardRow => {
        const mine = rows.filter((r) => r.employeeId === e.id);
        const todays = mine.filter((r) => r.workDate === today);
        const open = mine.filter((r) => r.clockOut === null && at - r.clockIn < OPEN_SESSION_MAX_MS).at(-1);
        const stale = mine.filter((r) => r.clockOut === null && at - r.clockIn >= OPEN_SESSION_MAX_MS).at(-1);
        const firstIn = todays.length ? Math.min(...todays.map((r) => r.clockIn)) : null;
        const outs = todays.flatMap((r) => (r.clockOut === null ? [] : [r.clockOut]));
        const leave = todayLeaves.get(e.id) ?? null;
        return {
          employeeId: e.id,
          name: employeeDisplayName(e),
          fullName: employeeFullName(e),
          position: e.position,
          status: open ? "in" : todays.length ? "done" : leave ? "leave" : "out",
          since: open?.clockIn ?? null,
          firstIn,
          lastOut: outs.length ? Math.max(...outs) : null,
          late: firstIn !== null && lateMinutesOf(today, firstIn, s) > 0,
          leave,
          forgotOutDate: stale?.workDate ?? null,
        };
      });
      return { now: at, date: today, workStart: s.workStart, workEnd: s.workEnd, rows: boardRows };
    },

    clock: (input) => {
      const { employeeId } = clockInputSchema.parse(input);
      const at = now();
      return db.transaction((tx) => {
        const e = mustEmployee(tx, employeeId);
        if (!e.isActive) throw new AppError("VALIDATION", "พนักงานคนนี้ไม่ได้อยู่ในรายชื่อที่ทำงานอยู่แล้ว");
        const mine = tx
          .select()
          .from(attendance)
          .where(and(isNull(attendance.deletedAt), eq(attendance.employeeId, employeeId), gte(attendance.clockIn, at - 2 * OPEN_SESSION_MAX_MS)))
          .orderBy(asc(attendance.clockIn))
          .all();
        const lastAction = Math.max(0, ...mine.map((r) => Math.max(r.clockIn, r.clockOut ?? 0)));
        if (at - lastAction < DOUBLE_TAP_MS) throw new AppError("CONFLICT", "เพิ่งลงเวลาไปเมื่อสักครู่ กรุณารอ 1 นาทีแล้วลองใหม่");
        const name = employeeDisplayName(e);
        const open = mine.filter((r) => r.clockOut === null && at - r.clockIn < OPEN_SESSION_MAX_MS).at(-1);
        if (open) {
          tx.update(attendance).set({ clockOut: at, updatedAt: at }).where(eq(attendance.id, open.id)).run();
          return { action: "out" as const, at, employeeName: name, lateMinutes: 0, minutes: sessionMinutes(open.clockIn, at) };
        }
        const today = toDateStr(at);
        const firstToday = !mine.some((r) => r.workDate === today);
        tx.insert(attendance)
          .values({ id: newId(), employeeId, workDate: today, clockIn: at, source: "clock", createdBy: session.userId, createdAt: at, updatedAt: at })
          .run();
        return { action: "in" as const, at, employeeName: name, lateMinutes: firstToday ? lateMinutesOf(today, at, readSettings(db).payroll) : 0, minutes: null };
      });
    },

    list: (input) => {
      const q = attendanceQuerySchema.parse(input);
      const rows = sessionsIn(db, q.from, q.to, q.employeeId ? [q.employeeId] : undefined);
      return toRecords(db, rows, payroll());
    },

    create: (input) => {
      const v = attendanceInputSchema.parse(input);
      const id = newId();
      const at = now();
      db.transaction((tx) => {
        const e = mustEmployee(tx, v.employeeId);
        assertNoOverlap(tx, v.employeeId, v.clockIn, v.clockOut);
        const workDate = toDateStr(v.clockIn);
        const actor = actorOf(tx, session);
        tx.insert(attendance)
          .values({ id, employeeId: v.employeeId, workDate, clockIn: v.clockIn, clockOut: v.clockOut, source: "manual", note: v.note, createdBy: actor.id, createdAt: at, updatedAt: at })
          .run();
        writeAudit(tx, actor, {
          entityType: "attendance",
          entityId: id,
          entityLabel: sessionLabel(employeeDisplayName(e), workDate),
          action: "create",
          changes: initialFields({ clockIn: v.clockIn, clockOut: v.clockOut, note: v.note }, ["clockIn", "clockOut", "note"]),
          at,
        });
      });
      return getRecord(id);
    },

    update: (input) => {
      const v = attendanceUpdateSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const before = tx.select().from(attendance).where(and(eq(attendance.id, v.id), isNull(attendance.deletedAt))).get();
        if (!before) throw notFound("เวลาทำงาน");
        const e = mustEmployee(tx, v.employeeId);
        assertNoOverlap(tx, v.employeeId, v.clockIn, v.clockOut, v.id);
        const workDate = toDateStr(v.clockIn);
        tx.update(attendance)
          .set({ employeeId: v.employeeId, workDate, clockIn: v.clockIn, clockOut: v.clockOut, note: v.note, updatedAt: at })
          .where(eq(attendance.id, v.id))
          .run();
        const names = employeeNames(tx, [before.employeeId, v.employeeId]);
        const changes = diffFields(
          { employee: names.get(before.employeeId), clockIn: before.clockIn, clockOut: before.clockOut, note: before.note },
          { employee: names.get(v.employeeId), clockIn: v.clockIn, clockOut: v.clockOut, note: v.note },
          ["employee", "clockIn", "clockOut", "note"],
        );
        if (changes.length) {
          writeAudit(tx, actorOf(tx, session), { entityType: "attendance", entityId: v.id, entityLabel: sessionLabel(employeeDisplayName(e), workDate), action: "update", changes, at });
        }
      });
      return getRecord(v.id);
    },

    remove: (input) => {
      const id = idSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const row = tx.select().from(attendance).where(and(eq(attendance.id, id), isNull(attendance.deletedAt))).get();
        if (!row) throw notFound("เวลาทำงาน");
        tx.update(attendance).set({ deletedAt: at, updatedAt: at }).where(eq(attendance.id, id)).run();
        const name = employeeNames(tx, [row.employeeId]).get(row.employeeId) ?? "";
        writeAudit(tx, actorOf(tx, session), {
          entityType: "attendance",
          entityId: id,
          entityLabel: sessionLabel(name, row.workDate),
          action: "delete",
          changes: [
            { field: "clockIn", from: row.clockIn, to: null },
            { field: "clockOut", from: row.clockOut, to: null },
          ],
          at,
        });
      });
    },

    leaves: (input) => {
      const q = attendanceQuerySchema.parse(input);
      return toLeaveRecords(db, leavesIn(db, q.from, q.to, q.employeeId ? [q.employeeId] : undefined));
    },

    saveLeave: (input) => {
      const v = leaveInputSchema.parse(input);
      const at = now();
      const id = v.id ?? newId();
      db.transaction((tx) => {
        const e = mustEmployee(tx, v.employeeId);
        const clash = tx
          .select({ id: leaves.id })
          .from(leaves)
          .where(and(isNull(leaves.deletedAt), eq(leaves.employeeId, v.employeeId), eq(leaves.date, v.date), ne(leaves.id, id)))
          .get();
        if (clash) throw new AppError("CONFLICT", "พนักงานคนนี้มีวันลาในวันที่นี้แล้ว");
        const actor = actorOf(tx, session);
        const label = sessionLabel(employeeDisplayName(e), v.date);
        const values = { employeeId: v.employeeId, date: v.date, type: v.type, halfDay: v.halfDay, note: v.note };
        if (v.id) {
          const before = tx.select().from(leaves).where(and(eq(leaves.id, v.id), isNull(leaves.deletedAt))).get();
          if (!before) throw notFound("วันลา");
          tx.update(leaves).set({ ...values, updatedAt: at }).where(eq(leaves.id, v.id)).run();
          const changes = diffFields(before, values, ["date", "type", "halfDay", "note"]);
          if (changes.length) writeAudit(tx, actor, { entityType: "leave", entityId: id, entityLabel: label, action: "update", changes, at });
        } else {
          tx.insert(leaves)
            .values({ id, ...values, createdBy: actor.id, createdAt: at, updatedAt: at })
            .run();
          writeAudit(tx, actor, { entityType: "leave", entityId: id, entityLabel: label, action: "create", changes: initialFields(values, ["date", "type", "halfDay", "note"]), at });
        }
      });
      return getLeave(id);
    },

    removeLeave: (input) => {
      const id = idSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const row = tx.select().from(leaves).where(and(eq(leaves.id, id), isNull(leaves.deletedAt))).get();
        if (!row) throw notFound("วันลา");
        tx.update(leaves).set({ deletedAt: at, updatedAt: at }).where(eq(leaves.id, id)).run();
        const name = employeeNames(tx, [row.employeeId]).get(row.employeeId) ?? "";
        writeAudit(tx, actorOf(tx, session), { entityType: "leave", entityId: id, entityLabel: sessionLabel(name, row.date), action: "delete", at });
      });
    },

    summary: (input) => {
      const q = attendanceSummaryQuerySchema.parse(input);
      const s = payroll();
      const at = now();
      const all = db.select().from(employees).where(isNull(employees.deletedAt)).orderBy(EMPLOYEE_ORDER).all();
      const sessions = sessionsIn(db, q.from, q.to);
      const leaveRows = leavesIn(db, q.from, q.to);
      const active = new Set([...sessions.map((r) => r.employeeId), ...leaveRows.map((r) => r.employeeId)]);
      const today = toDateStr(at);
      return all
        .filter((e) => e.isActive || (q.includeInactive && active.has(e.id)))
        .map((e) => ({
          employeeId: e.id,
          name: employeeDisplayName(e),
          fullName: employeeFullName(e),
          position: e.position,
          payType: e.payType,
          isActive: e.isActive,
          stats: attendanceStats({
            from: q.from,
            to: q.to,
            today,
            startDate: e.startDate,
            endDate: e.endDate,
            sessions: sessions.filter((r) => r.employeeId === e.id),
            leaves: leaveRows.filter((l) => l.employeeId === e.id).map((l) => ({ date: l.date, type: l.type, halfDay: l.halfDay })),
            settings: s,
          }),
        }));
    },
  };
}
