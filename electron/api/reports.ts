/**
 * Reports & dashboard aggregates. Everything is computed with SQL aggregates over
 * non-deleted transactions; only status "completed" counts toward money totals
 * (voidCount and recent() are the exceptions).
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  dailyQuerySchema,
  lowStockQuerySchema,
  recentQuerySchema,
  summaryQuerySchema,
  topItemsQuerySchema,
  type DailyRow,
  type Handlers,
  type PaymentMethod,
  type PaymentMethodTotal,
  type Product,
  type ReportsApi,
  type Summary,
  type TopItemRow,
  type TypeTotals,
} from "@shared/contract";
import { roundQty } from "@shared/money";
import type { ApiContext } from "./context";
import { AppError } from "./errors";
import { loadTransactionSummaries } from "./transaction-read";
import { categories, products } from "../db/schema";

/** Longest range daily() will expand (≈ 10 years) - protects against accidental from=0 calls. */
const MAX_DAILY_DAYS = 3700;

type TxType = "sale" | "purchase";
type ItemType = "product" | "service" | "custom";

const productColumns = {
  id: products.id,
  sku: products.sku,
  barcode: products.barcode,
  name: products.name,
  categoryId: products.categoryId,
  categoryName: categories.name,
  brand: products.brand,
  model: products.model,
  spec: products.spec,
  unit: products.unit,
  costPrice: products.costPrice,
  sellPrice: products.sellPrice,
  stockQty: products.stockQty,
  minStock: products.minStock,
  trackStock: products.trackStock,
  isActive: products.isActive,
  note: products.note,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
};

const emptyTotals = (): TypeTotals => ({ count: 0, total: 0, vatAmount: 0, unpaidTotal: 0, unpaidCount: 0 });

/** Local calendar date "YYYY-MM-DD" (same as SQLite date(x, 'unixepoch', 'localtime')). */
export function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local days touched by [from, to), in order. */
export function localDaysInRange(from: number, to: number): string[] {
  if (!(to > from)) return [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const out: string[] = [];
  while (d.getTime() < to) {
    out.push(localDateKey(d));
    if (out.length > MAX_DAILY_DAYS) throw new AppError("VALIDATION", "ช่วงวันที่ยาวเกินไป (ไม่เกิน 10 ปี)");
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Turns a map of statement factories into a map of statements prepared on first access. */
function lazyStatements<T extends Record<string, () => unknown>>(factories: T): { [K in keyof T]: ReturnType<T[K]> } {
  const cache = new Map<keyof T, unknown>();
  return new Proxy({} as { [K in keyof T]: ReturnType<T[K]> }, {
    get(_t, key: string) {
      if (!cache.has(key)) cache.set(key, factories[key]());
      return cache.get(key);
    },
  });
}

export function createReportsApi(ctx: ApiContext): Handlers<ReportsApi> {
  const { db, sqlite } = ctx;

  // Prepared lazily (first use) and cached. Raw SQL keeps the aggregates explicit and table-qualified.
  const stmt = lazyStatements({
    typeTotals: () => sqlite.prepare<[number, number], { type: TxType; count: number; total: number; vat: number; unpaidTotal: number; unpaidCount: number }>(`
      SELECT t.type AS type,
             COUNT(*) AS count,
             COALESCE(SUM(t.total), 0) AS total,
             COALESCE(SUM(t.vat_amount), 0) AS vat,
             COALESCE(SUM(CASE WHEN t.payment_status = 'unpaid' THEN t.total ELSE 0 END), 0) AS unpaidTotal,
             COALESCE(SUM(CASE WHEN t.payment_status = 'unpaid' THEN 1 ELSE 0 END), 0) AS unpaidCount
      FROM transactions t
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY t.type`),
    saleCost: () => sqlite.prepare<[number, number], { cost: number }>(`
      -- qty × unit_cost rounded half up per line, in integers (same as shared/calc.ts mulQty).
      SELECT COALESCE(SUM((CAST(ROUND(i.qty * 100) AS INTEGER) * i.unit_cost + 50) / 100), 0) AS cost
      FROM transaction_items i
      JOIN transactions t ON t.id = i.transaction_id
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.type = 'sale'
        AND i.item_type = 'product'
        AND t.occurred_at >= ? AND t.occurred_at < ?`),
    byPaymentMethod: () => sqlite.prepare<[TxType, number, number], { method: PaymentMethod; count: number; total: number }>(`
      SELECT t.payment_method AS method, COUNT(*) AS count, COALESCE(SUM(t.total), 0) AS total
      FROM transactions t
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.type = ?
        AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY t.payment_method
      ORDER BY total DESC, count DESC, method ASC`),
    // Cash flow: bills paid in the range (paid_at), whatever their bill date.
    paidByPaymentMethod: () => sqlite.prepare<[TxType, number, number], { method: PaymentMethod; count: number; total: number }>(`
      SELECT t.payment_method AS method, COUNT(*) AS count, COALESCE(SUM(t.total), 0) AS total
      FROM transactions t
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.type = ? AND t.payment_status = 'paid'
        AND t.paid_at >= ? AND t.paid_at < ?
      GROUP BY t.payment_method
      ORDER BY total DESC, count DESC, method ASC`),
    collectedEarlier: () => sqlite.prepare<[number, number, number], { count: number; total: number }>(`
      SELECT COUNT(*) AS count, COALESCE(SUM(t.total), 0) AS total
      FROM transactions t
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.type = 'sale' AND t.payment_status = 'paid'
        AND t.paid_at >= ? AND t.paid_at < ? AND t.occurred_at < ?`),
    byItemType: () => sqlite.prepare<[number, number], { itemType: ItemType; total: number }>(`
      SELECT i.item_type AS itemType, COALESCE(SUM(i.total), 0) AS total
      FROM transaction_items i
      JOIN transactions t ON t.id = i.transaction_id
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.type = 'sale'
        AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY i.item_type
      ORDER BY total DESC, itemType ASC`),
    voidCount: () => sqlite.prepare<[number, number], { n: number }>(`
      SELECT COUNT(*) AS n FROM transactions t
      WHERE t.deleted_at IS NULL AND t.status = 'void' AND t.occurred_at >= ? AND t.occurred_at < ?`),
    daily: () => sqlite.prepare<[number, number], { day: string; type: TxType; count: number; total: number }>(`
      SELECT date(t.occurred_at / 1000, 'unixepoch', 'localtime') AS day, t.type AS type,
             COUNT(*) AS count, COALESCE(SUM(t.total), 0) AS total
      FROM transactions t
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY day, t.type`),
    // Bare columns (name, unit) next to MAX() come from the row holding the max (documented SQLite
    // behaviour) - i.e. the name printed on the most recent bill.
    topItems: () => sqlite.prepare<
      { type: TxType; from: number; to: number; itemType: ItemType | null; limit: number },
      { itemType: ItemType; refId: string | null; name: string; unit: string | null; qty: number; total: number; billCount: number; lastAt: number }
    >(`
      SELECT i.item_type AS itemType,
             CASE i.item_type WHEN 'product' THEN i.product_id WHEN 'service' THEN i.service_item_id ELSE NULL END AS refId,
             i.name AS name,
             i.unit AS unit,
             MAX(t.occurred_at * 1000 + i.line_no) AS lastAt,
             SUM(i.qty) AS qty,
             COALESCE(SUM(i.total), 0) AS total,
             COUNT(DISTINCT t.id) AS billCount
      FROM transaction_items i
      JOIN transactions t ON t.id = i.transaction_id
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.type = @type
        AND t.occurred_at >= @from AND t.occurred_at < @to
        AND (@itemType IS NULL OR i.item_type = @itemType)
      GROUP BY i.item_type,
               -- Catalog lines group by id (renamed items stay one row); custom lines - or catalog lines that
               -- somehow lost their id - group by the trimmed, case-folded name.
               CASE
                 WHEN i.item_type = 'product' AND i.product_id IS NOT NULL THEN 'p:' || i.product_id
                 WHEN i.item_type = 'service' AND i.service_item_id IS NOT NULL THEN 's:' || i.service_item_id
                 ELSE 'n:' || lower(trim(i.name))
               END
      ORDER BY total DESC, qty DESC, name ASC
      LIMIT @limit`),
    salesByUser: () => sqlite.prepare<[number, number], { userId: string | null; name: string | null; count: number; total: number }>(`
      SELECT t.created_by AS userId, u.name AS name, COUNT(*) AS count, COALESCE(SUM(t.total), 0) AS total
      FROM transactions t
      LEFT JOIN users u ON u.id = t.created_by
      WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.type = 'sale'
        AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY t.created_by
      ORDER BY total DESC, count DESC, name ASC`),
    recent: () => sqlite.prepare<{ from: number | null; to: number | null; limit: number }, { id: string }>(`
      SELECT t.id AS id FROM transactions t
      WHERE t.deleted_at IS NULL
        AND (@from IS NULL OR t.occurred_at >= @from)
        AND (@to IS NULL OR t.occurred_at < @to)
      ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
      LIMIT @limit`),
  });

  return {
    summary: (input) => {
      const range = summaryQuerySchema.parse(input);
      const { from, to } = range;
      const sales = emptyTotals();
      const purchases = emptyTotals();
      for (const r of stmt.typeTotals.all(from, to)) {
        const target = r.type === "sale" ? sales : purchases;
        target.count = r.count;
        target.total = r.total;
        target.vatAmount = r.vat;
        target.unpaidTotal = r.unpaidTotal;
        target.unpaidCount = r.unpaidCount;
      }
      const cost = Math.round(stmt.saleCost.get(from, to)?.cost ?? 0);
      const methods = (type: TxType): PaymentMethodTotal[] =>
        stmt.byPaymentMethod.all(type, from, to).map((r) => ({ method: r.method, count: r.count, total: r.total }));
      const paid = (type: TxType): PaymentMethodTotal[] =>
        stmt.paidByPaymentMethod.all(type, from, to).map((r) => ({ method: r.method, count: r.count, total: r.total }));
      const earlier = stmt.collectedEarlier.get(from, to, from);
      const result: Summary = {
        range: { from, to },
        sales,
        purchases,
        net: sales.total - purchases.total,
        grossProfit: sales.total - sales.vatAmount - cost,
        salesByPaymentMethod: methods("sale"),
        purchasesByPaymentMethod: methods("purchase"),
        salesReceivedByPaymentMethod: paid("sale"),
        purchasesPaidByPaymentMethod: paid("purchase"),
        salesCollectedEarlier: { count: earlier?.count ?? 0, total: earlier?.total ?? 0 },
        salesByItemType: stmt.byItemType.all(from, to).map((r) => ({ itemType: r.itemType, total: r.total })),
        voidCount: stmt.voidCount.get(from, to)?.n ?? 0,
        salesByUser: stmt.salesByUser.all(from, to).map((r) => ({ userId: r.userId, name: r.name, count: r.count, total: r.total })),
      };
      return result;
    },

    daily: (input) => {
      const { from, to } = dailyQuerySchema.parse(input);
      const days = localDaysInRange(from, to);
      const rows = new Map<string, DailyRow>(
        days.map((date) => [date, { date, salesTotal: 0, salesCount: 0, purchasesTotal: 0, purchasesCount: 0, net: 0 }]),
      );
      if (days.length === 0) return [];
      for (const r of stmt.daily.all(from, to)) {
        const row = rows.get(r.day);
        if (!row) continue;
        if (r.type === "sale") {
          row.salesTotal = r.total;
          row.salesCount = r.count;
        } else {
          row.purchasesTotal = r.total;
          row.purchasesCount = r.count;
        }
      }
      return days.map((d) => {
        const row = rows.get(d)!;
        row.net = row.salesTotal - row.purchasesTotal;
        return row;
      });
    },

    topItems: (input) => {
      const q = topItemsQuerySchema.parse(input);
      return stmt.topItems
        .all({ type: q.type, from: q.from, to: q.to, itemType: q.itemType ?? null, limit: q.limit })
        .map(
          (r): TopItemRow => ({
            itemType: r.itemType,
            refId: r.refId,
            name: r.name.trim(),
            unit: r.unit,
            qty: roundQty(r.qty),
            total: r.total,
            billCount: r.billCount,
          }),
        );
    },

    lowStock: (input) => {
      const q = lowStockQuerySchema.parse(input ?? {});
      const items: Product[] = db
        .select(productColumns)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            isNull(products.deletedAt),
            eq(products.isActive, true),
            eq(products.trackStock, true),
            sql`${products.stockQty} <= ${products.minStock}`,
          ),
        )
        .orderBy(
          // Out of stock first, then the smallest share of the alert level left, then the biggest shortfall.
          sql`CASE WHEN ${products.stockQty} <= 0 THEN 0 ELSE 1 END`,
          sql`CASE WHEN ${products.minStock} > 0 THEN ${products.stockQty} / ${products.minStock} ELSE 0 END`,
          sql`${products.stockQty} - ${products.minStock}`,
          asc(products.name),
        )
        .limit(q.limit)
        .all();
      return items;
    },

    recent: (input) => {
      const q = recentQuerySchema.parse(input ?? {});
      const ids = stmt.recent.all({ from: q.from ?? null, to: q.to ?? null, limit: q.limit }).map((r) => r.id);
      return loadTransactionSummaries(db, ids);
    },
  };
}
