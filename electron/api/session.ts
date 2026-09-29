/**
 * Who is using the program. The session lives in the main process (the renderer cannot forge it): one logged-in
 * user per app instance, set by auth.login and cleared by auth.logout / restart.
 */
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { effectivePermissions, type Permission, type SessionUser, type UserRole } from "@shared/contract";
import type { DbLike } from "../db/client";
import { users } from "../db/schema";

export interface Session {
  userId: string | null;
}

export const newSession = (): Session => ({ userId: null });

// ------------------------------------------------------------------------------------------ passwords

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 };

/** "scrypt$N$r$p$<salt b64>$<hash b64>" */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize("NFC"), salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (!expected.length) return false;
  const actual = crypto.scryptSync(password.normalize("NFC"), salt, expected.length, { N, r, p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(actual, expected);
}

// ------------------------------------------------------------------------------------------ current user

type UserRow = typeof users.$inferSelect;

export function parsePermissions(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    role: row.role as UserRole,
    permissions: effectivePermissions(row.role, parsePermissions(row.permissions)),
    employeeId: row.employeeId,
    hasPassword: row.passwordHash !== null,
  };
}

/** Active, non-deleted user row by id. */
export function findActiveUser(db: DbLike, id: string): UserRow | undefined {
  return db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt), eq(users.isActive, true)))
    .get();
}

/**
 * The logged-in user, read fresh from the database on every call, so deactivating a user or changing their
 * permissions takes effect at once. A session pointing at a deleted / deactivated user is cleared.
 */
export function currentUser(db: DbLike, session: Session): SessionUser | null {
  if (!session.userId) return null;
  const row = findActiveUser(db, session.userId);
  if (!row) {
    session.userId = null;
    return null;
  }
  return toSessionUser(row);
}

export function hasPermission(user: SessionUser | null, permission: Permission): boolean {
  return !!user && (user.role === "owner" || user.permissions.includes(permission));
}

/** Who to stamp on a write: the logged-in user (id + current name), or nobody (system / time clock / tests). */
export interface Actor {
  id: string | null;
  name: string | null;
}

export function actorOf(db: DbLike, session: Session): Actor {
  const u = session.userId ? findActiveUser(db, session.userId) : undefined;
  return u ? { id: u.id, name: u.name } : { id: null, name: null };
}
