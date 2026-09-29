/** Price history of products and services (price_changes): written wherever a price changes, read per item. */
import { and, desc, eq, sql } from "drizzle-orm";
import { priceHistoryQuerySchema, type Paged, type PriceChange, type PriceField, type PriceSource } from "@shared/contract";
import type { DbLike } from "../db/client";
import { priceChanges, transactions } from "../db/schema";
import type { Actor } from "./session";
import { newId } from "./util";

export interface PriceChangeRecord {
  itemType: "product" | "service";
  itemId: string;
  field: PriceField;
  oldValue: number | null;
  newValue: number;
  source: PriceSource;
  transactionId?: string | null;
  note?: string | null;
  actor: Actor;
  at: number;
}

/** Records a price change; no-op when the value did not change. Call inside the write's transaction. */
export function recordPriceChange(db: DbLike, r: PriceChangeRecord): void {
  if (r.oldValue === r.newValue) return;
  db.insert(priceChanges)
    .values({
      id: newId(),
      itemType: r.itemType,
      itemId: r.itemId,
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      source: r.source,
      transactionId: r.transactionId ?? null,
      userId: r.actor.id,
      userName: r.actor.name,
      at: r.at,
      note: r.note ?? null,
    })
    .run();
}

export function listPriceHistory(db: DbLike, itemType: "product" | "service", input: unknown): Paged<PriceChange> {
  const q = priceHistoryQuerySchema.parse(input);
  const where = and(eq(priceChanges.itemType, itemType), eq(priceChanges.itemId, q.id));
  const rows = db
    .select({ c: priceChanges, docNo: transactions.docNo })
    .from(priceChanges)
    .leftJoin(transactions, eq(transactions.id, priceChanges.transactionId))
    .where(where)
    .orderBy(desc(priceChanges.at), desc(priceChanges.id))
    .limit(q.limit)
    .offset(q.offset)
    .all();
  const total = db.select({ n: sql<number>`count(*)` }).from(priceChanges).where(where).get()?.n ?? 0;
  return {
    total,
    items: rows.map(({ c, docNo }) => ({
      id: c.id,
      itemType: c.itemType,
      itemId: c.itemId,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      source: c.source,
      transactionId: c.transactionId,
      docNo: docNo ?? null,
      userId: c.userId,
      userName: c.userName,
      at: c.at,
      note: c.note,
    })),
  };
}
