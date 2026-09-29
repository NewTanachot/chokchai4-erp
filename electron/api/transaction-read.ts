/**
 * Shared read-model for transactions: turns ids into TransactionDetail / TransactionSummary.
 * Used by transactions, customers (history) and reports (recent). Queries decide WHICH ids
 * (filters, order, paging); these loaders build the objects and preserve the given id order.
 */
import { asc, inArray } from "drizzle-orm";
import { mulQty } from "@shared/calc";
import type { TransactionDetail, TransactionItem, TransactionSummary, UserRef } from "@shared/contract";
import type { DbLike as Db } from "../db/client";
import { customers, transactionItems, transactions, users } from "../db/schema";

type TxRow = typeof transactions.$inferSelect;
type ItemRow = typeof transactionItems.$inferSelect;
type CustomerRow = typeof customers.$inferSelect;

const CHUNK = 500;

function chunked<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

/** id -> current name of users (deleted ones included, so old records still say who). */
export function loadUserNames(db: Db, ids: Iterable<string | null | undefined>): Map<string, string> {
  const unique = [...new Set([...ids].filter((v): v is string => !!v))];
  const out = new Map<string, string>();
  for (const part of chunked(unique)) {
    for (const u of db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, part)).all()) out.set(u.id, u.name);
  }
  return out;
}

function userRef(names: Map<string, string>, id: string | null): UserRef | null {
  if (!id) return null;
  const name = names.get(id);
  return name === undefined ? null : { id, name };
}

function loadRows(db: Db, ids: string[]) {
  const txs = new Map<string, TxRow>();
  const items = new Map<string, ItemRow[]>();
  const custs = new Map<string, CustomerRow>();
  for (const part of chunked(ids)) {
    for (const t of db.select().from(transactions).where(inArray(transactions.id, part)).all()) txs.set(t.id, t);
    const rows = db
      .select()
      .from(transactionItems)
      .where(inArray(transactionItems.transactionId, part))
      .orderBy(asc(transactionItems.transactionId), asc(transactionItems.lineNo))
      .all();
    for (const it of rows) {
      const list = items.get(it.transactionId) ?? [];
      list.push(it);
      items.set(it.transactionId, list);
    }
  }
  const customerIds = [...new Set([...txs.values()].map((t) => t.customerId).filter((v): v is string => !!v))];
  for (const part of chunked(customerIds)) {
    // Include soft-deleted customers so old bills still show who they were for.
    for (const c of db.select().from(customers).where(inArray(customers.id, part)).all()) custs.set(c.id, c);
  }
  const userNames = loadUserNames(
    db,
    [...txs.values()].flatMap((t) => [t.createdBy, t.updatedBy, t.voidedBy]),
  );
  return { txs, items, custs, userNames };
}

function toItem(r: ItemRow): TransactionItem {
  return {
    id: r.id,
    lineNo: r.lineNo,
    itemType: r.itemType,
    productId: r.productId,
    serviceItemId: r.serviceItemId,
    name: r.name,
    unit: r.unit,
    qty: r.qty,
    unitPrice: r.unitPrice,
    discount: r.discount,
    total: r.total,
    unitCost: r.unitCost,
    note: r.note,
  };
}

function toDetail(t: TxRow, itemRows: ItemRow[], c: CustomerRow | undefined, userNames: Map<string, string>): TransactionDetail {
  const items = itemRows.map(toItem);
  return {
    id: t.id,
    type: t.type,
    docNo: t.docNo,
    status: t.status,
    occurredAt: t.occurredAt,
    customerId: t.customerId,
    customer: c
      ? {
          id: c.id,
          name: c.name,
          phone: c.phone,
          shopName: c.shopName,
          taxId: c.taxId,
          address: c.address,
          lineId: c.lineId,
          email: c.email,
        }
      : null,
    contactName: t.contactName,
    contactPhone: t.contactPhone,
    vehiclePlate: t.vehiclePlate,
    vehicleModel: t.vehicleModel,
    mileage: t.mileage,
    items,
    subtotal: t.subtotal,
    discount: t.discount,
    vatMode: t.vatMode,
    vatRate: t.vatRate,
    vatAmount: t.vatAmount,
    total: t.total,
    costTotal: t.type === "sale" ? items.reduce((s, i) => s + mulQty(i.qty, i.unitCost), 0) : 0,
    paymentMethod: t.paymentMethod,
    paymentStatus: t.paymentStatus,
    paidAt: t.paidAt,
    note: t.note,
    voidedAt: t.voidedAt,
    voidReason: t.voidReason,
    createdBy: userRef(userNames, t.createdBy),
    updatedBy: userRef(userNames, t.updatedBy),
    voidedBy: userRef(userNames, t.voidedBy),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** Full details (with items + customer) for the given ids, in the same order. Missing ids are skipped. */
export function loadTransactionDetails(db: Db, ids: string[]): TransactionDetail[] {
  if (ids.length === 0) return [];
  const { txs, items, custs, userNames } = loadRows(db, ids);
  return ids.flatMap((id) => {
    const t = txs.get(id);
    return t ? [toDetail(t, items.get(id) ?? [], t.customerId ? custs.get(t.customerId) : undefined, userNames)] : [];
  });
}

export function itemsPreview(names: { name: string; qty: number }[], max = 3): string {
  const parts = names.slice(0, max).map((n) => (n.qty !== 1 ? `${n.name} ×${n.qty}` : n.name));
  const more = names.length - max;
  return parts.join(", ") + (more > 0 ? ` และอีก ${more} รายการ` : "");
}

/** List rows for the given ids, in the same order. */
export function loadTransactionSummaries(db: Db, ids: string[]): TransactionSummary[] {
  if (ids.length === 0) return [];
  const { txs, items, custs, userNames } = loadRows(db, ids);
  return ids.flatMap((id): TransactionSummary[] => {
    const t = txs.get(id);
    if (!t) return [];
    const its = items.get(id) ?? [];
    const c = t.customerId ? custs.get(t.customerId) : undefined;
    return [
      {
        id: t.id,
        type: t.type,
        docNo: t.docNo,
        status: t.status,
        occurredAt: t.occurredAt,
        customerId: t.customerId,
        displayName: c?.name ?? t.contactName ?? null,
        vehiclePlate: t.vehiclePlate,
        itemCount: its.length,
        itemsPreview: itemsPreview(its),
        total: t.total,
        paymentMethod: t.paymentMethod,
        paymentStatus: t.paymentStatus,
        createdByName: t.createdBy ? (userNames.get(t.createdBy) ?? null) : null,
      },
    ];
  });
}
