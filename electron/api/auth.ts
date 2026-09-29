/**
 * auth.* - logging in and out, the first-run owner account, changing a password and the owner's recovery code.
 * Wrong passwords are throttled per user (and for the recovery code) so a 4-digit PIN cannot be guessed quickly.
 */
import crypto from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  changePasswordSchema,
  loginSchema,
  recoverSchema,
  setupOwnerSchema,
  type AuthApi,
  type Handlers,
  type LoginTile,
  type UserRole,
} from "@shared/contract";
import type { DbLike } from "../db/client";
import { settings, users } from "../db/schema";
import { writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { AppError } from "./errors";
import { currentUser, findActiveUser, hashPassword, toSessionUser, verifyPassword, type Actor } from "./session";
import { readSettings } from "./settings";
import { newId, now } from "./util";

const RECOVERY_META_KEY = "meta:recoveryCodeHash";
/** No 0/O, 1/I/L: easy to read back from paper. */
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** "K7QX-9M2P-4TZB" */
export function generateRecoveryCode(): string {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join("")).join("-");
}

export const normalizeRecoveryCode = (code: string): string => code.toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Stores a new recovery code (hashed) and returns it. Run inside the write transaction. */
function setRecoveryCode(db: DbLike, at: number): string {
  const code = generateRecoveryCode();
  const value = JSON.stringify(hashPassword(normalizeRecoveryCode(code)));
  db.insert(settings)
    .values({ key: RECOVERY_META_KEY, value, updatedAt: at })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: at } })
    .run();
  return code;
}

function recoveryCodeMatches(db: DbLike, code: string): boolean {
  const row = db.select().from(settings).where(eq(settings.key, RECOVERY_META_KEY)).get();
  if (!row) return false;
  const hash = JSON.parse(row.value) as unknown;
  return typeof hash === "string" && verifyPassword(normalizeRecoveryCode(code), hash);
}

/** Wrong-password throttle: after every 5 failures the key waits 30 s, doubling up to 5 minutes. */
export class Throttle {
  private entries = new Map<string, { fails: number; until: number }>();

  check(key: string, at = now()): void {
    const e = this.entries.get(key);
    if (e && e.until > at) {
      const seconds = Math.ceil((e.until - at) / 1000);
      throw new AppError("VALIDATION", `ใส่รหัสผิดหลายครั้ง กรุณารอ ${seconds} วินาทีแล้วลองใหม่`, { retryAfterMs: e.until - at });
    }
  }

  fail(key: string, at = now()): void {
    const e = this.entries.get(key) ?? { fails: 0, until: 0 };
    e.fails++;
    if (e.fails % 5 === 0) e.until = at + Math.min(30_000 * 2 ** (e.fails / 5 - 1), 300_000);
    this.entries.set(key, e);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

const ROLE_ORDER = sql`CASE ${users.role} WHEN 'owner' THEN 0 ELSE 1 END`;

export function loginTiles(db: DbLike): LoginTile[] {
  return db
    .select({ id: users.id, name: users.name, role: users.role, passwordHash: users.passwordHash })
    .from(users)
    .where(and(isNull(users.deletedAt), eq(users.isActive, true)))
    .orderBy(ROLE_ORDER, asc(users.name))
    .all()
    .map((u) => ({ id: u.id, name: u.name, role: u.role as UserRole, hasPassword: u.passwordHash !== null }));
}

const userCount = (db: DbLike): number => db.select({ n: sql<number>`count(*)` }).from(users).where(isNull(users.deletedAt)).get()?.n ?? 0;

export function createAuthApi(ctx: ApiContext): Handlers<AuthApi> {
  const { db, session } = ctx;
  const throttle = new Throttle();
  const asActor = (u: { id: string; name: string }): Actor => ({ id: u.id, name: u.name });

  return {
    status: () => {
      const needsSetup = userCount(db) === 0;
      return {
        needsSetup,
        user: currentUser(db, session),
        users: needsSetup ? [] : loginTiles(db),
        shopName: readSettings(db).shop.name,
      };
    },

    setupOwner: (input) => {
      const v = setupOwnerSchema.parse(input);
      const at = now();
      const id = newId();
      const recoveryCode = db.transaction((tx) => {
        if (userCount(tx) > 0) throw new AppError("CONFLICT", "ตั้งค่าบัญชีเจ้าของร้านไปแล้ว กรุณาเข้าสู่ระบบ");
        const passwordHash = v.password === null ? null : hashPassword(v.password);
        tx.insert(users).values({ id, name: v.name, role: "owner", permissions: "[]", passwordHash, lastLoginAt: at, createdAt: at, updatedAt: at }).run();
        const changes = [
          { field: "role", from: null, to: "owner" },
          { field: "hasPassword", from: null, to: passwordHash !== null },
        ];
        writeAudit(tx, { id, name: v.name }, { entityType: "user", entityId: id, entityLabel: v.name, action: "create", changes, at });
        // Without a password there is nothing to recover (a code can be issued later in settings).
        return passwordHash === null ? null : setRecoveryCode(tx, at);
      });
      session.userId = id;
      return { user: toSessionUser(findActiveUser(db, id)!), recoveryCode };
    },

    login: (input) => {
      const v = loginSchema.parse(input);
      throttle.check(v.userId);
      const u = findActiveUser(db, v.userId);
      if (!u) throw new AppError("VALIDATION", "ไม่พบผู้ใช้นี้ หรือบัญชีถูกปิดใช้งาน");
      const at = now();
      if (u.passwordHash !== null && !v.password) throw new AppError("VALIDATION", "กรุณากรอกรหัสผ่าน", { field: "password" });
      if (u.passwordHash !== null && !verifyPassword(v.password, u.passwordHash)) {
        throttle.fail(v.userId);
        writeAudit(db, { id: null, name: null }, { entityType: "user", entityId: u.id, entityLabel: u.name, action: "login_failed", at });
        throw new AppError("VALIDATION", "รหัสผ่านไม่ถูกต้อง", { field: "password" });
      }
      throttle.reset(v.userId);
      db.transaction((tx) => {
        tx.update(users).set({ lastLoginAt: at }).where(eq(users.id, u.id)).run();
        writeAudit(tx, asActor(u), { entityType: "user", entityId: u.id, entityLabel: u.name, action: "login", at });
      });
      session.userId = u.id;
      return toSessionUser(u);
    },

    logout: () => {
      const u = session.userId ? findActiveUser(db, session.userId) : undefined;
      if (u) writeAudit(db, asActor(u), { entityType: "user", entityId: u.id, entityLabel: u.name, action: "logout" });
      session.userId = null;
    },

    changePassword: (input) => {
      const v = changePasswordSchema.parse(input);
      const me = session.userId ? findActiveUser(db, session.userId) : undefined;
      if (!me) throw new AppError("UNAUTHORIZED", "กรุณาเข้าสู่ระบบ");
      throttle.check(me.id);
      // Someone without a password is setting one: nothing to check.
      if (me.passwordHash !== null && !verifyPassword(v.currentPassword, me.passwordHash)) {
        throttle.fail(me.id);
        throw new AppError("VALIDATION", "รหัสผ่านเดิมไม่ถูกต้อง", { field: "currentPassword" });
      }
      throttle.reset(me.id);
      const at = now();
      db.transaction((tx) => {
        tx.update(users).set({ passwordHash: hashPassword(v.newPassword), updatedAt: at }).where(eq(users.id, me.id)).run();
        writeAudit(tx, asActor(me), { entityType: "user", entityId: me.id, entityLabel: me.name, action: "password_change", at });
      });
    },

    recover: (input) => {
      const v = recoverSchema.parse(input);
      throttle.check("recover");
      const u = findActiveUser(db, v.userId);
      if (!u || u.role !== "owner") throw new AppError("VALIDATION", "กู้คืนรหัสผ่านได้เฉพาะบัญชีเจ้าของร้าน");
      if (!recoveryCodeMatches(db, v.recoveryCode)) {
        throttle.fail("recover");
        throw new AppError("VALIDATION", "รหัสกู้คืนไม่ถูกต้อง", { field: "recoveryCode" });
      }
      throttle.reset("recover");
      throttle.reset(u.id);
      const at = now();
      const recoveryCode = db.transaction((tx) => {
        tx.update(users).set({ passwordHash: hashPassword(v.newPassword), lastLoginAt: at, updatedAt: at }).where(eq(users.id, u.id)).run();
        writeAudit(tx, asActor(u), { entityType: "user", entityId: u.id, entityLabel: u.name, action: "recover", at });
        return setRecoveryCode(tx, at);
      });
      session.userId = u.id;
      return { user: toSessionUser(findActiveUser(db, u.id)!), recoveryCode };
    },

    newRecoveryCode: () => {
      const me = session.userId ? findActiveUser(db, session.userId) : undefined;
      if (!me || me.role !== "owner") throw new AppError("FORBIDDEN", "เฉพาะเจ้าของร้านเท่านั้น");
      const at = now();
      const recoveryCode = db.transaction((tx) => setRecoveryCode(tx, at));
      return { recoveryCode };
    },
  };
}
