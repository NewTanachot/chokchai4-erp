/** users.* - program accounts (owner only; enforced in ./access.ts). */
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  PERMISSION_INFO,
  effectivePermissions,
  employeeDisplayName,
  idSchema,
  resetPasswordSchema,
  userCreateSchema,
  userUpdateSchema,
  type Handlers,
  type User,
  type UserRole,
  type UsersApi,
} from "@shared/contract";
import type { DbLike } from "../db/client";
import { employees, users } from "../db/schema";
import { diffFields, initialFields, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { AppError, notFound } from "./errors";
import { actorOf, hashPassword, parsePermissions } from "./session";
import { newId, now } from "./util";

type UserRow = typeof users.$inferSelect;

function toUsers(db: DbLike, rows: UserRow[]): User[] {
  const empIds = [...new Set(rows.map((r) => r.employeeId).filter((v): v is string => !!v))];
  const emps = new Map(
    empIds.length
      ? db
          .select({ id: employees.id, firstName: employees.firstName, nickname: employees.nickname })
          .from(employees)
          .where(inArray(employees.id, empIds))
          .all()
          .map((e) => [e.id, employeeDisplayName(e)])
      : [],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role as UserRole,
    permissions: effectivePermissions(r.role, parsePermissions(r.permissions)),
    employeeId: r.employeeId,
    employeeName: r.employeeId ? (emps.get(r.employeeId) ?? null) : null,
    isActive: r.isActive,
    hasPassword: r.passwordHash !== null,
    lastLoginAt: r.lastLoginAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

function getUser(db: DbLike, id: string): User | undefined {
  const row = db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).get();
  return row ? toUsers(db, [row])[0] : undefined;
}

function assertNameFree(db: DbLike, name: string, exceptId?: string): void {
  const conds: SQL[] = [isNull(users.deletedAt), sql`lower(trim(${users.name})) = lower(${name})`];
  if (exceptId) conds.push(ne(users.id, exceptId));
  if (db.select({ id: users.id }).from(users).where(and(...conds)).get()) {
    throw new AppError("CONFLICT", "มีผู้ใช้ชื่อนี้อยู่แล้ว", { field: "name" });
  }
}

function assertEmployeeFree(db: DbLike, employeeId: string | null, exceptId?: string): void {
  if (!employeeId) return;
  const e = db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, employeeId), isNull(employees.deletedAt))).get();
  if (!e) throw notFound("พนักงานที่เลือก");
  const conds: SQL[] = [isNull(users.deletedAt), eq(users.employeeId, employeeId)];
  if (exceptId) conds.push(ne(users.id, exceptId));
  if (db.select({ id: users.id }).from(users).where(and(...conds)).get()) {
    throw new AppError("CONFLICT", "พนักงานคนนี้มีบัญชีผู้ใช้อยู่แล้ว", { field: "employeeId" });
  }
}

/** Active owners other than `exceptId`. */
function otherActiveOwners(db: DbLike, exceptId: string): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.role, "owner"), eq(users.isActive, true), ne(users.id, exceptId)))
      .get()?.n ?? 0
  );
}

const LAST_OWNER = "ต้องมีบัญชีเจ้าของร้านที่ใช้งานได้อย่างน้อย 1 บัญชี";

/** History snapshot: permissions as labels, the linked employee as a name. */
const auditSnap = (u: User) => ({
  ...u,
  permissions: u.role === "owner" ? "ทุกสิทธิ์" : u.permissions.map((p) => PERMISSION_INFO[p].label),
  employee: u.employeeName,
});
const AUDIT_FIELDS = ["name", "role", "permissions", "employee", "isActive", "hasPassword"] as const;

export function createUsersApi(ctx: ApiContext): Handlers<UsersApi> {
  const { db, session } = ctx;

  const mustGet = (id: string): User => {
    const u = getUser(db, id);
    if (!u) throw notFound("ผู้ใช้");
    return u;
  };

  return {
    list: () =>
      toUsers(
        db,
        db
          .select()
          .from(users)
          .where(isNull(users.deletedAt))
          .orderBy(sql`CASE ${users.role} WHEN 'owner' THEN 0 ELSE 1 END`, asc(users.name))
          .all(),
      ),

    create: (input) => {
      const v = userCreateSchema.parse(input);
      const id = newId();
      const at = now();
      db.transaction((tx) => {
        assertNameFree(tx, v.name);
        assertEmployeeFree(tx, v.employeeId);
        tx.insert(users)
          .values({
            id,
            name: v.name,
            role: v.role,
            permissions: JSON.stringify(v.role === "owner" ? [] : v.permissions),
            passwordHash: v.password === null ? null : hashPassword(v.password),
            employeeId: v.employeeId,
            isActive: v.isActive,
            createdAt: at,
            updatedAt: at,
          })
          .run();
        const created = getUser(tx, id)!;
        writeAudit(tx, actorOf(tx, session), { entityType: "user", entityId: id, entityLabel: v.name, action: "create", changes: initialFields(auditSnap(created), AUDIT_FIELDS), at });
      });
      return mustGet(id);
    },

    update: (input) => {
      const v = userUpdateSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const before = getUser(tx, v.id);
        if (!before) throw notFound("ผู้ใช้");
        const self = v.id === session.userId;
        if (self && (!v.isActive || v.role !== before.role)) {
          throw new AppError("CONFLICT", "ไม่สามารถปิดใช้งานหรือเปลี่ยนระดับบัญชีของตัวเองได้");
        }
        const staysActiveOwner = v.role === "owner" && v.isActive;
        if (before.role === "owner" && before.isActive && !staysActiveOwner && otherActiveOwners(tx, v.id) === 0) {
          throw new AppError("CONFLICT", LAST_OWNER);
        }
        assertNameFree(tx, v.name, v.id);
        assertEmployeeFree(tx, v.employeeId, v.id);
        tx.update(users)
          .set({
            name: v.name,
            role: v.role,
            permissions: JSON.stringify(v.role === "owner" ? [] : v.permissions),
            employeeId: v.employeeId,
            isActive: v.isActive,
            updatedAt: at,
          })
          .where(eq(users.id, v.id))
          .run();
        const after = getUser(tx, v.id)!;
        const changes = diffFields(auditSnap(before), auditSnap(after), AUDIT_FIELDS);
        if (changes.length) writeAudit(tx, actorOf(tx, session), { entityType: "user", entityId: v.id, entityLabel: v.name, action: "update", changes, at });
      });
      return mustGet(v.id);
    },

    resetPassword: (input) => {
      const v = resetPasswordSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const u = getUser(tx, v.id);
        if (!u) throw notFound("ผู้ใช้");
        const passwordHash = v.password === null ? null : hashPassword(v.password);
        tx.update(users).set({ passwordHash, updatedAt: at }).where(eq(users.id, v.id)).run();
        writeAudit(tx, actorOf(tx, session), {
          entityType: "user",
          entityId: u.id,
          entityLabel: u.name,
          action: passwordHash === null ? "password_remove" : "password_reset",
          at,
        });
      });
    },

    remove: (input) => {
      const id = idSchema.parse(input);
      const at = now();
      db.transaction((tx) => {
        const u = getUser(tx, id);
        if (!u) throw notFound("ผู้ใช้");
        if (id === session.userId) throw new AppError("CONFLICT", "ไม่สามารถลบบัญชีของตัวเองได้");
        if (u.role === "owner" && u.isActive && otherActiveOwners(tx, id) === 0) throw new AppError("CONFLICT", LAST_OWNER);
        tx.update(users).set({ deletedAt: at, updatedAt: at, isActive: false }).where(eq(users.id, id)).run();
        writeAudit(tx, actorOf(tx, session), { entityType: "user", entityId: id, entityLabel: u.name, action: "delete", at });
      });
    },
  };
}
