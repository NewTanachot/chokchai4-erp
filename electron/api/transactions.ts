/**
 * Sales (รายการขาย) and purchases (รายการซื้อ).
 *
 * Every write runs in ONE synchronous better-sqlite3 transaction:
 *   header + items + stock movements + product cost + doc number are all-or-nothing.
 * Bill math comes from shared/calc.ts (the same code the UI uses for its live preview) and the
 * values computed here are the authoritative ones stored in the DB.
 */
import { and, asc, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { computeTotals, lineTotal, mulQty, purchaseUnitCost } from "@shared/calc";
import { roundQty } from "@shared/money";
import {
  idSchema,
  nextDocNoInputSchema,
  transactionInputSchema,
  transactionListQuerySchema,
  transactionMarkPaidSchema,
  transactionUpdateSchema,
  transactionVoidSchema,
  type AppSettings,
  type AuditFieldChange,
  type AuditItemChange,
  type Handlers,
  type LineItemType,
  type TransactionDetail,
  type TransactionsApi,
  type TransactionType,
} from "@shared/contract";
import type { ApiContext } from "./context";
import type { DbLike, Tx } from "../db/client";
import { customers, docSequences, products, serviceItems, stockMovements, transactionItems, transactions } from "../db/schema";
import { diffFields, initialFields, writeAudit } from "./audit";
import { AppError, notFound } from "./errors";
import { recordPriceChange } from "./price-history";
import { actorOf, type Actor } from "./session";
import { readSettings } from "./settings";
import { recomputeStock } from "./stock";
import { loadTransactionDetails, loadTransactionSummaries } from "./transaction-read";
import { digitsOnly, likePattern, newId, now } from "./util";

type ParsedInput = z.output<typeof transactionInputSchema>;
type TxRow = typeof transactions.$inferSelect;
type ItemRow = typeof transactionItems.$inferSelect;

const EPS = 1e-9;

// ---------------------------------------------------------------------------------------------
// Document numbers: <prefix><YY><MM>-<NNNN>, running number per prefix+period.
// ---------------------------------------------------------------------------------------------

/** "S6909" for a sale on Sep 2026 with BE years (2569 -> "69"). Local time. */
export function docPeriodKey(settings: AppSettings, type: TransactionType, occurredAt: number): string {
  const d = new Date(occurredAt);
  const prefix = type === "sale" ? settings.docs.salePrefix : settings.docs.purchasePrefix;
  const year = settings.docs.useBuddhistYear ? d.getFullYear() + 543 : d.getFullYear();
  const yy = String(year % 100).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${prefix}${yy}${mm}`;
}

export const formatDocNo = (key: string, n: number): string => `${key}-${String(n).padStart(4, "0")}`;

function docNoExists(db: DbLike, docNo: string): boolean {
  return !!db.select({ id: transactions.id }).from(transactions).where(eq(transactions.docNo, docNo)).get();
}

/** Highest running number already used for a key (covers restored data whose sequence is missing/behind). */
function maxUsedNo(db: DbLike, key: string): number {
  const row = db
    .select({ n: sql<number | null>`MAX(CAST(substr(${transactions.docNo}, ${key.length + 2}) AS INTEGER))` })
    .from(transactions)
    .where(sql`substr(${transactions.docNo}, 1, ${key.length + 1}) = ${key + "-"}`)
    .get();
  return row?.n ?? 0;
}

/** Next free number for a key: after both the stored sequence and any number already used. */
function peekDocNo(db: DbLike, key: string): { docNo: string; n: number } {
  const seq = db.select().from(docSequences).where(eq(docSequences.key, key)).get();
  let n = Math.max(seq?.lastNo ?? 0, maxUsedNo(db, key)) + 1;
  while (docNoExists(db, formatDocNo(key, n))) n++;
  return { docNo: formatDocNo(key, n), n };
}

/** Reserves the next number. Must run inside the write transaction. */
function reserveDocNo(tx: Tx, key: string): string {
  const { docNo, n } = peekDocNo(tx, key);
  tx.insert(docSequences)
    .values({ key, lastNo: n })
    .onConflictDoUpdate({ target: docSequences.key, set: { lastNo: n } })
    .run();
  return docNo;
}

// ---------------------------------------------------------------------------------------------
// Line resolution & validation
// ---------------------------------------------------------------------------------------------

interface ResolvedLine {
  id: string;
  lineNo: number;
  itemType: LineItemType;
  productId: string | null;
  serviceItemId: string | null;
  name: string;
  unit: string | null;
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
  unitCost: number;
  note: string | null;
  /** Product line that writes a stock movement (see resolveLines for the rule on edit). */
  tracksStock: boolean;
  /** Checked against allowNegativeStock: writes a movement AND the product tracks stock today. */
  checkStock: boolean;
}

interface OldBill {
  row: TxRow;
  items: ItemRow[];
  /** Products that have a stock movement for this bill = products that were tracked on this bill. */
  trackedProductIds: Set<string>;
}

function productLabel(p: { name: string; spec: string | null }): string {
  return p.spec ? `${p.name} ${p.spec}` : p.name;
}

/** VAT rate (percent) the bill is computed with: 0 without VAT, else the bill's rate or the shop's default. */
function billVatRate(input: ParsedInput, settings: AppSettings): number {
  return input.vatMode === "none" ? 0 : (input.vatRate ?? settings.tax.vatRate);
}

/**
 * @param vatRate the bill's VAT rate (billVatRate): purchase lines cost what one unit really cost after the
 *   LINE discount and without VAT (shared/calc.ts purchaseUnitCost); the bill-level discount is not allocated.
 */
function resolveLines(tx: Tx, input: ParsedInput, old: OldBill | null, vatRate: number): ResolvedLine[] {
  // On edit, lines whose product/service was already on the bill are accepted even if that catalog
  // entry was deleted since (so an old bill can still be corrected / marked paid), and a sale keeps its
  // original cost snapshot for those products (historic gross profit must not change on edit).
  // Stock tracking follows the same idea: a product already on the bill keeps the tracking state it had
  // ON THAT BILL (it had a stock movement for this bill <=> it was tracked), whatever the product's
  // trackStock is today, so an edit such as "mark as paid" never re-deducts or drops old stock-outs.
  // Products newly added by the edit use their current trackStock.
  const oldProductCost = new Map<string, number>();
  const oldServiceIds = new Set<string>();
  for (const it of old?.items ?? []) {
    if (it.productId && !oldProductCost.has(it.productId)) oldProductCost.set(it.productId, it.unitCost);
    if (it.serviceItemId) oldServiceIds.add(it.serviceItemId);
  }

  return input.items.map((line, i): ResolvedLine => {
    const base = {
      id: newId(),
      lineNo: i + 1,
      qty: roundQty(line.qty),
      unitPrice: line.unitPrice,
      note: line.note,
    };
    const clampDiscount = (qty: number, price: number, discount: number) => Math.min(discount, mulQty(qty, price));
    const unitCostOf = (discount: number) => purchaseUnitCost({ qty: base.qty, unitPrice: base.unitPrice, discount }, input.vatMode, vatRate);

    if (line.itemType === "product") {
      const p = tx.select().from(products).where(eq(products.id, line.productId!)).get();
      if (!p) throw new AppError("VALIDATION", `ไม่พบสินค้าในรายการที่ ${i + 1}`, { line: i + 1 });
      if (p.deletedAt !== null && !oldProductCost.has(p.id)) {
        throw new AppError("VALIDATION", `สินค้า "${productLabel(p)}" ถูกลบแล้ว กรุณานำออกจากบิล`, { line: i + 1, productId: p.id });
      }
      const discount = clampDiscount(base.qty, base.unitPrice, line.discount);
      const total = lineTotal({ qty: base.qty, unitPrice: base.unitPrice, discount });
      const onOldBill = oldProductCost.has(p.id);
      const unitCost =
        input.type === "purchase" ? unitCostOf(discount) : onOldBill ? oldProductCost.get(p.id)! : p.costPrice;
      const tracksStock = onOldBill ? old!.trackedProductIds.has(p.id) : p.trackStock;
      return {
        ...base,
        itemType: "product",
        productId: p.id,
        serviceItemId: null,
        name: line.name || productLabel(p),
        unit: line.unit ?? p.unit,
        discount,
        total,
        unitCost,
        tracksStock,
        // A product that no longer tracks stock is not blocked (its stock is hidden and cannot be adjusted),
        // the same as a new sale of an untracked product.
        checkStock: tracksStock && p.trackStock,
      };
    }

    if (line.itemType === "service") {
      const s = tx.select().from(serviceItems).where(eq(serviceItems.id, line.serviceItemId!)).get();
      if (!s) throw new AppError("VALIDATION", `ไม่พบบริการในรายการที่ ${i + 1}`, { line: i + 1 });
      if (s.deletedAt !== null && !oldServiceIds.has(s.id)) {
        throw new AppError("VALIDATION", `บริการ "${s.name}" ถูกลบแล้ว กรุณานำออกจากบิล`, { line: i + 1, serviceItemId: s.id });
      }
      const discount = clampDiscount(base.qty, base.unitPrice, line.discount);
      const total = lineTotal({ qty: base.qty, unitPrice: base.unitPrice, discount });
      return {
        ...base,
        itemType: "service",
        productId: null,
        serviceItemId: s.id,
        name: line.name || s.name,
        unit: line.unit ?? s.unit,
        discount,
        total,
        unitCost: input.type === "purchase" ? unitCostOf(discount) : 0,
        tracksStock: false,
        checkStock: false,
      };
    }

    // custom (free text) line - the schema already requires a name.
    const discount = clampDiscount(base.qty, base.unitPrice, line.discount);
    const total = lineTotal({ qty: base.qty, unitPrice: base.unitPrice, discount });
    return {
      ...base,
      itemType: "custom",
      productId: null,
      serviceItemId: null,
      name: line.name,
      unit: line.unit,
      discount,
      total,
      unitCost: input.type === "purchase" ? unitCostOf(discount) : 0,
      tracksStock: false,
      checkStock: false,
    };
  });
}

function resolveCustomer(tx: Tx, input: ParsedInput, old: OldBill | null) {
  let contactName = input.contactName;
  let contactPhone = input.contactPhone;
  if (input.customerId) {
    const c = tx.select().from(customers).where(eq(customers.id, input.customerId)).get();
    const keptDeleted = c && c.deletedAt !== null && old?.row.customerId === c.id;
    if (!c || (c.deletedAt !== null && !keptDeleted)) throw new AppError("VALIDATION", "ไม่พบลูกค้าที่เลือก (อาจถูกลบแล้ว)");
    contactName ??= c.name;
    contactPhone ??= c.phone;
  }
  return { customerId: input.customerId, contactName, contactPhone };
}

// ---------------------------------------------------------------------------------------------
// Stock & cost
// ---------------------------------------------------------------------------------------------

function ledgerQty(db: DbLike, productId: string): number {
  const row = db
    .select({ qty: sql<number>`COALESCE(SUM(${stockMovements.qty}), 0)` })
    .from(stockMovements)
    .where(eq(stockMovements.productId, productId))
    .get();
  return roundQty(row?.qty ?? 0);
}

/**
 * When negative stock is not allowed, a sale may not push a product below zero. The check runs after
 * the bill's old movements were removed, so an edit is compared against the stock "before this bill".
 * An edit that does not make things worse (e.g. lowers the qty) is always allowed.
 * Only lines that write a movement for a product that tracks stock today are checked (checkStock).
 */
function assertStock(tx: Tx, lines: ResolvedLine[], stockBefore: Map<string, number>) {
  const want = new Map<string, number>();
  for (const l of lines) if (l.checkStock && l.productId) want.set(l.productId, roundQty((want.get(l.productId) ?? 0) + l.qty));
  const short: { productId: string; name: string; unit: string; available: number; requested: number }[] = [];
  for (const [productId, requested] of want) {
    const available = ledgerQty(tx, productId);
    const after = roundQty(available - requested);
    const before = stockBefore.get(productId) ?? available;
    if (after < -EPS && after < before - EPS) {
      const p = tx.select().from(products).where(eq(products.id, productId)).get()!;
      short.push({ productId, name: productLabel(p), unit: p.unit, available, requested });
    }
  }
  if (short.length) {
    const text = short.map((s) => `${s.name} (เหลือ ${s.available} ${s.unit}, ต้องการ ${s.requested})`).join(", ");
    throw new AppError("INSUFFICIENT_STOCK", `สต็อกไม่พอ: ${text}`, short);
  }
}

function writeItems(tx: Tx, bill: { id: string; type: TransactionType; occurredAt: number }, lines: ResolvedLine[], at: number) {
  for (const l of lines) {
    tx.insert(transactionItems)
      .values({
        id: l.id,
        transactionId: bill.id,
        lineNo: l.lineNo,
        itemType: l.itemType,
        productId: l.productId,
        serviceItemId: l.serviceItemId,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discount: l.discount,
        total: l.total,
        unitCost: l.unitCost,
        note: l.note,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    if (l.tracksStock && l.productId) {
      tx.insert(stockMovements)
        .values({
          id: newId(),
          productId: l.productId,
          type: bill.type,
          qty: bill.type === "sale" ? -l.qty : l.qty,
          unitCost: l.unitCost,
          transactionId: bill.id,
          transactionItemId: l.id,
          occurredAt: bill.occurredAt,
          createdAt: at,
          updatedAt: at,
        })
        .run();
    }
  }
}

/**
 * Latest completed purchase line of a product (by bill date, then newest bill, then last line).
 * unitCost = net cost per unit after the line discount, without VAT (shared/calc.ts purchaseUnitCost).
 */
type LatestPurchase = { transactionId: string; unitCost: number } | undefined;

function latestPurchaseLine(db: DbLike, productId: string): LatestPurchase {
  return db
    .select({ transactionId: transactionItems.transactionId, unitCost: transactionItems.unitCost })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
    .where(and(eq(transactionItems.productId, productId), eq(transactions.type, "purchase"), eq(transactions.status, "completed")))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id), desc(transactionItems.lineNo))
    .limit(1)
    .get();
}

/** Latest purchase line per product, taken BEFORE a purchase is created / edited / voided. */
function snapshotLatestPurchases(tx: Tx, productIds: Iterable<string>): Map<string, LatestPurchase> {
  const out = new Map<string, LatestPurchase>();
  for (const id of productIds) if (!out.has(id)) out.set(id, latestPurchaseLine(tx, id));
  return out;
}

/** The bill being saved / voided, for the price history note when a cost falls back to another purchase. */
interface CostTrigger {
  id: string;
  docNo: string;
  action: "save" | "void";
  actor: Actor;
}

/**
 * Product cost follows the product's LATEST purchase (by occurredAt): its net unit cost after the line
 * discount and without VAT (the bill discount is not allocated). After a write, a product's cost is
 * updated only when its latest purchase line actually changed:
 * - an older-dated purchase entered later does not overwrite a newer price;
 * - if this bill was the latest purchase and no longer is (edited date / product removed / voided), the
 *   cost falls back to the purchase that is now the latest (no purchase left: keep the current cost);
 * - an edit that leaves the latest purchase as it was (e.g. marking the bill as paid) keeps a cost that
 *   was edited by hand in the meantime.
 * Every cost that actually changes is written to the price history, linked to the purchase it comes from.
 */
function syncCostFromPurchases(tx: Tx, before: Map<string, LatestPurchase>, at: number, trigger: CostTrigger) {
  for (const [productId, prev] of before) {
    const cur = latestPurchaseLine(tx, productId);
    if (!cur) continue;
    if (prev && prev.transactionId === cur.transactionId && prev.unitCost === cur.unitCost) continue;
    const old = tx.select({ costPrice: products.costPrice }).from(products).where(eq(products.id, productId)).get();
    if (!old || old.costPrice === cur.unitCost) continue;
    tx.update(products).set({ costPrice: cur.unitCost, updatedAt: at }).where(eq(products.id, productId)).run();
    const fallback = cur.transactionId !== trigger.id;
    recordPriceChange(tx, {
      itemType: "product",
      itemId: productId,
      field: "cost",
      oldValue: old.costPrice,
      newValue: cur.unitCost,
      source: "purchase",
      transactionId: cur.transactionId,
      // Stored in Thai; the renderer translates it when shown.
      note: fallback
        ? trigger.action === "void"
          ? `ยกเลิกบิล ${trigger.docNo} แล้ว ใช้ราคาจากบิลซื้อก่อนหน้า`
          : `แก้ไขบิล ${trigger.docNo} แล้ว ใช้ราคาจากบิลซื้อก่อนหน้า`
        : null,
      actor: trigger.actor,
      at,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// History (audit) of a bill
// ---------------------------------------------------------------------------------------------

/** Header fields compared on edit, in display order. */
const AUDIT_HEADER_FIELDS = [
  "occurredAt",
  "customer",
  "contactName",
  "contactPhone",
  "vehiclePlate",
  "vehicleModel",
  "mileage",
  "discount",
  "vatMode",
  "vatRate",
  "total",
  "paymentMethod",
  "paymentStatus",
  "note",
] as const;

type HeaderSnap = Record<(typeof AUDIT_HEADER_FIELDS)[number], unknown>;

interface LineSnap {
  itemType: LineItemType;
  productId: string | null;
  serviceItemId: string | null;
  name: string;
  unit: string | null;
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
}

function customerName(db: DbLike, customerId: string | null): string | null {
  if (!customerId) return null;
  return db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId)).get()?.name ?? null;
}

function headerSnap(db: DbLike, h: Omit<HeaderSnap, "customer"> & { customerId: string | null }): HeaderSnap {
  return { ...h, customer: customerName(db, h.customerId) };
}

const lineKey = (l: LineSnap) => (l.itemType === "product" ? `p:${l.productId}` : l.itemType === "service" ? `s:${l.serviceItemId}` : `c:${l.name}`);
const lineValues = (l: LineSnap) => ({ qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, total: l.total });

/**
 * Line changes between two versions of a bill. Lines are matched by product / service (custom lines by name),
 * in order, so a changed qty or price shows as "changed" rather than removed + added.
 */
export function diffBillItems(before: LineSnap[], after: LineSnap[]): AuditItemChange[] {
  const used = new Set<number>();
  const pairs: [LineSnap, LineSnap][] = [];
  const removed: LineSnap[] = [];
  for (const b of before) {
    const i = after.findIndex((a, idx) => !used.has(idx) && lineKey(a) === lineKey(b));
    if (i < 0) removed.push(b);
    else {
      used.add(i);
      pairs.push([b, after[i]]);
    }
  }
  const out: AuditItemChange[] = [];
  after.forEach((a, idx) => {
    if (!used.has(idx)) {
      out.push({ change: "added", name: a.name, unit: a.unit, before: null, after: lineValues(a), fields: [] });
      return;
    }
    const [b] = pairs.find(([, x]) => x === a)!;
    const fields = diffFields(
      { name: b.name, qty: b.qty, unitPrice: b.unitPrice, lineDiscount: b.discount, lineTotal: b.total },
      { name: a.name, qty: a.qty, unitPrice: a.unitPrice, lineDiscount: a.discount, lineTotal: a.total },
      ["name", "qty", "unitPrice", "lineDiscount", "lineTotal"],
    );
    if (fields.length) out.push({ change: "changed", name: a.name, unit: a.unit, before: lineValues(b), after: lineValues(a), fields });
  });
  for (const b of removed) out.push({ change: "removed", name: b.name, unit: b.unit, before: lineValues(b), after: null, fields: [] });
  return out;
}

/**
 * Field changes of a bill edit. Switching between two linked customers is shown once, not again as the
 * contact-name snapshot that follows the customer.
 */
function diffBillHeader(before: HeaderSnap, after: HeaderSnap): AuditFieldChange[] {
  const changes = diffFields(before, after, AUDIT_HEADER_FIELDS);
  if (before.customer == null || after.customer == null) return changes;
  return changes.filter((c) => !(c.field === "contactName" && c.from === before.customer && c.to === after.customer));
}

const PAYMENT_FIELDS = new Set(["paymentMethod", "paymentStatus"]);

function stockProductIds(db: DbLike, transactionId: string): string[] {
  return db
    .selectDistinct({ productId: stockMovements.productId })
    .from(stockMovements)
    .where(eq(stockMovements.transactionId, transactionId))
    .all()
    .map((r) => r.productId);
}

function loadOld(tx: Tx, id: string): OldBill {
  const row = tx.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row) throw notFound("บิล");
  const items = tx.select().from(transactionItems).where(eq(transactionItems.transactionId, id)).orderBy(asc(transactionItems.lineNo)).all();
  return { row, items, trackedProductIds: new Set(stockProductIds(tx, id)) };
}

// ---------------------------------------------------------------------------------------------
// Write paths
// ---------------------------------------------------------------------------------------------

function computeHeader(input: ParsedInput, lines: ResolvedLine[], settings: AppSettings) {
  const vatMode = input.vatMode;
  const vatRate = billVatRate(input, settings);
  const totals = computeTotals({ lines, discount: input.discount, vatMode, vatRate });
  return { vatMode, vatRate, ...totals };
}

/**
 * When the bill's money changed hands (transactions.paid_at). A bill entered as paid was paid at its date;
 * marking an unpaid bill as paid records the time of that edit (money collected now, e.g. a credit sale);
 * a paid bill keeps its payment time, except that a bill paid on entry follows its date when the date is corrected.
 */
function paidAtFor(input: ParsedInput, old: OldBill | null, at: number): number | null {
  if (input.paymentStatus !== "paid") return null;
  if (!old) return input.occurredAt;
  const prev = old.row;
  if (prev.paymentStatus !== "paid") return at;
  if (prev.paidAt === null || prev.paidAt === prev.occurredAt) return input.occurredAt;
  return prev.paidAt;
}

function saveBill(tx: Tx, input: ParsedInput, settings: AppSettings, old: OldBill | null, actor: Actor): string {
  const at = now();
  const id = old?.row.id ?? newId();
  const lines = resolveLines(tx, input, old, billVatRate(input, settings));
  const cust = resolveCustomer(tx, input, old);
  const h = computeHeader(input, lines, settings);
  // "Before" snapshot for the history, taken before anything is written.
  const beforeSnap = old ? headerSnap(tx, old.row) : null;

  // Products touched by this bill before (old movements / purchase lines) and after the change.
  const oldStockIds = old ? [...old.trackedProductIds] : [];
  const oldPurchaseIds = old && old.row.type === "purchase" ? old.items.flatMap((i) => (i.productId ? [i.productId] : [])) : [];
  const newProductIds = lines.flatMap((l) => (l.productId ? [l.productId] : []));
  const costBefore =
    input.type === "purchase" && settings.inventory.updateCostOnPurchase ? snapshotLatestPurchases(tx, [...oldPurchaseIds, ...newProductIds]) : null;

  const stockBefore = new Map<string, number>();
  for (const pid of new Set([...oldStockIds, ...newProductIds])) stockBefore.set(pid, ledgerQty(tx, pid));

  if (old) {
    tx.delete(stockMovements).where(eq(stockMovements.transactionId, id)).run();
    tx.delete(transactionItems).where(eq(transactionItems.transactionId, id)).run();
  }

  if (input.type === "sale" && !settings.inventory.allowNegativeStock) assertStock(tx, lines, stockBefore);

  const header = {
    occurredAt: input.occurredAt,
    customerId: cust.customerId,
    contactName: cust.contactName,
    contactPhone: cust.contactPhone,
    vehiclePlate: input.vehiclePlate,
    vehicleModel: input.vehicleModel,
    mileage: input.mileage,
    subtotal: h.subtotal,
    discount: h.discount,
    vatMode: h.vatMode,
    vatRate: h.vatRate,
    vatAmount: h.vatAmount,
    total: h.total,
    paymentMethod: input.paymentMethod,
    paymentStatus: input.paymentStatus,
    paidAt: paidAtFor(input, old, at),
    note: input.note,
    updatedBy: actor.id,
    updatedAt: at,
  };

  let docNo: string;
  if (old) {
    docNo = old.row.docNo;
    tx.update(transactions).set(header).where(eq(transactions.id, id)).run();
  } else {
    docNo = reserveDocNo(tx, docPeriodKey(settings, input.type, input.occurredAt));
    tx.insert(transactions)
      .values({ id, type: input.type, docNo, status: "completed", ...header, createdBy: actor.id, createdAt: at })
      .run();
  }

  writeItems(tx, { id, type: input.type, occurredAt: input.occurredAt }, lines, at);

  // Every product whose ledger changed: old movements removed and / or new movements written.
  for (const pid of new Set([...oldStockIds, ...lines.filter((l) => l.tracksStock).map((l) => l.productId!)])) recomputeStock(tx, pid, at);

  if (costBefore) syncCostFromPurchases(tx, costBefore, at, { id, docNo, action: "save", actor });

  // History
  const afterSnap = headerSnap(tx, { ...header, customerId: cust.customerId, vatMode: h.vatMode, vatRate: h.vatRate, total: h.total, discount: h.discount });
  if (!beforeSnap) {
    writeAudit(tx, actor, {
      entityType: "transaction",
      entityId: id,
      entityLabel: docNo,
      action: "create",
      changes: initialFields({ ...afterSnap, items: lines.length }, ["customer", "contactName", "total", "paymentMethod", "paymentStatus", "items"]),
      at,
    });
  } else {
    const changes = diffBillHeader(beforeSnap, afterSnap);
    const items = diffBillItems(old!.items, lines);
    if (changes.length || items.length) {
      const isPayment =
        !items.length && changes.every((c) => PAYMENT_FIELDS.has(c.field)) && changes.some((c) => c.field === "paymentStatus" && c.to === "paid");
      writeAudit(tx, actor, {
        entityType: "transaction",
        entityId: id,
        entityLabel: docNo,
        action: isPayment ? "pay" : "update",
        changes,
        items,
        at,
      });
    }
  }
  return id;
}

// ---------------------------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------------------------

type ListQuery = z.output<typeof transactionListQuerySchema>;

function listConditions(q: ListQuery): SQL | undefined {
  const conds: SQL[] = [];
  if (q.type) conds.push(eq(transactions.type, q.type));
  if (q.status) conds.push(eq(transactions.status, q.status));
  if (q.paymentStatus) conds.push(eq(transactions.paymentStatus, q.paymentStatus));
  if (q.customerId) conds.push(eq(transactions.customerId, q.customerId));
  if (q.createdBy) conds.push(eq(transactions.createdBy, q.createdBy));
  if (q.from !== undefined) conds.push(gte(transactions.occurredAt, q.from));
  if (q.to !== undefined) conds.push(lt(transactions.occurredAt, q.to));
  if (q.search) {
    const strip = (col: string) => `replace(replace(replace(replace(${col}, '-', ''), ' ', ''), '(', ''), ')', '')`;
    for (const term of q.search.split(/\s+/).filter(Boolean)) {
      const p = likePattern(term);
      const digits = digitsOnly(term);
      const phone =
        digits.length >= 3
          ? sql` OR ${sql.raw(strip("transactions.contact_phone"))} LIKE ${"%" + digits + "%"} OR EXISTS (SELECT 1 FROM customers c WHERE c.id = transactions.customer_id AND ${sql.raw(strip("c.phone"))} LIKE ${"%" + digits + "%"})`
          : sql``;
      conds.push(
        sql`(transactions.doc_no LIKE ${p} ESCAPE '\\' OR transactions.contact_name LIKE ${p} ESCAPE '\\' OR transactions.contact_phone LIKE ${p} ESCAPE '\\' OR transactions.vehicle_plate LIKE ${p} ESCAPE '\\' OR transactions.vehicle_model LIKE ${p} ESCAPE '\\' OR transactions.note LIKE ${p} ESCAPE '\\' OR EXISTS (SELECT 1 FROM customers c WHERE c.id = transactions.customer_id AND (c.name LIKE ${p} ESCAPE '\\' OR c.phone LIKE ${p} ESCAPE '\\' OR c.shop_name LIKE ${p} ESCAPE '\\')) OR EXISTS (SELECT 1 FROM transaction_items i WHERE i.transaction_id = transactions.id AND i.name LIKE ${p} ESCAPE '\\')${phone})`,
      );
    }
  }
  return conds.length ? and(...conds) : undefined;
}

// ---------------------------------------------------------------------------------------------

export function createTransactionsApi(ctx: ApiContext): Handlers<TransactionsApi> {
  const { db } = ctx;

  const get = (id: string): TransactionDetail => {
    const [t] = loadTransactionDetails(db, [id]);
    if (!t) throw notFound("บิล");
    return t;
  };

  return {
    list: (input) => {
      const q = transactionListQuerySchema.parse(input ?? {});
      const where = listConditions(q);
      const ids = db
        .select({ id: transactions.id })
        .from(transactions)
        .where(where)
        .orderBy(desc(transactions.occurredAt), desc(transactions.id))
        .limit(q.limit)
        .offset(q.offset)
        .all()
        .map((r) => r.id);
      const agg = db
        .select({
          total: sql<number>`count(*)`,
          saleCount: sql<number>`COALESCE(SUM(CASE WHEN transactions.type = 'sale' AND transactions.status = 'completed' THEN 1 ELSE 0 END), 0)`,
          saleTotal: sql<number>`COALESCE(SUM(CASE WHEN transactions.type = 'sale' AND transactions.status = 'completed' THEN transactions.total ELSE 0 END), 0)`,
          purchaseCount: sql<number>`COALESCE(SUM(CASE WHEN transactions.type = 'purchase' AND transactions.status = 'completed' THEN 1 ELSE 0 END), 0)`,
          purchaseTotal: sql<number>`COALESCE(SUM(CASE WHEN transactions.type = 'purchase' AND transactions.status = 'completed' THEN transactions.total ELSE 0 END), 0)`,
          unpaidTotal: sql<number>`COALESCE(SUM(CASE WHEN transactions.status = 'completed' AND transactions.payment_status = 'unpaid' THEN transactions.total ELSE 0 END), 0)`,
          saleUnpaidTotal: sql<number>`COALESCE(SUM(CASE WHEN transactions.type = 'sale' AND transactions.status = 'completed' AND transactions.payment_status = 'unpaid' THEN transactions.total ELSE 0 END), 0)`,
          purchaseUnpaidTotal: sql<number>`COALESCE(SUM(CASE WHEN transactions.type = 'purchase' AND transactions.status = 'completed' AND transactions.payment_status = 'unpaid' THEN transactions.total ELSE 0 END), 0)`,
          voidCount: sql<number>`COALESCE(SUM(CASE WHEN transactions.status = 'void' THEN 1 ELSE 0 END), 0)`,
        })
        .from(transactions)
        .where(where)
        .get();
      return {
        items: loadTransactionSummaries(db, ids),
        total: agg?.total ?? 0,
        sums: {
          saleCount: agg?.saleCount ?? 0,
          saleTotal: agg?.saleTotal ?? 0,
          purchaseCount: agg?.purchaseCount ?? 0,
          purchaseTotal: agg?.purchaseTotal ?? 0,
          unpaidTotal: agg?.unpaidTotal ?? 0,
          saleUnpaidTotal: agg?.saleUnpaidTotal ?? 0,
          purchaseUnpaidTotal: agg?.purchaseUnpaidTotal ?? 0,
          voidCount: agg?.voidCount ?? 0,
        },
      };
    },

    get: (input) => get(idSchema.parse(input)),

    create: (input) => {
      const data = transactionInputSchema.parse(input);
      const settings = readSettings(db);
      const id = db.transaction((tx) => saveBill(tx, data, settings, null, actorOf(tx, ctx.session)));
      return get(id);
    },

    update: (input) => {
      const { id, ...rest } = transactionUpdateSchema.parse(input);
      const settings = readSettings(db);
      db.transaction((tx) => {
        const old = loadOld(tx, id);
        if (old.row.status === "void") throw new AppError("CONFLICT", "บิลนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้");
        if (old.row.type !== rest.type) throw new AppError("VALIDATION", "ไม่สามารถเปลี่ยนประเภทบิล (ซื้อ/ขาย) ได้");
        saveBill(tx, rest, settings, old, actorOf(tx, ctx.session));
      });
      return get(id);
    },

    void: (input) => {
      const { id, reason } = transactionVoidSchema.parse(input);
      const settings = readSettings(db);
      db.transaction((tx) => {
        const old = loadOld(tx, id);
        if (old.row.status === "void") throw new AppError("CONFLICT", "บิลนี้ถูกยกเลิกไปแล้ว");
        const at = now();
        const actor = actorOf(tx, ctx.session);
        const purchaseIds = old.row.type === "purchase" ? old.items.flatMap((i) => (i.productId ? [i.productId] : [])) : [];
        const costBefore = purchaseIds.length && settings.inventory.updateCostOnPurchase ? snapshotLatestPurchases(tx, purchaseIds) : null;
        const affected = [...old.trackedProductIds];
        tx.update(transactions)
          .set({ status: "void", voidedAt: at, voidReason: reason, voidedBy: actor.id, updatedBy: actor.id, updatedAt: at })
          .where(eq(transactions.id, id))
          .run();
        tx.delete(stockMovements).where(eq(stockMovements.transactionId, id)).run();
        for (const pid of affected) recomputeStock(tx, pid, at);
        if (costBefore) syncCostFromPurchases(tx, costBefore, at, { id, docNo: old.row.docNo, action: "void", actor });
        writeAudit(tx, actor, {
          entityType: "transaction",
          entityId: id,
          entityLabel: old.row.docNo,
          action: "void",
          changes: [{ field: "status", from: "completed", to: "void" }],
          note: reason,
          at,
        });
      });
      return get(id);
    },

    markPaid: (input) => {
      const { id, paymentMethod } = transactionMarkPaidSchema.parse(input);
      db.transaction((tx) => {
        const old = tx.select().from(transactions).where(eq(transactions.id, id)).get();
        if (!old || old.deletedAt !== null) throw notFound("บิล");
        if (old.status === "void") throw new AppError("CONFLICT", "บิลนี้ถูกยกเลิกแล้ว");
        if (old.paymentStatus === "paid") throw new AppError("CONFLICT", "บิลนี้ชำระเงินแล้ว");
        const at = now();
        const actor = actorOf(tx, ctx.session);
        tx.update(transactions)
          .set({ paymentStatus: "paid", paymentMethod, paidAt: at, updatedBy: actor.id, updatedAt: at })
          .where(eq(transactions.id, id))
          .run();
        writeAudit(tx, actor, {
          entityType: "transaction",
          entityId: id,
          entityLabel: old.docNo,
          action: "pay",
          changes: diffFields(old, { ...old, paymentStatus: "paid", paymentMethod }, ["paymentMethod", "paymentStatus"]),
          at,
        });
      });
      return get(id);
    },

    nextDocNo: (input) => {
      // Same period rule as on save (docPeriodKey of the bill date); no date = a bill dated now.
      const { type, occurredAt } = nextDocNoInputSchema.parse(input);
      const settings = readSettings(db);
      return peekDocNo(db, docPeriodKey(settings, type, occurredAt ?? now())).docNo;
    },
  };
}
