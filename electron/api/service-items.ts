import { and, asc, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  idSchema,
  serviceItemInputSchema,
  serviceItemListQuerySchema,
  serviceItemUpdateSchema,
  type Handlers,
  type ServiceItem,
  type ServiceItemsApi,
} from "@shared/contract";
import { diffFields, initialFields, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { AppError, notFound } from "./errors";
import { listPriceHistory, recordPriceChange } from "./price-history";
import { actorOf } from "./session";
import { likePattern, newId, now } from "./util";
import { serviceItems } from "../db/schema";
import type { DbLike } from "../db/client";

const AUDIT_FIELDS = ["name", "code", "defaultPrice", "unit", "isActive", "note"] as const;

function toServiceItem(r: typeof serviceItems.$inferSelect): ServiceItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    defaultPrice: r.defaultPrice,
    unit: r.unit,
    isActive: r.isActive,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function getServiceItem(db: DbLike, id: string, includeDeleted = false): ServiceItem | undefined {
  const r = db
    .select()
    .from(serviceItems)
    .where(includeDeleted ? eq(serviceItems.id, id) : and(eq(serviceItems.id, id), isNull(serviceItems.deletedAt)))
    .get();
  return r ? toServiceItem(r) : undefined;
}

function assertCodeFree(db: DbLike, code: string | null, exceptId?: string): void {
  if (!code) return;
  const conds: SQL[] = [isNull(serviceItems.deletedAt), sql`lower(${serviceItems.code}) = lower(${code})`];
  if (exceptId) conds.push(ne(serviceItems.id, exceptId));
  if (db.select({ id: serviceItems.id }).from(serviceItems).where(and(...conds)).get()) {
    throw new AppError("CONFLICT", "รหัสบริการนี้มีอยู่แล้ว", { field: "code" });
  }
}

export function createServiceItemsApi(ctx: ApiContext): Handlers<ServiceItemsApi> {
  const { db } = ctx;

  const mustGet = (id: string): ServiceItem => {
    const s = getServiceItem(db, id);
    if (!s) throw notFound("บริการ");
    return s;
  };

  return {
    list: (input) => {
      const q = serviceItemListQuerySchema.parse(input ?? {});
      const conds: SQL[] = [isNull(serviceItems.deletedAt)];
      if (!q.includeInactive) conds.push(eq(serviceItems.isActive, true));
      if (q.search) {
        for (const term of q.search.split(/\s+/).filter(Boolean)) {
          const p = likePattern(term);
          conds.push(
            sql`(${serviceItems.name} LIKE ${p} ESCAPE '\\' OR ${serviceItems.code} LIKE ${p} ESCAPE '\\' OR ${serviceItems.note} LIKE ${p} ESCAPE '\\')`,
          );
        }
      }
      const where = and(...conds);
      const items = db
        .select()
        .from(serviceItems)
        .where(where)
        .orderBy(asc(serviceItems.name), asc(serviceItems.id))
        .limit(q.limit)
        .offset(q.offset)
        .all()
        .map(toServiceItem);
      const total = db.select({ n: sql<number>`count(*)` }).from(serviceItems).where(where).get()?.n ?? 0;
      return { items, total };
    },

    get: (input) => mustGet(idSchema.parse(input)),

    create: (input) => {
      const v = serviceItemInputSchema.parse(input);
      const id = newId();
      const at = now();
      db.transaction((tx) => {
        const actor = actorOf(tx, ctx.session);
        assertCodeFree(tx, v.code);
        tx.insert(serviceItems)
          .values({
            id,
            code: v.code,
            name: v.name,
            defaultPrice: v.defaultPrice,
            unit: v.unit,
            isActive: v.isActive,
            note: v.note,
            createdAt: at,
            updatedAt: at,
          })
          .run();
        if (v.defaultPrice > 0) {
          recordPriceChange(tx, { itemType: "service", itemId: id, field: "sell", oldValue: null, newValue: v.defaultPrice, source: "create", actor, at });
        }
        writeAudit(tx, actor, { entityType: "service", entityId: id, entityLabel: v.name, action: "create", changes: initialFields(v, AUDIT_FIELDS), at });
      });
      return mustGet(id);
    },

    update: (input) => {
      const v = serviceItemUpdateSchema.parse(input);
      db.transaction((tx) => {
        const before = getServiceItem(tx, v.id);
        if (!before) throw notFound("บริการ");
        assertCodeFree(tx, v.code, v.id);
        const actor = actorOf(tx, ctx.session);
        const at = now();
        tx.update(serviceItems)
          .set({
            code: v.code,
            name: v.name,
            defaultPrice: v.defaultPrice,
            unit: v.unit,
            isActive: v.isActive,
            note: v.note,
            updatedAt: at,
          })
          .where(eq(serviceItems.id, v.id))
          .run();
        recordPriceChange(tx, { itemType: "service", itemId: v.id, field: "sell", oldValue: before.defaultPrice, newValue: v.defaultPrice, source: "manual", actor, at });
        const changes = diffFields(before, v, AUDIT_FIELDS);
        if (changes.length) writeAudit(tx, actor, { entityType: "service", entityId: v.id, entityLabel: v.name, action: "update", changes, at });
      });
      return mustGet(v.id);
    },

    remove: (input) => {
      const id = idSchema.parse(input);
      const s = mustGet(id);
      const at = now();
      db.transaction((tx) => {
        tx.update(serviceItems).set({ deletedAt: at, updatedAt: at }).where(eq(serviceItems.id, id)).run();
        writeAudit(tx, actorOf(tx, ctx.session), { entityType: "service", entityId: id, entityLabel: s.name, action: "delete", at });
      });
    },

    priceHistory: (input) => listPriceHistory(db, "service", input),
  };
}
