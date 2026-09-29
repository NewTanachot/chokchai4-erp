/** employees.* - staff records with pay rates (employees.manage; enforced in ./access.ts). */
import { and, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  employeeDisplayName,
  employeeFullName,
  employeeInputSchema,
  employeeListQuerySchema,
  employeeUpdateSchema,
  idSchema,
  type Employee,
  type EmployeesApi,
  type Handlers,
} from "@shared/contract";
import type { DbLike } from "../db/client";
import { employees, users } from "../db/schema";
import { diffFields, initialFields, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { AppError, notFound } from "./errors";
import { actorOf } from "./session";
import { digitsOnly, likePattern, newId, now } from "./util";

type EmployeeRow = typeof employees.$inferSelect;

const AUDIT_FIELDS = [
  "code",
  "firstName",
  "lastName",
  "nickname",
  "position",
  "phone",
  "lineId",
  "nationalId",
  "birthDate",
  "address",
  "emergencyName",
  "emergencyPhone",
  "startDate",
  "endDate",
  "isActive",
  "payType",
  "payRate",
  "socialSecurity",
  "bankName",
  "bankAccount",
  "note",
] as const;

/** Employees' linked (non-deleted) login accounts. */
function linkedUsers(db: DbLike, ids: string[]): Map<string, { id: string; name: string }> {
  if (!ids.length) return new Map();
  return new Map(
    db
      .select({ id: users.id, name: users.name, employeeId: users.employeeId })
      .from(users)
      .where(and(inArray(users.employeeId, ids), isNull(users.deletedAt)))
      .all()
      .map((u) => [u.employeeId!, { id: u.id, name: u.name }]),
  );
}

function toEmployee(r: EmployeeRow, user: { id: string; name: string } | undefined): Employee {
  return {
    id: r.id,
    code: r.code,
    firstName: r.firstName,
    lastName: r.lastName,
    nickname: r.nickname,
    displayName: employeeDisplayName(r),
    fullName: employeeFullName(r),
    position: r.position,
    phone: r.phone,
    lineId: r.lineId,
    nationalId: r.nationalId,
    birthDate: r.birthDate,
    address: r.address,
    emergencyName: r.emergencyName,
    emergencyPhone: r.emergencyPhone,
    startDate: r.startDate,
    endDate: r.endDate,
    isActive: r.isActive,
    payType: r.payType,
    payRate: r.payRate,
    socialSecurity: r.socialSecurity,
    bankName: r.bankName,
    bankAccount: r.bankAccount,
    note: r.note,
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toEmployees(db: DbLike, rows: EmployeeRow[]): Employee[] {
  const linked = linkedUsers(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toEmployee(r, linked.get(r.id)));
}

/** Non-deleted employee (or also deleted ones with `includeDeleted`). */
export function getEmployee(db: DbLike, id: string, includeDeleted = false): Employee | undefined {
  const row = db
    .select()
    .from(employees)
    .where(includeDeleted ? eq(employees.id, id) : and(eq(employees.id, id), isNull(employees.deletedAt)))
    .get();
  return row ? toEmployees(db, [row])[0] : undefined;
}

function assertCodeFree(db: DbLike, code: string | null, exceptId?: string): void {
  if (!code) return;
  const conds: SQL[] = [isNull(employees.deletedAt), sql`lower(${employees.code}) = lower(${code})`];
  if (exceptId) conds.push(ne(employees.id, exceptId));
  if (db.select({ id: employees.id }).from(employees).where(and(...conds)).get()) {
    throw new AppError("CONFLICT", "รหัสพนักงานนี้มีอยู่แล้ว", { field: "code" });
  }
}

/** Sort key: what the shop calls them (nickname, else first name). */
export const EMPLOYEE_ORDER = sql`lower(COALESCE(NULLIF(trim(${employees.nickname}), ''), ${employees.firstName}))`;

export function createEmployeesApi(ctx: ApiContext): Handlers<EmployeesApi> {
  const { db, session } = ctx;

  const mustGet = (id: string): Employee => {
    const e = getEmployee(db, id);
    if (!e) throw notFound("พนักงาน");
    return e;
  };

  return {
    list: (input) => {
      const q = employeeListQuerySchema.parse(input ?? {});
      const conds: SQL[] = [isNull(employees.deletedAt)];
      if (q.status === "active") conds.push(eq(employees.isActive, true));
      if (q.status === "resigned") conds.push(eq(employees.isActive, false));
      for (const term of (q.search ?? "").split(/\s+/).filter(Boolean)) {
        const p = likePattern(term);
        const ors: SQL[] = [
          sql`${employees.firstName} LIKE ${p} ESCAPE '\\'`,
          sql`${employees.lastName} LIKE ${p} ESCAPE '\\'`,
          sql`${employees.nickname} LIKE ${p} ESCAPE '\\'`,
          sql`${employees.code} LIKE ${p} ESCAPE '\\'`,
          sql`${employees.position} LIKE ${p} ESCAPE '\\'`,
          sql`${employees.phone} LIKE ${p} ESCAPE '\\'`,
        ];
        const digits = digitsOnly(term);
        if (digits.length >= 3) ors.push(sql`replace(replace(${employees.phone}, '-', ''), ' ', '') LIKE ${"%" + digits + "%"}`);
        conds.push(sql`(${sql.join(ors, sql` OR `)})`);
      }
      const where = and(...conds);
      const rows = db.select().from(employees).where(where).orderBy(EMPLOYEE_ORDER, employees.id).limit(q.limit).offset(q.offset).all();
      const total = db.select({ n: sql<number>`count(*)` }).from(employees).where(where).get()?.n ?? 0;
      return { items: toEmployees(db, rows), total };
    },

    get: (input) => mustGet(idSchema.parse(input)),

    create: (input) => {
      const v = employeeInputSchema.parse(input);
      const id = newId();
      const at = now();
      db.transaction((tx) => {
        assertCodeFree(tx, v.code);
        tx.insert(employees)
          .values({ id, ...v, createdAt: at, updatedAt: at })
          .run();
        writeAudit(tx, actorOf(tx, session), {
          entityType: "employee",
          entityId: id,
          entityLabel: employeeFullName(v),
          action: "create",
          changes: initialFields(v, AUDIT_FIELDS),
          at,
        });
      });
      return mustGet(id);
    },

    update: (input) => {
      const { id, ...v } = employeeUpdateSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const before = getEmployee(tx, id);
        if (!before) throw notFound("พนักงาน");
        assertCodeFree(tx, v.code, id);
        tx.update(employees)
          .set({ ...v, updatedAt: at })
          .where(eq(employees.id, id))
          .run();
        const changes = diffFields(before, v, AUDIT_FIELDS);
        if (changes.length) writeAudit(tx, actorOf(tx, session), { entityType: "employee", entityId: id, entityLabel: employeeFullName(v), action: "update", changes, at });
      });
      return mustGet(id);
    },

    remove: (input) => {
      const id = idSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const e = getEmployee(tx, id);
        if (!e) throw notFound("พนักงาน");
        tx.update(employees).set({ deletedAt: at, updatedAt: at, isActive: false }).where(eq(employees.id, id)).run();
        // The login account (if any) stays, but no longer points at a deleted employee.
        tx.update(users).set({ employeeId: null, updatedAt: at }).where(eq(users.employeeId, id)).run();
        writeAudit(tx, actorOf(tx, session), { entityType: "employee", entityId: id, entityLabel: e.fullName, action: "delete", at });
      });
    },
  };
}
