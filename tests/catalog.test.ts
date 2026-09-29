import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_CATEGORY, type ErrorCode } from "@shared/contract";
import { toApiError } from "../electron/api/errors";
import { seedDemo } from "../electron/dev/demo-seed";
import { createTestApi } from "./helpers/db";

type T = ReturnType<typeof createTestApi>;

/** Runs `fn` and returns the mapped API error (as the IPC layer would send it). */
async function apiError(fn: () => unknown): Promise<{ code: ErrorCode; message: string }> {
  try {
    await fn();
  } catch (e) {
    return toApiError(e);
  }
  throw new Error("expected the call to fail");
}

let t: T;
beforeEach(() => {
  t = createTestApi();
});
afterEach(() => t.close());

const catId = async (name: string) => {
  const c = (await t.api.categories.list()).find((x) => x.name === name);
  if (!c) throw new Error(`no category ${name}`);
  return c.id;
};

const ledgerMismatches = () =>
  t.sqlite
    .prepare(
      "select p.id from products p where abs(p.stock_qty - (select coalesce(sum(qty),0) from stock_movements m where m.product_id = p.id)) > 0.001",
    )
    .all();

describe("products: create / update / remove", () => {
  it("creates a product with initial stock and an 'initial' movement", async () => {
    const tyres = await catId("ยางรถยนต์");
    const p = await t.api.products.create({
      name: "  Michelin Primacy 4  ",
      categoryId: tyres,
      brand: "Michelin",
      spec: "205/55R16 91V",
      sku: "TY-001",
      unit: "เส้น",
      costPrice: 290000,
      sellPrice: 365000,
      minStock: 4,
      initialStock: 12,
      barcode: "",
    });
    expect(p.name).toBe("Michelin Primacy 4");
    expect(p.categoryName).toBe("ยางรถยนต์");
    expect(p.barcode).toBeNull();
    expect(p.stockQty).toBe(12);
    expect(p.trackStock).toBe(true);
    expect(p.isActive).toBe(true);

    const mv = await t.api.products.movements({ productId: p.id });
    expect(mv.total).toBe(1);
    expect(mv.items[0]).toMatchObject({ type: "initial", qty: 12, unitCost: 290000, note: "ยอดยกมา", balance: 12, docNo: null });
    expect(ledgerMismatches()).toEqual([]);
  });

  it("creates without initial stock -> no movement; defaults applied", async () => {
    const p = await t.api.products.create({ name: "จุ๊บลม" });
    expect(p.stockQty).toBe(0);
    expect(p.unit).toBe("ชิ้น");
    expect(p.categoryId).toBeNull();
    expect(p.costPrice).toBe(0);
    expect((await t.api.products.movements({ productId: p.id })).total).toBe(0);
  });

  it("rejects an unknown or deleted category", async () => {
    expect((await apiError(() => t.api.products.create({ name: "x", categoryId: "nope" }))).code).toBe("NOT_FOUND");
    const c = await t.api.categories.create({ name: "ชั่วคราว" });
    await t.api.categories.remove(c.id);
    expect((await apiError(() => t.api.products.create({ name: "x", categoryId: c.id }))).code).toBe("NOT_FOUND");
  });

  it("sku must be unique among non-deleted products (case-insensitive) and can be re-used after delete", async () => {
    const a = await t.api.products.create({ name: "A", sku: "BT-55B24L" });
    const err = await apiError(() => t.api.products.create({ name: "B", sku: "bt-55b24l" }));
    expect(err).toMatchObject({ code: "CONFLICT", message: "รหัสสินค้านี้มีอยู่แล้ว" });
    // products without sku never conflict
    await t.api.products.create({ name: "C" });
    await t.api.products.create({ name: "D", sku: "" });
    // update: keeping its own sku is fine, taking another's is not
    const b = await t.api.products.create({ name: "B", sku: "OTHER" });
    expect(await t.api.products.update({ ...b, sku: "OTHER", name: "B2" })).toMatchObject({ name: "B2" });
    expect((await apiError(() => t.api.products.update({ ...b, sku: "BT-55B24L" }))).code).toBe("CONFLICT");
    // soft delete frees the sku
    await t.api.products.remove(a.id);
    const again = await t.api.products.create({ name: "A (ใหม่)", sku: "BT-55B24L" });
    expect(again.sku).toBe("BT-55B24L");
  });

  it("update changes every field except stock", async () => {
    const batteries = await catId("แบตเตอรี่");
    const p = await t.api.products.create({ name: "GS MFX-50L", unit: "ลูก", costPrice: 165000, sellPrice: 220000, initialStock: 8 });
    const u = await t.api.products.update({
      id: p.id,
      name: "GS Battery MFX-50L",
      categoryId: batteries,
      brand: "GS",
      model: "MFX-50L",
      spec: "12V 45Ah",
      sku: "BT-GS-50L",
      barcode: "885000000001",
      unit: "ลูก",
      costPrice: 170000,
      sellPrice: 230000,
      minStock: 3,
      trackStock: true,
      isActive: false,
      note: "รับประกัน 1 ปี",
    });
    expect(u).toMatchObject({
      name: "GS Battery MFX-50L",
      categoryName: "แบตเตอรี่",
      model: "MFX-50L",
      spec: "12V 45Ah",
      costPrice: 170000,
      sellPrice: 230000,
      minStock: 3,
      isActive: false,
      note: "รับประกัน 1 ปี",
      stockQty: 8,
    });
    // clear optional fields
    const cleared = await t.api.products.update({ ...u, categoryId: null, brand: "", note: null });
    expect(cleared).toMatchObject({ categoryId: null, categoryName: null, brand: null, note: null, stockQty: 8 });
    expect((await apiError(() => t.api.products.update({ ...u, id: "missing" }))).code).toBe("NOT_FOUND");
  });

  it("remove hides the product from list/get but keeps its ledger", async () => {
    const p = await t.api.products.create({ name: "ลบฉัน", initialStock: 3 });
    await t.api.products.remove(p.id);
    expect((await t.api.products.list({ includeInactive: true })).items.map((x) => x.id)).not.toContain(p.id);
    expect((await apiError(() => t.api.products.get(p.id))).code).toBe("NOT_FOUND");
    expect((await apiError(() => t.api.products.remove(p.id))).code).toBe("NOT_FOUND");
    expect((await apiError(() => t.api.products.update({ id: p.id, name: "x" }))).code).toBe("NOT_FOUND");
    // stock card is still readable (history), deleted row stays in DB
    expect((await t.api.products.movements({ productId: p.id })).total).toBe(1);
    const row = t.sqlite.prepare("select deleted_at from products where id = ?").get(p.id) as { deleted_at: number | null };
    expect(row.deleted_at).toBeGreaterThan(0);
  });

  it("validates input with Thai messages", async () => {
    expect(await apiError(() => t.api.products.create({ name: "   " }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("กรุณากรอกชื่อสินค้า") });
    expect(await apiError(() => t.api.products.create({ name: "x", sellPrice: -100 }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("จำนวนเงินต้องไม่ติดลบ") });
    expect(await apiError(() => t.api.products.create({ name: "x", costPrice: 10.5 }))).toMatchObject({ code: "VALIDATION" });
    expect(await apiError(() => t.api.products.create({ name: "x", initialStock: -1 }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("ติดลบ") });
    expect(await apiError(() => t.api.products.create({ name: "x", initialStock: 1.234 }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("ทศนิยม") });
    expect(await apiError(() => t.api.products.create({ name: "x", unit: " " }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("กรุณาระบุหน่วย") });
    expect(await apiError(() => t.api.products.create(undefined as never))).toMatchObject({ code: "VALIDATION" });
  });
});

describe("products: stock", () => {
  it("adjusts stock up and down and records the reason", async () => {
    const p = await t.api.products.create({ name: "น้ำมันเครื่อง", unit: "ลิตร", costPrice: 25000, initialStock: 10 });
    const up = await t.api.products.adjustStock({ productId: p.id, qty: 2.5, note: "นับสต็อก" });
    expect(up.stockQty).toBe(12.5);
    const down = await t.api.products.adjustStock({ productId: p.id, qty: -13, note: "ของชำรุด" });
    expect(down.stockQty).toBe(-0.5); // negative stock is allowed (shown as a warning in the UI)
    const mv = await t.api.products.movements({ productId: p.id });
    expect(mv.items.map((m) => [m.type, m.qty, m.balance, m.note])).toEqual([
      ["adjust", -13, -0.5, "ของชำรุด"],
      ["adjust", 2.5, 12.5, "นับสต็อก"],
      ["initial", 10, 10, "ยอดยกมา"],
    ]);
    expect(mv.items[0].unitCost).toBe(25000);
    expect(ledgerMismatches()).toEqual([]);
  });

  it("rejects zero, bad decimals, untracked and missing products", async () => {
    const p = await t.api.products.create({ name: "x", initialStock: 1 });
    expect(await apiError(() => t.api.products.adjustStock({ productId: p.id, qty: 0 }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("ต้องไม่เป็น 0") });
    expect((await apiError(() => t.api.products.adjustStock({ productId: p.id, qty: 0.001 }))).code).toBe("VALIDATION");
    const service = await t.api.products.create({ name: "น้ำยาล้างรถ", trackStock: false });
    expect(await apiError(() => t.api.products.adjustStock({ productId: service.id, qty: 1 }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("ไม่นับสต็อก") });
    expect((await apiError(() => t.api.products.adjustStock({ productId: "missing", qty: 1 }))).code).toBe("NOT_FOUND");
    expect((await apiError(() => t.api.products.movements({ productId: "missing" }))).code).toBe("NOT_FOUND");
  });

  it("update keeps stock (never touches the ledger)", async () => {
    const p = await t.api.products.create({ name: "ยาง", initialStock: 7 });
    await t.api.products.adjustStock({ productId: p.id, qty: -2 });
    const u = await t.api.products.update({ ...p, name: "ยาง (แก้)", costPrice: 99900, trackStock: false });
    expect(u.stockQty).toBe(5);
    const u2 = await t.api.products.update({ ...u, trackStock: true });
    expect(u2.stockQty).toBe(5);
    expect((await t.api.products.movements({ productId: p.id })).total).toBe(2);
  });

  it("movements: running balance in chronological order, newest first, paged", async () => {
    const p = await t.api.products.create({ name: "ลูกหมาก", initialStock: 5 });
    const deltas = [3, -1, -2, 4, -6, 10, -1];
    for (const qty of deltas) await t.api.products.adjustStock({ productId: p.id, qty });
    // Out-of-order occurredAt: backdate the initial row further and add a movement dated in the past.
    t.sqlite.prepare("update stock_movements set occurred_at = occurred_at - 100000 where product_id = ? and type = 'initial'").run(p.id);
    const all = await t.api.products.movements({ productId: p.id, limit: 100 });
    expect(all.total).toBe(8);
    const chronological = [...all.items].reverse();
    let running = 0;
    for (const m of chronological) {
      running += m.qty;
      expect(m.balance).toBe(running);
    }
    expect(all.items[0].balance).toBe((await t.api.products.get(p.id)).stockQty);
    expect(all.items[0].balance).toBe(12);

    const page1 = await t.api.products.movements({ productId: p.id, limit: 3, offset: 0 });
    const page2 = await t.api.products.movements({ productId: p.id, limit: 3, offset: 3 });
    const page3 = await t.api.products.movements({ productId: p.id, limit: 3, offset: 6 });
    expect(page1.total).toBe(8);
    expect([...page1.items, ...page2.items, ...page3.items]).toEqual(all.items);
    expect(page3.items).toHaveLength(2);
    expect(page3.items[1].type).toBe("initial");
  });

  it("movements link to transactions (docNo + party) on demo data", async () => {
    await seedDemo(t.ctx);
    const p = (await t.api.products.list({ search: "Michelin Primacy" })).items[0];
    const mv = await t.api.products.movements({ productId: p.id, limit: 1000 });
    const sale = mv.items.find((m) => m.type === "sale");
    const purchase = mv.items.find((m) => m.type === "purchase");
    expect(sale?.docNo).toMatch(/^S\d{4}-\d{4}$/);
    expect(sale?.qty).toBeLessThan(0);
    expect(sale?.partyName).toBeTruthy();
    expect(purchase?.docNo).toMatch(/^P\d{4}-\d{4}$/);
    expect(purchase?.partyName).toContain("ไทยไทร์");
    expect(mv.items[0].balance).toBe(p.stockQty);
    expect(mv.items.at(-1)?.type).toBe("initial");
  });
});

describe("products: list / search / stats", () => {
  beforeEach(async () => {
    await seedDemo(t.ctx);
  });

  it("searches by tyre size in several notations", async () => {
    for (const q of ["205/55R16", "205/55r16", "2055516", "205/55/16", "205 55 16", "205-55-16"]) {
      const r = await t.api.products.list({ search: q });
      expect(r.items.map((p) => p.name), q).toContain("Michelin Primacy 4");
    }
    const r = await t.api.products.list({ search: "205/55R16" });
    expect(r.total).toBe(1);
  });

  it("searches by brand, sku, spec, multi-word (all words must match)", async () => {
    const bs = await t.api.products.list({ search: "bridgestone" });
    expect(bs.total).toBe(2);
    expect(bs.items.every((p) => p.brand === "Bridgestone")).toBe(true);
    expect((await t.api.products.list({ search: "bridgestone 18" })).items.map((p) => p.spec)).toEqual(["265/60R18 110H"]);
    expect((await t.api.products.list({ search: "12V 45Ah" })).total).toBe(2);
    expect((await t.api.products.list({ search: "BT-AM" })).items[0]?.name).toBe("Amaron Pro 55D23L");
    expect((await t.api.products.list({ search: "โช้คอัพ vios" })).total).toBe(1);
    expect((await t.api.products.list({ search: "ไม่มีสินค้านี้แน่นอน" })).total).toBe(0);
    // LIKE wildcards are literal
    expect((await t.api.products.list({ search: "%" })).total).toBe(0);
    expect((await t.api.products.list({ search: "_" })).total).toBe(0);
  });

  it("filters by category, uncategorised, low stock, inactive; pages and sorts", async () => {
    const batteries = await catId("แบตเตอรี่");
    const bat = await t.api.products.list({ categoryId: batteries });
    expect(bat.total).toBe(5);
    expect(bat.items.every((p) => p.categoryName === "แบตเตอรี่")).toBe(true);

    const loose = await t.api.products.create({ name: "ของไม่มีหมวด" });
    expect((await t.api.products.list({ categoryId: NO_CATEGORY })).items.map((p) => p.id)).toEqual([loose.id]);

    const low = await t.api.products.create({ name: "ใกล้หมด", minStock: 5, initialStock: 5 });
    const untracked = await t.api.products.create({ name: "ไม่นับ", minStock: 5, trackStock: false });
    const lowList = await t.api.products.list({ lowStockOnly: true, limit: 1000 });
    expect(lowList.items.map((p) => p.id)).toContain(low.id);
    expect(lowList.items.map((p) => p.id)).not.toContain(untracked.id);
    expect(lowList.items.every((p) => p.trackStock && p.stockQty <= p.minStock)).toBe(true);

    await t.api.products.update({ ...low, isActive: false });
    expect((await t.api.products.list({ search: "ใกล้หมด" })).total).toBe(0);
    expect((await t.api.products.list({ search: "ใกล้หมด", includeInactive: true })).total).toBe(1);

    const all = await t.api.products.list({ limit: 1000 });
    const page = await t.api.products.list({ limit: 10, offset: 10 });
    expect(page.total).toBe(all.total);
    expect(page.items.map((p) => p.id)).toEqual(all.items.slice(10, 20).map((p) => p.id));
    const names = all.items.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const byStock = await t.api.products.list({ sort: "stock", limit: 1000 });
    const tracked = byStock.items.filter((p) => p.trackStock);
    const qtys = tracked.map((p) => p.stockQty);
    expect(qtys).toEqual([...qtys].sort((a, b) => a - b));
    expect(byStock.items.slice(tracked.length).every((p) => !p.trackStock)).toBe(true);
  });

  it("stats: counts, stock value at cost and low-stock count", async () => {
    const list = await t.api.products.list({ limit: 1000, includeInactive: true });
    const s = await t.api.products.stats();
    expect(s.productCount).toBe(list.items.filter((p) => p.isActive).length);
    expect(s.inactiveCount).toBe(0);
    const expected = list.items.filter((p) => p.trackStock && p.stockQty > 0).reduce((sum, p) => sum + p.stockQty * p.costPrice, 0);
    expect(s.stockValue).toBe(Math.round(expected));
    expect(s.lowStockCount).toBe((await t.api.products.list({ lowStockOnly: true, limit: 1000 })).total);
    const cats = await t.api.categories.list();
    const tyres = cats.find((c) => c.name === "ยางรถยนต์")!;
    expect(s.byCategory.find((b) => b.categoryId === tyres.id)).toMatchObject({ activeCount: 9, totalCount: 9 });

    // negative stock does not reduce the value; inactive products are counted separately
    const neg = await t.api.products.create({ name: "ติดลบ", costPrice: 100000, initialStock: 1 });
    await t.api.products.adjustStock({ productId: neg.id, qty: -3 });
    await t.api.products.update({ ...neg, isActive: false });
    const s2 = await t.api.products.stats();
    expect(s2.stockValue).toBe(s.stockValue);
    expect(s2.inactiveCount).toBe(1);
    expect(s2.productCount).toBe(s.productCount);
    expect(s2.byCategory.find((b) => b.categoryId === null)).toMatchObject({ activeCount: 0, totalCount: 1 });
  });

  it("stats on an empty database", async () => {
    const empty = createTestApi({ seed: false });
    expect(await empty.api.products.stats()).toEqual({ productCount: 0, inactiveCount: 0, stockValue: 0, lowStockCount: 0, byCategory: [] });
    empty.close();
  });
});

describe("categories", () => {
  it("creates (appended at the end), renames, keeps order on rename, rejects duplicates", async () => {
    const before = await t.api.categories.list();
    const c = await t.api.categories.create({ name: "ล้อแม็ก" });
    expect(c.productCount).toBe(0);
    expect(c.sortOrder).toBe(Math.max(...before.map((x) => x.sortOrder)) + 1);
    expect((await t.api.categories.list()).at(-1)?.id).toBe(c.id);

    expect(await apiError(() => t.api.categories.create({ name: " ล้อแม็ก " }))).toMatchObject({ code: "CONFLICT", message: "มีหมวดหมู่ชื่อนี้อยู่แล้ว" });
    expect(await apiError(() => t.api.categories.create({ name: "" }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("กรุณากรอกชื่อหมวดหมู่") });

    const r = await t.api.categories.update({ id: c.id, name: "ล้อแม็ก / กระทะล้อ" });
    expect(r.name).toBe("ล้อแม็ก / กระทะล้อ");
    expect(r.sortOrder).toBe(c.sortOrder);
    // renaming to itself is fine; to another existing name is not
    await t.api.categories.update({ id: c.id, name: "ล้อแม็ก / กระทะล้อ" });
    expect((await apiError(() => t.api.categories.update({ id: c.id, name: "แบตเตอรี่" }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.categories.update({ id: "missing", name: "x" }))).code).toBe("NOT_FOUND");
    const explicit = await t.api.categories.update({ id: c.id, name: "ล้อแม็ก", sortOrder: -1 });
    expect((await t.api.categories.list())[0].id).toBe(explicit.id);
  });

  it("delete fails while products use it, succeeds after they are gone; name can be re-used", async () => {
    const c = await t.api.categories.create({ name: "ทดสอบ" });
    const p1 = await t.api.products.create({ name: "a", categoryId: c.id });
    await t.api.products.create({ name: "b", categoryId: c.id });
    expect((await t.api.categories.list()).find((x) => x.id === c.id)?.productCount).toBe(2);
    expect(await apiError(() => t.api.categories.remove(c.id))).toMatchObject({ code: "CONFLICT", message: "หมวดหมู่นี้ยังมีสินค้าอยู่ 2 รายการ" });
    await t.api.products.remove(p1.id);
    expect(await apiError(() => t.api.categories.remove(c.id))).toMatchObject({ message: "หมวดหมู่นี้ยังมีสินค้าอยู่ 1 รายการ" });
    const rest = (await t.api.products.list({ categoryId: c.id })).items;
    for (const p of rest) await t.api.products.update({ ...p, categoryId: null });
    await t.api.categories.remove(c.id);
    expect((await t.api.categories.list()).map((x) => x.id)).not.toContain(c.id);
    expect((await apiError(() => t.api.categories.remove(c.id))).code).toBe("NOT_FOUND");
    expect(await t.api.categories.create({ name: "ทดสอบ" })).toMatchObject({ name: "ทดสอบ" });
  });

  it("reorders by id list", async () => {
    const cats = await t.api.categories.list();
    const reversed = [...cats].reverse().map((c) => c.id);
    const r = await t.api.categories.reorder(reversed);
    expect(r.map((c) => c.id)).toEqual(reversed);
    expect(r.map((c) => c.sortOrder)).toEqual(reversed.map((_, i) => i));
    // partial list: listed ones first, others keep relative order after them
    const r2 = await t.api.categories.reorder([cats[2].id]);
    expect(r2[0].id).toBe(cats[2].id);
    expect(r2.slice(1).map((c) => c.id)).toEqual(reversed.filter((id) => id !== cats[2].id));
    expect((await apiError(() => t.api.categories.reorder([]))).code).toBe("VALIDATION");
  });
});

describe("service items", () => {
  it("CRUD with soft delete", async () => {
    const s = await t.api.serviceItems.create({ name: "เติมลมไนโตรเจน", code: "SV-N2", defaultPrice: 10000, unit: "ล้อ", note: "ฟรีสำหรับลูกค้าซื้อยาง" });
    expect(s).toMatchObject({ name: "เติมลมไนโตรเจน", code: "SV-N2", defaultPrice: 10000, unit: "ล้อ", isActive: true });
    const d = await t.api.serviceItems.create({ name: "ล้างรถ" });
    expect(d).toMatchObject({ unit: "ครั้ง", defaultPrice: 0, code: null, note: null });

    const u = await t.api.serviceItems.update({ ...s, defaultPrice: 5000, isActive: false, note: "" });
    expect(u).toMatchObject({ defaultPrice: 5000, isActive: false, note: null });
    expect((await t.api.serviceItems.get(s.id)).defaultPrice).toBe(5000);
    expect((await t.api.serviceItems.list({ search: "ไนโตรเจน" })).total).toBe(0);
    expect((await t.api.serviceItems.list({ search: "ไนโตรเจน", includeInactive: true })).total).toBe(1);

    await t.api.serviceItems.remove(s.id);
    expect((await t.api.serviceItems.list({ includeInactive: true, limit: 1000 })).items.map((x) => x.id)).not.toContain(s.id);
    expect((await apiError(() => t.api.serviceItems.get(s.id))).code).toBe("NOT_FOUND");
    expect((await apiError(() => t.api.serviceItems.update({ ...s }))).code).toBe("NOT_FOUND");
    expect((await apiError(() => t.api.serviceItems.remove(s.id))).code).toBe("NOT_FOUND");
  });

  it("code is unique among non-deleted services", async () => {
    const a = await t.api.serviceItems.create({ name: "ก", code: "SV-1" });
    expect(await apiError(() => t.api.serviceItems.create({ name: "ข", code: "sv-1" }))).toMatchObject({ code: "CONFLICT", message: "รหัสบริการนี้มีอยู่แล้ว" });
    const b = await t.api.serviceItems.create({ name: "ข", code: "SV-2" });
    expect((await apiError(() => t.api.serviceItems.update({ ...b, code: "SV-1" }))).code).toBe("CONFLICT");
    await t.api.serviceItems.update({ ...a, name: "ก (แก้)" });
    await t.api.serviceItems.remove(a.id);
    expect(await t.api.serviceItems.update({ ...b, code: "SV-1" })).toMatchObject({ code: "SV-1" });
  });

  it("searches name / code / note with multiple words, sorted by name", async () => {
    await t.api.serviceItems.create({ name: "ปะยางรถบรรทุก", code: "TRK-01", note: "ยางใหญ่" });
    expect((await t.api.serviceItems.list({ search: "ปะยาง" })).items.map((s) => s.name)).toEqual(["ปะยาง", "ปะยางรถบรรทุก"]);
    expect((await t.api.serviceItems.list({ search: "trk" })).total).toBe(1);
    expect((await t.api.serviceItems.list({ search: "ยางใหญ่" })).total).toBe(1);
    expect((await t.api.serviceItems.list({ search: "ตรวจ แบต" })).items.map((s) => s.name)).toEqual(["ตรวจเช็คแบตเตอรี่ / ระบบไฟชาร์จ"]);
    const all = await t.api.serviceItems.list({});
    expect(all.total).toBe(11);
    const page = await t.api.serviceItems.list({ limit: 4, offset: 4 });
    expect(page.items.map((s) => s.id)).toEqual(all.items.slice(4, 8).map((s) => s.id));
  });

  it("validates input", async () => {
    expect(await apiError(() => t.api.serviceItems.create({ name: "" }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("กรุณากรอกชื่อบริการ") });
    expect(await apiError(() => t.api.serviceItems.create({ name: "x", defaultPrice: -1 }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("ติดลบ") });
    expect(await apiError(() => t.api.serviceItems.create({ name: "x", defaultPrice: 1.5 }))).toMatchObject({ code: "VALIDATION" });
    expect(await apiError(() => t.api.serviceItems.create({ name: "x", unit: "" }))).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("กรุณาระบุหน่วย") });
  });
});

describe("edge cases", () => {
  it("search also matches the category name (combined with other words)", async () => {
    await seedDemo(t.ctx);
    const batteries = await catId("แบตเตอรี่");
    const inCat = await t.api.products.list({ categoryId: batteries, search: "55", limit: 1000 });
    const byName = await t.api.products.list({ search: "แบตเตอรี่ 55", limit: 1000 });
    expect(inCat.total).toBeGreaterThan(0);
    expect(byName.items.map((p) => p.id).sort()).toEqual(inCat.items.map((p) => p.id).sort());
    expect(byName.total).toBe(byName.items.length);
    // whole category by (partial) name
    expect((await t.api.products.list({ search: "แบตเตอ", limit: 1000 })).total).toBeGreaterThanOrEqual(5);
    // uncategorised products are still found by their own fields
    const loose = await t.api.products.create({ name: "ฝาครอบจุ๊บ" });
    expect((await t.api.products.list({ search: "ฝาครอบ" })).items.map((p) => p.id)).toEqual([loose.id]);
  });

  it("whitespace-only search returns everything; paging input is validated", async () => {
    await seedDemo(t.ctx);
    const all = await t.api.products.list({});
    expect((await t.api.products.list({ search: "   " })).total).toBe(all.total);
    expect((await apiError(() => t.api.products.list({ limit: 0 }))).code).toBe("VALIDATION");
    expect((await apiError(() => t.api.products.list({ offset: -1 }))).code).toBe("VALIDATION");
    expect((await apiError(() => t.api.products.movements({ productId: "" }))).code).toBe("VALIDATION");
    const beyond = await t.api.products.list({ offset: 10_000 });
    expect(beyond).toEqual({ items: [], total: all.total });
  });

  it("sort by stock puts products that don't track stock last", async () => {
    const a = await t.api.products.create({ name: "A", initialStock: 3 });
    const b = await t.api.products.create({ name: "B", trackStock: false });
    const c = await t.api.products.create({ name: "C", initialStock: 1 });
    const d = await t.api.products.create({ name: "D" });
    const r = await t.api.products.list({ sort: "stock" });
    expect(r.items.map((p) => p.id)).toEqual([d.id, c.id, a.id, b.id]);
  });

  it("empty categoryId means no category; a deleted category cannot be assigned on update", async () => {
    const p = await t.api.products.create({ name: "x", categoryId: "" });
    expect(p.categoryId).toBeNull();
    const c = await t.api.categories.create({ name: "ชั่วคราว" });
    await t.api.categories.remove(c.id);
    expect((await apiError(() => t.api.products.update({ ...p, categoryId: c.id }))).code).toBe("NOT_FOUND");
    expect((await t.api.products.get(p.id)).categoryId).toBeNull();
  });

  it("fractional adjustments add up exactly (no float drift) in stock and running balance", async () => {
    const p = await t.api.products.create({ name: "น้ำมันเกียร์", unit: "ลิตร", initialStock: 0.1 });
    await t.api.products.adjustStock({ productId: p.id, qty: 0.2 });
    await t.api.products.adjustStock({ productId: p.id, qty: 0.7 });
    const r = await t.api.products.adjustStock({ productId: p.id, qty: -1 });
    expect(r.stockQty).toBe(0);
    const mv = await t.api.products.movements({ productId: p.id });
    expect(mv.items.map((m) => m.balance)).toEqual([0, 1, 0.3, 0.1]);
  });

  it("movements at the same timestamp keep creation order for the running balance", async () => {
    const p = await t.api.products.create({ name: "x", initialStock: 10 });
    for (const qty of [-1, -2, 5]) await t.api.products.adjustStock({ productId: p.id, qty });
    t.sqlite.prepare("update stock_movements set occurred_at = 1700000000000 where product_id = ?").run(p.id);
    const mv = await t.api.products.movements({ productId: p.id });
    expect(mv.items.map((m) => [m.qty, m.balance])).toEqual([
      [5, 12],
      [-2, 7],
      [-1, 9],
      [10, 10],
    ]);
  });

  it("adjust: empty note becomes null; deleted products cannot be adjusted", async () => {
    const p = await t.api.products.create({ name: "x", initialStock: 1 });
    await t.api.products.adjustStock({ productId: p.id, qty: 1, note: "   " });
    expect((await t.api.products.movements({ productId: p.id })).items[0].note).toBeNull();
    await t.api.products.remove(p.id);
    expect((await apiError(() => t.api.products.adjustStock({ productId: p.id, qty: 1 }))).code).toBe("NOT_FOUND");
    expect(ledgerMismatches()).toEqual([]);
  });

  it("an untracked product may be created with opening stock (kept in the ledger)", async () => {
    const p = await t.api.products.create({ name: "x", trackStock: false, initialStock: 4 });
    expect(p.stockQty).toBe(4);
    expect((await t.api.products.list({ lowStockOnly: true })).items.map((x) => x.id)).not.toContain(p.id);
  });

  it("stats ignore deleted products", async () => {
    const p = await t.api.products.create({ name: "x", costPrice: 12345, initialStock: 2, minStock: 5 });
    const before = await t.api.products.stats();
    expect(before).toMatchObject({ productCount: 1, stockValue: 24690, lowStockCount: 1 });
    await t.api.products.remove(p.id);
    expect(await t.api.products.stats()).toMatchObject({ productCount: 0, inactiveCount: 0, stockValue: 0, lowStockCount: 0, byCategory: [] });
  });

  it("category names: max length, case-insensitive duplicates, trimmed", async () => {
    expect((await apiError(() => t.api.categories.create({ name: "ก".repeat(101) }))).code).toBe("VALIDATION");
    const c = await t.api.categories.create({ name: "  Wheels  " });
    expect(c.name).toBe("Wheels");
    expect((await apiError(() => t.api.categories.create({ name: "WHEELS" }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.categories.remove("missing"))).code).toBe("NOT_FOUND");
    // reorder ignores unknown / duplicate ids
    const cats = await t.api.categories.list();
    const r = await t.api.categories.reorder([c.id, "missing", c.id]);
    expect(r[0].id).toBe(c.id);
    expect(r).toHaveLength(cats.length);
  });

  it("services: code can be cleared, wildcards are literal, get of a deleted one fails", async () => {
    const s = await t.api.serviceItems.create({ name: "เปลี่ยนน้ำมันเบรก 100%", code: "SV-BRK" });
    const u = await t.api.serviceItems.update({ ...s, code: "  " });
    expect(u.code).toBeNull();
    expect((await t.api.serviceItems.list({ search: "100%" })).items.map((x) => x.id)).toEqual([s.id]);
    expect((await t.api.serviceItems.list({ search: "%" })).items.map((x) => x.id)).toEqual([s.id]);
    expect((await t.api.serviceItems.list({ search: "_" })).total).toBe(0);
    expect((await apiError(() => t.api.serviceItems.create({ name: "x", unit: "ห".repeat(31) }))).code).toBe("VALIDATION");
    expect((await apiError(() => t.api.serviceItems.get(""))).code).toBe("VALIDATION");
  });
});
