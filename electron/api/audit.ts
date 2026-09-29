/**
 * Change history (audit_logs). Every write path records one entry in the SAME database transaction as the change:
 * who (the session user, name snapshot), what (entity type / id / label snapshot), the action and the changed
 * fields. Entries are append-only.
 */
import { and, desc, eq, gte, lt, notInArray, sql, type SQL } from "drizzle-orm";
import {
  auditListQuerySchema,
  type AuditAction,
  type AuditApi,
  type AuditEntityType,
  type AuditEntry,
  type AuditFieldChange,
  type AuditItemChange,
  type AuditValue,
  type Handlers,
} from "@shared/contract";
import type { DbLike } from "../db/client";
import { auditLogs } from "../db/schema";
import type { ApiContext } from "./context";
import { currentUser, hasPermission, type Actor } from "./session";

/**
 * History of pay and staff data is private: without employees.manage the feed hides employee / payroll entries
 * (they contain salaries), and attendance / leave entries also need attendance.manage.
 */
export function hiddenAuditTypes(user: ReturnType<typeof currentUser>): AuditEntityType[] {
  if (!user) return [];
  const hidden: AuditEntityType[] = [];
  if (!hasPermission(user, "employees.manage")) {
    hidden.push("employee", "advance", "payroll", "payslip");
    if (!hasPermission(user, "attendance.manage")) hidden.push("attendance", "leave");
  }
  return hidden;
}
import { likePattern, newId, now } from "./util";

/** Longer strings are cut in history (e.g. a logo data URL). */
const MAX_VALUE_LENGTH = 300;

export function auditValue(v: unknown): AuditValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > MAX_VALUE_LENGTH ? `${v.slice(0, MAX_VALUE_LENGTH)}…` : v;
  if (Array.isArray(v)) return auditValue(v.map((x) => String(x)).join(", "));
  return auditValue(JSON.stringify(v));
}

const same = (a: AuditValue, b: AuditValue) => a === b || (a === null && b === "") || (a === "" && b === null);

const field = (o: object, f: string): unknown => (o as Record<string, unknown>)[f];

/** Changed fields between two flat snapshots (fields in the order given). */
export function diffFields(before: object, after: object, fields: readonly string[]): AuditFieldChange[] {
  const out: AuditFieldChange[] = [];
  for (const f of fields) {
    const from = auditValue(field(before, f));
    const to = auditValue(field(after, f));
    if (!same(from, to)) out.push({ field: f, from, to });
  }
  return out;
}

/** Key values of a new record (from = null), skipping empty ones. */
export function initialFields(after: object, fields: readonly string[]): AuditFieldChange[] {
  const out: AuditFieldChange[] = [];
  for (const f of fields) {
    const to = auditValue(field(after, f));
    if (to !== null && to !== "" && to !== false) out.push({ field: f, from: null, to });
  }
  return out;
}

export interface AuditRecord {
  entityType: AuditEntityType;
  entityId: string | null;
  entityLabel: string | null;
  action: AuditAction;
  changes?: AuditFieldChange[];
  items?: AuditItemChange[];
  note?: string | null;
  at?: number;
}

interface StoredChanges {
  fields?: AuditFieldChange[];
  items?: AuditItemChange[];
}

/** Writes one history entry by `who` (see actorOf). Call inside the write's db.transaction. */
export function writeAudit(db: DbLike, who: Actor, r: AuditRecord): void {
  const stored: StoredChanges = {};
  if (r.changes?.length) stored.fields = r.changes;
  if (r.items?.length) stored.items = r.items;
  db.insert(auditLogs)
    .values({
      id: newId(),
      at: r.at ?? now(),
      userId: who.id,
      userName: who.name,
      entityType: r.entityType,
      entityId: r.entityId,
      entityLabel: r.entityLabel,
      action: r.action,
      changes: stored.fields || stored.items ? JSON.stringify(stored) : null,
      note: r.note ?? null,
    })
    .run();
}

type AuditRow = typeof auditLogs.$inferSelect;

export function toAuditEntry(r: AuditRow): AuditEntry {
  let parsed: StoredChanges = {};
  if (r.changes) {
    try {
      parsed = JSON.parse(r.changes) as StoredChanges;
    } catch {
      parsed = {};
    }
  }
  return {
    id: r.id,
    at: r.at,
    userId: r.userId,
    userName: r.userName,
    entityType: r.entityType as AuditEntityType,
    entityId: r.entityId,
    entityLabel: r.entityLabel,
    action: r.action as AuditAction,
    changes: parsed.fields ?? [],
    items: parsed.items ?? [],
    note: r.note,
  };
}

export function createAuditApi(ctx: ApiContext): Handlers<AuditApi> {
  const { db } = ctx;
  return {
    list: (input) => {
      const q = auditListQuerySchema.parse(input ?? {});
      const conds: SQL[] = [];
      const hidden = hiddenAuditTypes(currentUser(db, ctx.session));
      if (hidden.length) conds.push(notInArray(auditLogs.entityType, hidden));
      if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
      if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
      if (q.userId) conds.push(eq(auditLogs.userId, q.userId));
      if (q.from !== undefined) conds.push(gte(auditLogs.at, q.from));
      if (q.to !== undefined) conds.push(lt(auditLogs.at, q.to));
      for (const term of (q.search ?? "").split(/\s+/).filter(Boolean)) {
        const p = likePattern(term);
        conds.push(
          sql`(${auditLogs.entityLabel} LIKE ${p} ESCAPE '\\' OR ${auditLogs.userName} LIKE ${p} ESCAPE '\\' OR ${auditLogs.note} LIKE ${p} ESCAPE '\\')`,
        );
      }
      const where = conds.length ? and(...conds) : undefined;
      const items = db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.at), desc(auditLogs.id))
        .limit(q.limit)
        .offset(q.offset)
        .all()
        .map(toAuditEntry);
      const total = db.select({ n: sql<number>`count(*)` }).from(auditLogs).where(where).get()?.n ?? 0;
      return { items, total };
    },
  };
}
