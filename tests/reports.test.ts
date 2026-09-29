// Fixed shop time zone so "local day" assertions are deterministic on any machine (Thailand, no DST).
process.env.TZ = "Asia/Bangkok";

import { describe, expect, it } from "vitest";
import { lineTotal } from "../shared/calc";
import { seedDemo } from "../electron/dev/demo-seed";
import { recomputeStock } from "../electron/api/stock";
import { newId } from "../electron/api/util";
import { toApiError } from "../electron/api/errors";
import { categories, products, serviceItems, stockMovements, transactionItems, transactions } from "../electron/db/schema";
import { createTestApi } from "./helpers/db";

type Api = ReturnType<typeof createTestApi>;

/** Local wall-clock time -> epoch ms. */
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
const dayRange = (y: number, m: number, d: number) => ({ from: local(y, m, d, 0), to: local(y, m, d + 1, 0) });

interface LineSpec {
  itemType?: "product" | "service" | "custom";
  productId?: string | null;
  serviceItemId?: string | null;
  name: string;
  unit?: string;
  qty: number;
  unitPrice: number;
  discount?: number;
  unitCost?: number;
}

let docCounter = 0;

/** Direct insert of a bill with lines (does not depend on transactions.create). */
function insertBill(
  t: Api,
  bill: {
    type?: "sale" | "purchase";
    occurredAt: number;
    status?: "completed" | "void";
    lines: LineSpec[];
    discount?: number;
    vatAmount?: number;
    /** Overrides the computed total (e.g. VAT exclusive). */
    total?: number;
    paymentMethod?: "cash" | "transfer" | "card" | "credit" | "other";
    paymentStatus?: "paid" | "unpaid";
    contactName?: string;
    deleted?: boolean;
  },
) {
  const id = newId();
  const type = bill.type ?? "sale";
  const subtotal = bill.lines.reduce((s, l) => s + lineTotal(l), 0);
  const discount = bill.discount ?? 0;
  const total = bill.total ?? subtotal - discount;
  t.db
    .insert(transactions)
    .values({
      id,
      type,
      docNo: `${type === "sale" ? "S" : "P"}-T${String(++docCounter).padStart(5, "0")}`,
      status: bill.status ?? "completed",
      occurredAt: bill.occurredAt,
      contactName: bill.contactName ?? null,
      subtotal,
      discount,
      vatMode: bill.vatAmount ? "exclusive" : "none",
      vatRate: bill.vatAmount ? 7 : 0,
      vatAmount: bill.vatAmount ?? 0,
      total,
      paymentMethod: bill.paymentMethod ?? "cash",
      paymentStatus: bill.paymentStatus ?? "paid",
      voidedAt: bill.status === "void" ? bill.occurredAt : null,
      createdAt: bill.occurredAt,
      updatedAt: bill.occurredAt,
      deletedAt: bill.deleted ? bill.occurredAt : null,
    })
    .run();
  bill.lines.forEach((l, i) => {
    const itemType = l.itemType ?? (l.productId ? "product" : l.serviceItemId ? "service" : "custom");
    t.db
      .insert(transactionItems)
      .values({
        id: newId(),
        transactionId: id,
        lineNo: i + 1,
        itemType,
        productId: l.productId ?? null,
        serviceItemId: l.serviceItemId ?? null,
        name: l.name,
        unit: l.unit ?? null,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discount: l.discount ?? 0,
        total: lineTotal(l),
        unitCost: type === "purchase" ? l.unitPrice : (l.unitCost ?? 0),
        createdAt: bill.occurredAt,
        updatedAt: bill.occurredAt,
      })
      .run();
  });
  return id;
}

function insertProduct(
  t: Api,
  p: { name: string; stock?: number; minStock?: number; trackStock?: boolean; isActive?: boolean; deleted?: boolean; categoryId?: string | null; cost?: number },
) {
  const id = newId();
  const at = Date.now();
  t.db
    .insert(products)
    .values({
      id,
      name: p.name,
      categoryId: p.categoryId ?? null,
      costPrice: p.cost ?? 0,
      sellPrice: 0,
      minStock: p.minStock ?? 0,
      trackStock: p.trackStock ?? true,
      isActive: p.isActive ?? true,
      createdAt: at,
      updatedAt: at,
      deletedAt: p.deleted ? at : null,
    })
    .run();
  if (p.stock) {
    t.db.insert(stockMovements).values({ id: newId(), productId: id, type: "initial", qty: p.stock, occurredAt: at, createdAt: at, updatedAt: at }).run();
  }
  recomputeStock(t.db, id, at);
  return id;
}

function insertService(t: Api, name: string) {
  const id = newId();
  const at = Date.now();
  t.db.insert(serviceItems).values({ id, name, defaultPrice: 0, createdAt: at, updatedAt: at }).run();
  return id;
}

describe("reports", () => {
  it("uses the Bangkok local time zone in both JS and SQLite", () => {
    const t = createTestApi();
    const row = t.sqlite.prepare("select datetime(0, 'unixepoch', 'localtime') as d").get() as { d: string };
    expect(row.d).toBe("1970-01-01 07:00:00");
    expect(new Date(0).getHours()).toBe(7);
    t.close();
  });

  it("summary: [from, to) boundaries, void and deleted excluded, sales vs purchases, net", async () => {
    const t = createTestApi({ seed: false });
    const { from, to } = dayRange(2026, 9, 10);
    const line = (price: number) => [{ name: "ปะยาง", qty: 1, unitPrice: price }];
    insertBill(t, { occurredAt: from, lines: line(10_000) }); // exactly at from -> in
    insertBill(t, { occurredAt: to - 1, lines: line(20_000), paymentMethod: "transfer" }); // last ms -> in
    insertBill(t, { occurredAt: to, lines: line(99_900) }); // exactly at to -> out
    insertBill(t, { occurredAt: from - 1, lines: line(88_800) }); // before -> out
    insertBill(t, { occurredAt: from + 3_600_000, lines: line(77_700), status: "void" }); // void -> out of totals
    insertBill(t, { occurredAt: from + 3_600_000, lines: line(66_600), deleted: true }); // soft-deleted -> ignored
    insertBill(t, { occurredAt: from + 7_200_000, type: "purchase", lines: [{ name: "ยาง", qty: 4, unitPrice: 2_500 }], paymentMethod: "credit", paymentStatus: "unpaid" });
    insertBill(t, { occurredAt: from + 7_300_000, type: "purchase", lines: [{ name: "แบต", qty: 1, unitPrice: 1_000 }], status: "void" });
    insertBill(t, { occurredAt: from + 8_000_000, lines: line(5_000), paymentMethod: "credit", paymentStatus: "unpaid" });

    const s = await t.api.reports.summary({ from, to });
    expect(s.range).toEqual({ from, to });
    expect(s.sales).toEqual({ count: 3, total: 35_000, vatAmount: 0, unpaidTotal: 5_000, unpaidCount: 1 });
    expect(s.purchases).toEqual({ count: 1, total: 10_000, vatAmount: 0, unpaidTotal: 10_000, unpaidCount: 1 });
    expect(s.net).toBe(25_000);
    expect(s.voidCount).toBe(2);
    expect(s.purchasesByPaymentMethod).toEqual([{ method: "credit", count: 1, total: 10_000 }]);

    const empty = await t.api.reports.summary({ from: to + 86_400_000, to: to + 2 * 86_400_000 });
    expect(empty.sales.count).toBe(0);
    expect(empty.net).toBe(0);
    expect(empty.salesByPaymentMethod).toEqual([]);
    expect(empty.salesByItemType).toEqual([]);
    t.close();
  });

  it("summary: gross profit excludes VAT and only costs product lines", async () => {
    const t = createTestApi({ seed: false });
    const tyre = insertProduct(t, { name: "ยาง A", stock: 10 });
    const svc = insertService(t, "ถ่วงล้อ");
    const { from, to } = dayRange(2026, 9, 11);
    // Exclusive VAT: lines 4 × 3,000 + 4 × 100 = 12,400 baht; VAT 7% = 868 -> total 13,268 baht.
    insertBill(t, {
      occurredAt: from + 36_000_000,
      lines: [
        { productId: tyre, name: "ยาง A", qty: 4, unitPrice: 300_000, unitCost: 220_000 },
        { serviceItemId: svc, name: "ถ่วงล้อ", qty: 4, unitPrice: 10_000, unitCost: 5_000 }, // service cost ignored
        { itemType: "custom", name: "ค่าแรงพิเศษ", qty: 1, unitPrice: 20_000 },
      ],
      vatAmount: 88_200,
      total: 1_260_000 + 88_200,
    });
    // Fractional quantity: round(1.5 × 333) = 500 (499.5 rounds up)
    insertBill(t, { occurredAt: from + 40_000_000, lines: [{ productId: tyre, name: "ยาง A", qty: 1.5, unitPrice: 1_000, unitCost: 333 }] });
    // Void sale must not count toward gross profit
    insertBill(t, { occurredAt: from + 41_000_000, status: "void", lines: [{ productId: tyre, name: "ยาง A", qty: 1, unitPrice: 300_000, unitCost: 220_000 }] });

    const s = await t.api.reports.summary({ from, to });
    expect(s.sales.total).toBe(1_348_200 + 1_500);
    expect(s.sales.vatAmount).toBe(88_200);
    // (1,348,200 − 88,200) + 1,500 − (4 × 220,000 + round(1.5 × 333))
    expect(s.grossProfit).toBe(1_260_000 + 1_500 - (880_000 + 500));
    expect(s.salesByItemType).toEqual([
      { itemType: "product", total: 1_201_500 },
      { itemType: "service", total: 40_000 },
      { itemType: "custom", total: 20_000 },
    ]);
    t.close();
  });

  it("summary: payment method breakdown covers every method present", async () => {
    const t = createTestApi({ seed: false });
    const { from, to } = dayRange(2026, 9, 12);
    const bill = (price: number, paymentMethod: "cash" | "transfer" | "card" | "credit" | "other", status: "completed" | "void" = "completed") =>
      insertBill(t, { occurredAt: from + 3_600_000, lines: [{ name: "x", qty: 1, unitPrice: price }], paymentMethod, status });
    bill(1_000, "cash");
    bill(2_000, "cash");
    bill(10_000, "transfer");
    bill(500, "card");
    bill(700, "other");
    bill(50_000, "card", "void");
    insertBill(t, { type: "purchase", occurredAt: from + 3_600_000, lines: [{ name: "y", qty: 1, unitPrice: 99_999 }], paymentMethod: "cash" });

    const s = await t.api.reports.summary({ from, to });
    expect(s.salesByPaymentMethod).toEqual([
      { method: "transfer", count: 1, total: 10_000 },
      { method: "cash", count: 2, total: 3_000 },
      { method: "other", count: 1, total: 700 },
      { method: "card", count: 1, total: 500 },
    ]);
    expect(s.salesByPaymentMethod.reduce((a, r) => a + r.total, 0)).toBe(s.sales.total);
    expect(s.purchasesByPaymentMethod).toEqual([{ method: "cash", count: 1, total: 99_999 }]);
    t.close();
  });

  it("daily: one zero-filled row per local day, grouped by local date", async () => {
    const t = createTestApi({ seed: false });
    // 00:30 local on the 2nd is still the 1st in UTC - must land on the 2nd.
    insertBill(t, { occurredAt: local(2026, 9, 2, 0, 30), lines: [{ name: "a", qty: 1, unitPrice: 1_000 }] });
    // 23:59 local on the 2nd must also land on the 2nd.
    insertBill(t, { occurredAt: local(2026, 9, 2, 23, 59), lines: [{ name: "b", qty: 1, unitPrice: 2_000 }] });
    insertBill(t, { occurredAt: local(2026, 9, 4, 9), type: "purchase", lines: [{ name: "c", qty: 2, unitPrice: 1_500 }] });
    insertBill(t, { occurredAt: local(2026, 9, 4, 10), status: "void", lines: [{ name: "d", qty: 1, unitPrice: 9_000 }] });
    insertBill(t, { occurredAt: local(2026, 9, 6, 0, 0), lines: [{ name: "e", qty: 1, unitPrice: 9_000 }] }); // == to -> out

    const rows = await t.api.reports.daily({ from: local(2026, 9, 1, 0), to: local(2026, 9, 6, 0) });
    expect(rows.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    expect(rows[0]).toEqual({ date: "2026-09-01", salesTotal: 0, salesCount: 0, purchasesTotal: 0, purchasesCount: 0, net: 0 });
    expect(rows[1]).toEqual({ date: "2026-09-02", salesTotal: 3_000, salesCount: 2, purchasesTotal: 0, purchasesCount: 0, net: 3_000 });
    expect(rows[3]).toEqual({ date: "2026-09-04", salesTotal: 0, salesCount: 0, purchasesTotal: 3_000, purchasesCount: 1, net: -3_000 });
    expect(rows[4].salesTotal).toBe(0);

    // Month boundary + a range starting mid-day still yields whole local days.
    const across = await t.api.reports.daily({ from: local(2026, 8, 30, 15), to: local(2026, 9, 2, 1) });
    expect(across.map((r) => r.date)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(across[3].salesTotal).toBe(1_000); // only the 00:30 bill is before `to`

    expect(await t.api.reports.daily({ from: 10, to: 10 })).toEqual([]);
    await expect(Promise.resolve().then(() => t.api.reports.daily({ from: 0, to: local(2026, 9, 1) }))).rejects.toThrow(/ยาวเกินไป/);
    t.close();
  });

  it("topItems: groups by catalog id (or name for custom), orders by total, filters by type", async () => {
    const t = createTestApi({ seed: false });
    const a = insertProduct(t, { name: "ยาง A" });
    const b = insertProduct(t, { name: "แบต B" });
    const svc = insertService(t, "ตั้งศูนย์ล้อ");
    const { from, to } = dayRange(2026, 9, 15);
    const at = (h: number) => from + h * 3_600_000;
    insertBill(t, { occurredAt: at(9), lines: [{ productId: a, name: "ยาง A (เก่า)", unit: "เส้น", qty: 2, unitPrice: 2_000 }, { serviceItemId: svc, name: "ตั้งศูนย์", qty: 1, unitPrice: 500 }] });
    insertBill(t, { occurredAt: at(10), lines: [{ productId: a, name: "ยาง A 205/55R16", unit: "เส้น", qty: 4, unitPrice: 2_000 }] });
    insertBill(t, { occurredAt: at(11), lines: [{ productId: b, name: "แบต B", unit: "ลูก", qty: 1, unitPrice: 10_000 }, { itemType: "custom", name: "ค่าแรง", qty: 1, unitPrice: 300 }] });
    insertBill(t, { occurredAt: at(12), lines: [{ itemType: "custom", name: "ค่าแรง", qty: 2, unitPrice: 300 }, { serviceItemId: svc, name: "ตั้งศูนย์ล้อ", qty: 1, unitPrice: 500 }] });
    insertBill(t, { occurredAt: at(13), status: "void", lines: [{ productId: b, name: "แบต B", qty: 5, unitPrice: 10_000 }] });
    insertBill(t, { occurredAt: at(14), type: "purchase", lines: [{ productId: b, name: "แบต B", qty: 3, unitPrice: 7_000 }, { productId: a, name: "ยาง A", qty: 8, unitPrice: 1_500 }] });

    const top = await t.api.reports.topItems({ from, to });
    expect(top.map((r) => [r.itemType, r.name, r.qty, r.total, r.billCount])).toEqual([
      ["product", "ยาง A 205/55R16", 6, 12_000, 2], // latest name snapshot
      ["product", "แบต B", 1, 10_000, 1],
      ["service", "ตั้งศูนย์ล้อ", 2, 1_000, 2],
      ["custom", "ค่าแรง", 3, 900, 2],
    ]);
    expect(top[0].refId).toBe(a);
    expect(top[0].unit).toBe("เส้น");
    expect(top[3].refId).toBeNull();

    expect((await t.api.reports.topItems({ from, to, limit: 2 })).map((r) => r.refId)).toEqual([a, b]);
    const services = await t.api.reports.topItems({ from, to, itemType: "service" });
    expect(services.map((r) => r.refId)).toEqual([svc]);

    const bought = await t.api.reports.topItems({ from, to, type: "purchase" });
    expect(bought.map((r) => [r.refId, r.qty, r.total])).toEqual([
      [b, 3, 21_000],
      [a, 8, 12_000],
    ]);
    expect(await t.api.reports.topItems({ from: to, to: to + 1000 })).toEqual([]);
    t.close();
  });

  it("lowStock: active tracked products at or below min stock, most urgent first", async () => {
    const t = createTestApi();
    const cat = t.db.select().from(categories).all()[0];
    insertProduct(t, { name: "ปกติ", stock: 10, minStock: 4 });
    const half = insertProduct(t, { name: "เหลือครึ่ง", stock: 2, minStock: 4, categoryId: cat.id });
    const out = insertProduct(t, { name: "หมดแล้ว", stock: 0, minStock: 2 });
    const edge = insertProduct(t, { name: "เท่าขั้นต่ำ", stock: 5, minStock: 5 });
    const low = insertProduct(t, { name: "เหลือน้อยมาก", stock: 1, minStock: 10 });
    insertProduct(t, { name: "ไม่นับสต็อก", stock: 0, minStock: 5, trackStock: false });
    insertProduct(t, { name: "ปิดขาย", stock: 0, minStock: 5, isActive: false });
    insertProduct(t, { name: "ลบแล้ว", stock: 0, minStock: 5, deleted: true });

    const list = await t.api.reports.lowStock({});
    expect(list.map((p) => p.id)).toEqual([out, low, half, edge]);
    expect(list.find((p) => p.id === half)?.categoryName).toBe(cat.name);
    expect(list.every((p) => p.trackStock && p.isActive && p.stockQty <= p.minStock)).toBe(true);
    expect((await t.api.reports.lowStock({ limit: 1 })).map((p) => p.id)).toEqual([out]);
    t.close();
  });

  it("recent: newest first, any status, optional window", async () => {
    const t = createTestApi({ seed: false });
    const { from, to } = dayRange(2026, 9, 20);
    const s1 = insertBill(t, { occurredAt: from + 1_000, lines: [{ name: "ยาง", qty: 4, unitPrice: 100 }], contactName: "ลูกค้า 1" });
    const s2 = insertBill(t, { occurredAt: from + 2_000, status: "void", lines: [{ name: "แบต", qty: 1, unitPrice: 100 }] });
    const p1 = insertBill(t, { occurredAt: from + 3_000, type: "purchase", lines: [{ name: "ยาง", qty: 1, unitPrice: 100 }] });
    const old = insertBill(t, { occurredAt: from - 1, lines: [{ name: "x", qty: 1, unitPrice: 100 }] });
    insertBill(t, { occurredAt: from + 4_000, deleted: true, lines: [{ name: "x", qty: 1, unitPrice: 100 }] });

    const all = await t.api.reports.recent({});
    expect(all.map((r) => r.id)).toEqual([p1, s2, s1, old]);
    expect(all[1].status).toBe("void");
    expect(all[2]).toMatchObject({ displayName: "ลูกค้า 1", itemsPreview: "ยาง ×4", itemCount: 1, total: 400 });
    expect((await t.api.reports.recent({ limit: 2 })).map((r) => r.id)).toEqual([p1, s2]);
    expect((await t.api.reports.recent({ from, to })).map((r) => r.id)).toEqual([p1, s2, s1]);
    t.close();
  });

  it("summary: bill discount lowers revenue and profit; inclusive VAT is taken out of profit", async () => {
    const t = createTestApi({ seed: false });
    const tyre = insertProduct(t, { name: "ยาง B", stock: 10 });
    const { from, to } = dayRange(2026, 9, 13);
    // 2 × 1,000 baht, bill discount 100 baht -> total 1,900 baht; cost 2 × 600 baht.
    insertBill(t, {
      occurredAt: from + 3_600_000,
      lines: [{ productId: tyre, name: "ยาง B", qty: 2, unitPrice: 100_000, unitCost: 60_000 }],
      discount: 10_000,
    });
    // VAT inclusive: price 1,070 baht includes 70 baht VAT; cost 500 baht.
    insertBill(t, {
      occurredAt: from + 7_200_000,
      lines: [{ productId: tyre, name: "ยาง B", qty: 1, unitPrice: 107_000, unitCost: 50_000 }],
      vatAmount: 7_000,
      total: 107_000,
    });
    const s = await t.api.reports.summary({ from, to });
    expect(s.sales.total).toBe(190_000 + 107_000);
    expect(s.sales.vatAmount).toBe(7_000);
    expect(s.grossProfit).toBe(190_000 - 120_000 + (107_000 - 7_000 - 50_000));
    // Line totals are before the bill discount.
    expect(s.salesByItemType).toEqual([{ itemType: "product", total: 200_000 + 107_000 }]);
    // Loss-making sale -> negative gross profit is reported as is.
    insertBill(t, { occurredAt: from + 8_000_000, lines: [{ productId: tyre, name: "ยาง B", qty: 1, unitPrice: 10_000, unitCost: 60_000 }] });
    const s2 = await t.api.reports.summary({ from, to });
    expect(s2.grossProfit).toBe(s.grossProfit + 10_000 - 60_000);
    t.close();
  });

  it("validates input and tolerates empty / reversed ranges", async () => {
    const t = createTestApi({ seed: false });
    // Zod errors surface as-is here; electron/api/errors.ts maps them to VALIDATION at the IPC boundary.
    const call = (fn: () => unknown) => Promise.resolve().then(fn).catch((e) => Promise.reject(toApiError(e)));
    await expect(call(() => t.api.reports.summary({ from: "x", to: 1 } as never))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call(() => t.api.reports.daily({ from: 1.5, to: 2 } as never))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call(() => t.api.reports.topItems({ from: 0, to: 1, limit: 0 }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call(() => t.api.reports.topItems({ from: 0, to: 1, type: "refund" as never }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call(() => t.api.reports.lowStock({ limit: 10_000 }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call(() => t.api.reports.recent({ limit: -1 }))).rejects.toMatchObject({ code: "VALIDATION" });

    insertBill(t, { occurredAt: local(2026, 9, 5), lines: [{ name: "a", qty: 1, unitPrice: 1_000 }] });
    const reversed = { from: local(2026, 9, 6, 0), to: local(2026, 9, 5, 0) };
    expect((await t.api.reports.summary(reversed)).sales).toEqual({ count: 0, total: 0, vatAmount: 0, unpaidTotal: 0, unpaidCount: 0 });
    expect(await t.api.reports.daily(reversed)).toEqual([]);
    expect(await t.api.reports.topItems(reversed)).toEqual([]);
    // lowStock / recent accept a missing input object.
    expect(await t.api.reports.lowStock(undefined as never)).toEqual([]);
    expect(await t.api.reports.recent(undefined as never)).toHaveLength(1);
    t.close();
  });

  it("topItems: custom names group case- and space-insensitively; catalog lines without an id fall back to the name", async () => {
    const t = createTestApi({ seed: false });
    const { from, to } = dayRange(2026, 9, 16);
    const at = (h: number) => from + h * 3_600_000;
    insertBill(t, { occurredAt: at(9), lines: [{ itemType: "custom", name: "Oil Change", qty: 1, unitPrice: 500 }] });
    insertBill(t, { occurredAt: at(10), lines: [{ itemType: "custom", name: "  oil change ", qty: 2, unitPrice: 500 }] });
    insertBill(t, { occurredAt: at(11), lines: [{ itemType: "product", productId: null, name: "ยางเก่า", qty: 1, unitPrice: 200 }] });
    insertBill(t, { occurredAt: at(12), lines: [{ itemType: "product", productId: null, name: "ยางเก่า", qty: 3, unitPrice: 200 }] });
    const top = await t.api.reports.topItems({ from, to });
    expect(top.map((r) => [r.itemType, r.refId, r.name, r.qty, r.total, r.billCount])).toEqual([
      ["custom", null, "oil change", 3, 1_500, 2], // name of the most recent line, trimmed
      ["product", null, "ยางเก่า", 4, 800, 2],
    ]);
    t.close();
  });

  it("daily totals match summary across a month boundary", async () => {
    const t = createTestApi({ seed: false });
    const days = [
      [8, 30, 9],
      [8, 31, 23],
      [9, 1, 0],
      [9, 1, 12],
      [9, 3, 18],
    ] as const;
    days.forEach(([m, d, h], i) => {
      insertBill(t, { occurredAt: local(2026, m, d, h, 15), lines: [{ name: `s${i}`, qty: 1, unitPrice: 1_000 * (i + 1) }] });
      insertBill(t, { occurredAt: local(2026, m, d, h, 20), type: "purchase", lines: [{ name: `p${i}`, qty: 1, unitPrice: 300 }] });
    });
    insertBill(t, { occurredAt: local(2026, 9, 2, 10), status: "void", lines: [{ name: "v", qty: 1, unitPrice: 50_000 }] });
    const range = { from: local(2026, 8, 25, 0), to: local(2026, 9, 5, 0) };
    const rows = await t.api.reports.daily(range);
    const s = await t.api.reports.summary(range);
    expect(rows).toHaveLength(11);
    expect(rows.reduce((a, r) => a + r.salesTotal, 0)).toBe(s.sales.total);
    expect(rows.reduce((a, r) => a + r.purchasesTotal, 0)).toBe(s.purchases.total);
    expect(rows.reduce((a, r) => a + r.net, 0)).toBe(s.net);
    expect(rows.find((r) => r.date === "2026-09-01")).toMatchObject({ salesCount: 2, salesTotal: 3_000 + 4_000, purchasesCount: 2 });
    expect(rows.find((r) => r.date === "2026-09-02")).toMatchObject({ salesCount: 0, salesTotal: 0 });
    t.close();
  });

  it("recent: one-sided windows", async () => {
    const t = createTestApi({ seed: false });
    const a = insertBill(t, { occurredAt: local(2026, 9, 1), lines: [{ name: "a", qty: 1, unitPrice: 100 }] });
    const b = insertBill(t, { occurredAt: local(2026, 9, 2), lines: [{ name: "b", qty: 1, unitPrice: 100 }] });
    const c = insertBill(t, { occurredAt: local(2026, 9, 3), lines: [{ name: "c", qty: 1, unitPrice: 100 }] });
    expect((await t.api.reports.recent({ from: local(2026, 9, 2) })).map((r) => r.id)).toEqual([c, b]);
    expect((await t.api.reports.recent({ to: local(2026, 9, 2) })).map((r) => r.id)).toEqual([a]);
    t.close();
  });

  it("lowStock: negative stock (oversold) comes first", async () => {
    const t = createTestApi({ seed: false });
    const low = insertProduct(t, { name: "เหลือน้อย", stock: 1, minStock: 4 });
    const zero = insertProduct(t, { name: "หมด", stock: 0, minStock: 4 });
    const neg = insertProduct(t, { name: "ติดลบ", stock: 0, minStock: 4 });
    const at = Date.now();
    t.db.insert(stockMovements).values({ id: newId(), productId: neg, type: "sale", qty: -2, occurredAt: at, createdAt: at, updatedAt: at }).run();
    recomputeStock(t.db, neg, at);
    const list = await t.api.reports.lowStock({});
    expect(list.map((p) => [p.id, p.stockQty])).toEqual([
      [neg, -2],
      [zero, 0],
      [low, 1],
    ]);
    t.close();
  });

  it("end to end with transactions.create / void (cost snapshot, VAT, void)", async () => {
    const t = createTestApi({ seed: false });
    const tyre = insertProduct(t, { name: "ยาง E2E", stock: 10, cost: 200_000 });
    const svc = insertService(t, "ถ่วงล้อ");
    const at = local(2026, 9, 18, 10);
    let sale;
    try {
      sale = await t.api.transactions.create({
        type: "sale",
        occurredAt: at,
        items: [
          { itemType: "product", productId: tyre, qty: 2, unitPrice: 300_000 },
          { itemType: "service", serviceItemId: svc, qty: 2, unitPrice: 10_000 },
        ],
        vatMode: "exclusive",
        vatRate: 7,
        paymentMethod: "transfer",
      });
    } catch (e) {
      if ((e as { code?: string }).code === "NOT_IMPLEMENTED") return; // built by another feature
      throw e;
    }
    const voided = await t.api.transactions.create({
      type: "sale",
      occurredAt: at + 60_000,
      items: [{ itemType: "product", productId: tyre, qty: 1, unitPrice: 300_000 }],
    });
    await t.api.transactions.void({ id: voided.id, reason: "ทดสอบ" });

    const s = await t.api.reports.summary(dayRange(2026, 9, 18));
    expect(s.sales.count).toBe(1);
    expect(s.sales.total).toBe(sale.total);
    expect(s.sales.vatAmount).toBe(sale.vatAmount);
    expect(s.voidCount).toBe(1);
    // Product cost snapshot (2 × 2,000 baht); VAT is not profit.
    expect(s.grossProfit).toBe(sale.total - sale.vatAmount - 400_000);
    expect(s.salesByPaymentMethod).toEqual([{ method: "transfer", count: 1, total: sale.total }]);
    const top = await t.api.reports.topItems({ ...dayRange(2026, 9, 18), itemType: "product" });
    expect(top.map((r) => [r.refId, r.qty])).toEqual([[tyre, 2]]);
    const recent = await t.api.reports.recent({ ...dayRange(2026, 9, 18) });
    expect(recent.map((r) => [r.id, r.status])).toEqual([
      [voided.id, "void"],
      [sale.id, "completed"],
    ]);
    t.close();
  });

  it("is consistent with the demo data set", async () => {
    const t = createTestApi();
    await seedDemo(t.ctx);
    const now = Date.now();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setDate(from.getDate() - 30);
    const to = new Date(today);
    to.setDate(to.getDate() + 1);
    const range = { from: from.getTime(), to: to.getTime() };

    const s = await t.api.reports.summary(range);
    const rows = t.db.select().from(transactions).all().filter((r) => r.status === "completed" && r.occurredAt >= range.from && r.occurredAt < range.to);
    const sum = (type: string) => rows.filter((r) => r.type === type).reduce((a, r) => a + r.total, 0);
    expect(s.sales.total).toBe(sum("sale"));
    expect(s.purchases.total).toBe(sum("purchase"));
    expect(s.sales.count).toBeGreaterThan(20);
    expect(s.voidCount).toBe(1);
    expect(s.sales.unpaidTotal).toBeGreaterThan(0);
    expect(s.grossProfit).toBeGreaterThan(0);
    expect(s.grossProfit).toBeLessThan(s.sales.total);
    expect(s.salesByPaymentMethod.reduce((a, r) => a + r.total, 0)).toBe(s.sales.total);

    const daily = await t.api.reports.daily(range);
    expect(daily).toHaveLength(31);
    expect(daily.reduce((a, r) => a + r.salesTotal, 0)).toBe(s.sales.total);
    expect(daily.reduce((a, r) => a + r.purchasesCount, 0)).toBe(s.purchases.count);
    expect(daily[daily.length - 1].salesCount).toBeGreaterThanOrEqual(3); // today's demo bills

    const top = await t.api.reports.topItems({ ...range, limit: 100 });
    for (let i = 1; i < top.length; i++) expect(top[i - 1].total).toBeGreaterThanOrEqual(top[i].total);

    const low = await t.api.reports.lowStock({ limit: 500 });
    const expected = await t.api.products.list({ lowStockOnly: true, limit: 1000 });
    expect(new Set(low.map((p) => p.id))).toEqual(new Set(expected.items.map((p) => p.id)));

    const recent = await t.api.reports.recent({ limit: 5 });
    expect(recent).toHaveLength(5);
    for (let i = 1; i < recent.length; i++) expect(recent[i - 1].occurredAt).toBeGreaterThanOrEqual(recent[i].occurredAt);
    t.close();
  });
});
