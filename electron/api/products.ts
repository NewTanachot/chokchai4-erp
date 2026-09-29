import { and, asc, desc, eq, isNull, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  NO_CATEGORY,
  idSchema,
  movementsQuerySchema,
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
  stockAdjustSchema,
  type Handlers,
  type Product,
  type ProductStats,
  type ProductsApi,
  type StockMovement,
  type StockMovementType,
} from "@shared/contract";
import { roundQty } from "@shared/money";
import { diffFields, initialFields, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { AppError, notFound } from "./errors";
import { listPriceHistory, recordPriceChange } from "./price-history";
import { actorOf } from "./session";
import { recomputeStock } from "./stock";
import { likePattern, newId, now } from "./util";
import { categories, products, stockMovements } from "../db/schema";
import type { DbLike } from "../db/client";

/** Product fields compared for the history, in display order ("category" = category name). */
const AUDIT_FIELDS = [
  "name",
  "sku",
  "barcode",
  "category",
  "brand",
  "model",
  "spec",
  "unit",
  "costPrice",
  "sellPrice",
  "minStock",
  "trackStock",
  "isActive",
  "note",
] as const;

const auditSnap = (p: Product) => ({ ...p, category: p.categoryName });
const productLabel = (p: { name: string; spec: string | null }) => (p.spec ? `${p.name} ${p.spec}` : p.name);

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

/** Product by id (including soft-deleted ones when `includeDeleted`). */
export function getProduct(db: DbLike, id: string, includeDeleted = false): Product | undefined {
  return db
    .select(productColumns)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(includeDeleted ? eq(products.id, id) : and(eq(products.id, id), isNull(products.deletedAt)))
    .get();
}

/** Characters ignored when matching tyre sizes in compact form ("205/55R16" ~ "2055516" ~ "205-55-16"). */
const COMPACT_STRIP = ["/", " ", "-", ".", "R", "Z"];

function compactTerm(term: string): string {
  let s = term.toUpperCase();
  for (const c of COMPACT_STRIP) s = s.split(c).join("");
  return s;
}

function compactColumn(col: SQLWrapper): SQL {
  let expr: SQL = sql`UPPER(COALESCE(${col}, ''))`;
  for (const c of COMPACT_STRIP) expr = sql`REPLACE(${expr}, ${c}, '')`;
  return expr;
}

/**
 * One search word: must match any of the text columns, the category name (so "แบต 55" works), or the
 * compact tyre-size form of spec / sku.
 */
function searchCondition(term: string): SQL {
  const p = likePattern(term);
  const parts: SQL[] = [
    sql`${products.name} LIKE ${p} ESCAPE '\\'`,
    sql`${products.sku} LIKE ${p} ESCAPE '\\'`,
    sql`${products.barcode} LIKE ${p} ESCAPE '\\'`,
    sql`${products.brand} LIKE ${p} ESCAPE '\\'`,
    sql`${products.model} LIKE ${p} ESCAPE '\\'`,
    sql`${products.spec} LIKE ${p} ESCAPE '\\'`,
    // Correlated subquery: explicit table-qualified outer column (see CLAUDE.md), aliased inner table.
    sql`EXISTS (SELECT 1 FROM categories cs WHERE cs.id = products.category_id AND cs.name LIKE ${p} ESCAPE '\\')`,
  ];
  const compact = compactTerm(term);
  if (/\d/.test(term) && compact.length >= 3) {
    const cp = likePattern(compact);
    parts.push(sql`${compactColumn(products.spec)} LIKE ${cp} ESCAPE '\\'`);
    parts.push(sql`${compactColumn(products.sku)} LIKE ${cp} ESCAPE '\\'`);
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
}

function assertCategory(db: DbLike, categoryId: string | null): void {
  if (!categoryId) return;
  const row = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
    .get();
  if (!row) throw notFound("หมวดหมู่ที่เลือก");
}

function assertSkuFree(db: DbLike, sku: string | null, exceptId?: string): void {
  if (!sku) return;
  const conds: SQL[] = [isNull(products.deletedAt), sql`lower(${products.sku}) = lower(${sku})`];
  if (exceptId) conds.push(ne(products.id, exceptId));
  const row = db.select({ id: products.id }).from(products).where(and(...conds)).get();
  if (row) throw new AppError("CONFLICT", "รหัสสินค้านี้มีอยู่แล้ว", { field: "sku" });
}

interface MovementRow {
  id: string;
  product_id: string;
  type: StockMovementType;
  qty: number;
  unit_cost: number | null;
  transaction_id: string | null;
  note: string | null;
  occurred_at: number;
  balance: number;
  doc_no: string | null;
  party_name: string | null;
  user_name: string | null;
}

export function createProductsApi(ctx: ApiContext): Handlers<ProductsApi> {
  const { db } = ctx;

  const mustGet = (id: string): Product => {
    const p = getProduct(db, id);
    if (!p) throw notFound("สินค้า");
    return p;
  };

  return {
    list: (input) => {
      const q = productListQuerySchema.parse(input ?? {});
      const conds: SQL[] = [isNull(products.deletedAt)];
      if (!q.includeInactive) conds.push(eq(products.isActive, true));
      if (q.categoryId === NO_CATEGORY) conds.push(isNull(products.categoryId));
      else if (q.categoryId) conds.push(eq(products.categoryId, q.categoryId));
      if (q.lowStockOnly) conds.push(sql`${products.trackStock} = 1 AND ${products.stockQty} <= ${products.minStock}`);
      if (q.search) {
        for (const term of q.search.split(/\s+/).filter(Boolean)) conds.push(searchCondition(term));
      }
      const where = and(...conds);
      const order =
        q.sort === "updated"
          ? [desc(products.updatedAt), asc(products.name)]
          : q.sort === "stock"
            ? // Lowest stock first; products that don't track stock go last.
              [sql`CASE WHEN ${products.trackStock} = 1 THEN 0 ELSE 1 END`, asc(products.stockQty), asc(products.name)]
            : [asc(products.name), asc(products.id)];
      const items = db
        .select(productColumns)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .orderBy(...order)
        .limit(q.limit)
        .offset(q.offset)
        .all();
      const total = db.select({ n: sql<number>`count(*)` }).from(products).where(where).get()?.n ?? 0;
      return { items, total };
    },

    get: (input) => mustGet(idSchema.parse(input)),

    create: (input) => {
      const v = productCreateSchema.parse(input);
      const id = newId();
      const at = now();
      db.transaction((tx) => {
        const actor = actorOf(tx, ctx.session);
        assertCategory(tx, v.categoryId);
        assertSkuFree(tx, v.sku);
        tx.insert(products)
          .values({
            id,
            sku: v.sku,
            barcode: v.barcode,
            name: v.name,
            categoryId: v.categoryId,
            brand: v.brand,
            model: v.model,
            spec: v.spec,
            unit: v.unit,
            costPrice: v.costPrice,
            sellPrice: v.sellPrice,
            stockQty: 0,
            minStock: roundQty(v.minStock),
            trackStock: v.trackStock,
            isActive: v.isActive,
            note: v.note,
            createdAt: at,
            updatedAt: at,
          })
          .run();
        const initial = roundQty(v.initialStock);
        if (initial > 0) {
          tx.insert(stockMovements)
            .values({
              id: newId(),
              productId: id,
              type: "initial",
              qty: initial,
              unitCost: v.costPrice,
              note: "ยอดยกมา",
              occurredAt: at,
              createdBy: actor.id,
              createdAt: at,
              updatedAt: at,
            })
            .run();
          recomputeStock(tx, id, at);
        }
        for (const [field, value] of [["sell", v.sellPrice], ["cost", v.costPrice]] as const) {
          if (value > 0) recordPriceChange(tx, { itemType: "product", itemId: id, field, oldValue: null, newValue: value, source: "create", actor, at });
        }
        const created = getProduct(tx, id)!;
        writeAudit(tx, actor, {
          entityType: "product",
          entityId: id,
          entityLabel: productLabel(created),
          action: "create",
          changes: initialFields({ ...auditSnap(created), initialStock: initial }, [...AUDIT_FIELDS, "initialStock"]),
          at,
        });
      });
      return mustGet(id);
    },

    update: (input) => {
      const v = productUpdateSchema.parse(input);
      db.transaction((tx) => {
        const before = getProduct(tx, v.id);
        if (!before) throw notFound("สินค้า");
        const actor = actorOf(tx, ctx.session);
        const at = now();
        assertCategory(tx, v.categoryId);
        assertSkuFree(tx, v.sku, v.id);
        tx.update(products)
          .set({
            sku: v.sku,
            barcode: v.barcode,
            name: v.name,
            categoryId: v.categoryId,
            brand: v.brand,
            model: v.model,
            spec: v.spec,
            unit: v.unit,
            costPrice: v.costPrice,
            sellPrice: v.sellPrice,
            minStock: roundQty(v.minStock),
            trackStock: v.trackStock,
            isActive: v.isActive,
            note: v.note,
            updatedAt: at,
          })
          .where(eq(products.id, v.id))
          .run();
        const after = getProduct(tx, v.id)!;
        recordPriceChange(tx, { itemType: "product", itemId: v.id, field: "sell", oldValue: before.sellPrice, newValue: after.sellPrice, source: "manual", actor, at });
        recordPriceChange(tx, { itemType: "product", itemId: v.id, field: "cost", oldValue: before.costPrice, newValue: after.costPrice, source: "manual", actor, at });
        const changes = diffFields(auditSnap(before), auditSnap(after), AUDIT_FIELDS);
        if (changes.length) writeAudit(tx, actor, { entityType: "product", entityId: v.id, entityLabel: productLabel(after), action: "update", changes, at });
      });
      return mustGet(v.id);
    },

    remove: (input) => {
      const id = idSchema.parse(input);
      const p = mustGet(id);
      const at = now();
      db.transaction((tx) => {
        tx.update(products).set({ deletedAt: at, updatedAt: at }).where(eq(products.id, id)).run();
        writeAudit(tx, actorOf(tx, ctx.session), { entityType: "product", entityId: id, entityLabel: productLabel(p), action: "delete", at });
      });
    },

    adjustStock: (input) => {
      const v = stockAdjustSchema.parse(input);
      const qty = roundQty(v.qty);
      db.transaction((tx) => {
        const p = getProduct(tx, v.productId);
        if (!p) throw notFound("สินค้า");
        if (!p.trackStock) throw new AppError("VALIDATION", "สินค้านี้ตั้งค่าไม่นับสต็อก จึงปรับยอดไม่ได้");
        const at = now();
        const actor = actorOf(tx, ctx.session);
        tx.insert(stockMovements)
          .values({
            id: newId(),
            productId: p.id,
            type: "adjust",
            qty,
            unitCost: p.costPrice,
            note: v.note,
            occurredAt: at,
            createdBy: actor.id,
            createdAt: at,
            updatedAt: at,
          })
          .run();
        const stockQty = recomputeStock(tx, p.id, at);
        writeAudit(tx, actor, {
          entityType: "product",
          entityId: p.id,
          entityLabel: productLabel(p),
          action: "stock_adjust",
          changes: [
            { field: "adjustQty", from: null, to: qty },
            { field: "stockQty", from: p.stockQty, to: stockQty },
          ],
          note: v.note,
          at,
        });
      });
      return mustGet(v.productId);
    },

    movements: (input) => {
      const q = movementsQuerySchema.parse(input);
      if (!getProduct(db, q.productId, true)) throw notFound("สินค้า");
      // Running balance in chronological order (occurred_at, then id = creation order for UUIDv7),
      // then page newest first.
      const rows = db.all<MovementRow>(sql`
        WITH m AS (
          SELECT sm.id, sm.product_id, sm.type, sm.qty, sm.unit_cost, sm.transaction_id, sm.note, sm.occurred_at, sm.created_by,
                 SUM(sm.qty) OVER (ORDER BY sm.occurred_at, sm.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
          FROM stock_movements sm
          WHERE sm.product_id = ${q.productId}
        )
        SELECT m.*, t.doc_no AS doc_no, COALESCE(c.name, t.contact_name) AS party_name, COALESCE(mu.name, tu.name) AS user_name
        FROM m
        LEFT JOIN users mu ON mu.id = m.created_by
        LEFT JOIN transactions t ON t.id = m.transaction_id
        LEFT JOIN users tu ON tu.id = t.created_by
        LEFT JOIN customers c ON c.id = t.customer_id
        ORDER BY m.occurred_at DESC, m.id DESC
        LIMIT ${q.limit} OFFSET ${q.offset}
      `);
      const items: StockMovement[] = rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        type: r.type,
        qty: roundQty(r.qty) + 0, // "+ 0" turns -0 (float noise) into 0
        unitCost: r.unit_cost,
        transactionId: r.transaction_id,
        docNo: r.doc_no,
        partyName: r.party_name,
        note: r.note,
        occurredAt: r.occurred_at,
        balance: roundQty(r.balance) + 0,
        userName: r.user_name,
      }));
      const total =
        db
          .select({ n: sql<number>`count(*)` })
          .from(stockMovements)
          .where(eq(stockMovements.productId, q.productId))
          .get()?.n ?? 0;
      return { items, total };
    },

    stats: (): ProductStats => {
      const s = db
        .select({
          productCount: sql<number>`COALESCE(SUM(CASE WHEN ${products.isActive} = 1 THEN 1 ELSE 0 END), 0)`,
          inactiveCount: sql<number>`COALESCE(SUM(CASE WHEN ${products.isActive} = 0 THEN 1 ELSE 0 END), 0)`,
          stockValue: sql<number>`COALESCE(SUM(CASE WHEN ${products.trackStock} = 1 AND ${products.stockQty} > 0 THEN ${products.stockQty} * ${products.costPrice} ELSE 0 END), 0)`,
          lowStockCount: sql<number>`COALESCE(SUM(CASE WHEN ${products.isActive} = 1 AND ${products.trackStock} = 1 AND ${products.stockQty} <= ${products.minStock} THEN 1 ELSE 0 END), 0)`,
        })
        .from(products)
        .where(isNull(products.deletedAt))
        .get();
      const byCategory = db
        .select({
          categoryId: products.categoryId,
          activeCount: sql<number>`COALESCE(SUM(CASE WHEN ${products.isActive} = 1 THEN 1 ELSE 0 END), 0)`,
          totalCount: sql<number>`count(*)`,
        })
        .from(products)
        .where(isNull(products.deletedAt))
        .groupBy(products.categoryId)
        .all();
      return {
        productCount: s?.productCount ?? 0,
        inactiveCount: s?.inactiveCount ?? 0,
        stockValue: Math.round(s?.stockValue ?? 0),
        lowStockCount: s?.lowStockCount ?? 0,
        byCategory,
      };
    },

    priceHistory: (input) => listPriceHistory(db, "product", input),
  };
}
