/**
 * Sales & purchases: the core of the app. Every scenario also checks the stock-ledger invariant
 * products.stock_qty == SUM(stock_movements.qty) (see afterEach).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiError, LineItemInput, SettingsPatch, TransactionInput } from "@shared/contract";
import { seedDemo } from "../electron/dev/demo-seed";
import { toApiError } from "../electron/api/errors";
import { recomputeStock } from "../electron/api/stock";
import { newId } from "../electron/api/util";
import { customers, products, stockMovements } from "../electron/db/schema";
import { createTestApi } from "./helpers/db";

type T = ReturnType<typeof createTestApi>;
let t: T;

beforeEach(() => {
  t = createTestApi();
});

afterEach(() => {
  expectLedgerConsistent(t);
  t.close();
});

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const B = (baht: number) => Math.round(baht * 100);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A fixed local-time moment: 15 Sep 2026 10:00 (BE 2569). */
const SEP15 = new Date(2026, 8, 15, 10, 0, 0).getTime();

function expectLedgerConsistent(x: T) {
  const bad = x.sqlite
    .prepare(
      "select p.id, p.stock_qty, (select coalesce(sum(qty),0) from stock_movements m where m.product_id = p.id) as ledger from products p where abs(p.stock_qty - (select coalesce(sum(qty),0) from stock_movements m where m.product_id = p.id)) > 0.0001",
    )
    .all();
  expect(bad).toEqual([]);
}

function addProduct(
  x: T,
  p: { name?: string; spec?: string | null; unit?: string; cost?: number; sell?: number; stock?: number; trackStock?: boolean; deleted?: boolean } = {},
) {
  const id = newId();
  const at = SEP15 - 30 * DAY;
  x.db
    .insert(products)
    .values({
      id,
      name: p.name ?? "ยางทดสอบ",
      spec: p.spec === undefined ? "205/55R16" : p.spec,
      unit: p.unit ?? "เส้น",
      costPrice: B(p.cost ?? 2000),
      sellPrice: B(p.sell ?? 3000),
      trackStock: p.trackStock ?? true,
      createdAt: at,
      updatedAt: at,
      deletedAt: p.deleted ? at : null,
    })
    .run();
  if (p.stock) {
    x.db.insert(stockMovements).values({ id: newId(), productId: id, type: "initial", qty: p.stock, unitCost: B(p.cost ?? 2000), occurredAt: at, createdAt: at, updatedAt: at }).run();
    recomputeStock(x.db, id);
  }
  return id;
}

function addCustomer(x: T, c: { name?: string; phone?: string | null; deleted?: boolean } = {}) {
  const id = newId();
  x.db
    .insert(customers)
    .values({ id, name: c.name ?? "สมชาย ใจดี", phone: c.phone === undefined ? "081-234-5678" : c.phone, createdAt: SEP15, updatedAt: SEP15, deletedAt: c.deleted ? SEP15 : null })
    .run();
  return id;
}

function product(x: T, id: string) {
  return x.sqlite.prepare("select * from products where id = ?").get(id) as { stock_qty: number; cost_price: number; updated_at: number };
}
const stockOf = (x: T, id: string) => product(x, id).stock_qty;
const costOf = (x: T, id: string) => product(x, id).cost_price;

function movementsOf(x: T, transactionId: string) {
  return x.sqlite.prepare("select * from stock_movements where transaction_id = ? order by qty").all(transactionId) as {
    product_id: string;
    qty: number;
    type: string;
    unit_cost: number;
    transaction_item_id: string;
    occurred_at: number;
  }[];
}

const count = (x: T, table: string) => (x.sqlite.prepare(`select count(*) n from ${table}`).get() as { n: number }).n;

const serviceId = async (x: T, name = "ถ่วงล้อ") => (await x.api.serviceItems.list({ search: name })).items[0].id;

const P = (productId: string, qty: number, unitPrice: number, extra: Partial<LineItemInput> = {}): LineItemInput => ({ itemType: "product", productId, qty, unitPrice, ...extra });

function sale(items: LineItemInput[], extra: Partial<TransactionInput> = {}): TransactionInput {
  return { type: "sale", occurredAt: SEP15, items, ...extra };
}
function purchase(items: LineItemInput[], extra: Partial<TransactionInput> = {}): TransactionInput {
  return { type: "purchase", occurredAt: SEP15, contactName: "บจก. ไทยไทร์", items, ...extra };
}

/** Runs fn and returns the error as the renderer would see it (AppError / ZodError / SQLite mapped). */
async function failure(fn: () => unknown): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    return toApiError(e);
  }
  throw new Error("expected the call to fail");
}

const setSettings = (x: T, patch: SettingsPatch) => x.api.settings.update(patch);

// ---------------------------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------------------------

describe("sales", () => {
  it("reduces stock, snapshots unit cost and writes one movement per product line", async () => {
    const tyre = addProduct(t, { cost: 2000, sell: 3000, stock: 10 });
    const bill = await t.api.transactions.create(sale([P(tyre, 4, B(3000))]));
    expect(bill.type).toBe("sale");
    expect(bill.status).toBe("completed");
    expect(stockOf(t, tyre)).toBe(6);
    expect(bill.items[0]).toMatchObject({ lineNo: 1, itemType: "product", productId: tyre, qty: 4, unitPrice: B(3000), unitCost: B(2000), total: B(12000) });
    expect(bill.costTotal).toBe(B(8000));
    const mv = movementsOf(t, bill.id);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ product_id: tyre, qty: -4, type: "sale", unit_cost: B(2000), transaction_item_id: bill.items[0].id, occurred_at: SEP15 });

    // A later purchase changes the product cost; the old sale keeps its snapshot.
    await t.api.transactions.create(purchase([P(tyre, 2, B(2500))], { occurredAt: SEP15 + DAY }));
    expect(costOf(t, tyre)).toBe(B(2500));
    const again = await t.api.transactions.get(bill.id);
    expect(again.items[0].unitCost).toBe(B(2000));
    // A new sale snapshots the new cost.
    const bill2 = await t.api.transactions.create(sale([P(tyre, 1, B(3000))], { occurredAt: SEP15 + 2 * DAY }));
    expect(bill2.items[0].unitCost).toBe(B(2500));
    expect(stockOf(t, tyre)).toBe(7);
  });

  it("honours an overridden unit price and uses the catalog name/unit when blank", async () => {
    const tyre = addProduct(t, { name: "Michelin Primacy 4", spec: "205/55R16 91V", unit: "เส้น", sell: 3650, stock: 8 });
    const bill = await t.api.transactions.create(sale([P(tyre, 2, B(3400))]));
    expect(bill.items[0]).toMatchObject({ unitPrice: B(3400), total: B(6800), name: "Michelin Primacy 4 205/55R16 91V", unit: "เส้น" });
    expect(bill.total).toBe(B(6800));

    const named = await t.api.transactions.create(sale([P(tyre, 1, B(3650), { name: "  ยางหน้า  ", unit: "ล้อ" })]));
    expect(named.items[0]).toMatchObject({ name: "ยางหน้า", unit: "ล้อ" });

    const noSpec = addProduct(t, { name: "จุ๊บลม", spec: null, unit: "ชุด", stock: 5 });
    const b3 = await t.api.transactions.create(sale([P(noSpec, 1, B(100))]));
    expect(b3.items[0].name).toBe("จุ๊บลม");
  });

  it("applies line and bill discounts (clamped) with shared calc", async () => {
    const a = addProduct(t, { stock: 10 });
    const b = addProduct(t, { stock: 10 });
    const bill = await t.api.transactions.create(
      sale([P(a, 4, B(1000), { discount: B(200) }), P(b, 1.5, 333, { discount: 0 }), { itemType: "custom", name: "ค่าแรง", qty: 1, unitPrice: B(100), discount: B(500) }], { discount: B(300) }),
    );
    expect(bill.items.map((i) => i.total)).toEqual([B(3800), 500, 0]);
    expect(bill.items[2].discount).toBe(B(100)); // clamped to the line gross
    expect(bill.subtotal).toBe(B(3800) + 500);
    expect(bill.discount).toBe(B(300));
    expect(bill.total).toBe(B(3800) + 500 - B(300));

    const over = await t.api.transactions.create(sale([P(a, 1, B(100))], { discount: B(999) }));
    expect(over.discount).toBe(B(100));
    expect(over.total).toBe(0);
    expect(stockOf(t, a)).toBe(5);
    expect(stockOf(t, b)).toBe(8.5);
  });

  it("stores VAT none / inclusive / exclusive correctly", async () => {
    const p = addProduct(t, { stock: 100 });
    const none = await t.api.transactions.create(sale([P(p, 1, 10700)], { vatMode: "none", vatRate: 7 }));
    expect(none).toMatchObject({ vatMode: "none", vatRate: 0, vatAmount: 0, subtotal: 10700, total: 10700 });

    const inc = await t.api.transactions.create(sale([P(p, 1, 10700)], { vatMode: "inclusive" }));
    expect(inc).toMatchObject({ vatMode: "inclusive", vatRate: 7, vatAmount: 700, subtotal: 10700, total: 10700 });

    const exc = await t.api.transactions.create(sale([P(p, 2, 5000)], { vatMode: "exclusive", discount: 0 }));
    expect(exc).toMatchObject({ vatMode: "exclusive", vatRate: 7, vatAmount: 700, subtotal: 10000, total: 10700 });

    // explicit rate wins over settings; settings rate is used when omitted
    const custom = await t.api.transactions.create(sale([P(p, 1, 10000)], { vatMode: "exclusive", vatRate: 10 }));
    expect(custom).toMatchObject({ vatRate: 10, vatAmount: 1000, total: 11000 });
    await setSettings(t, { tax: { vatRate: 5 } });
    const fromSettings = await t.api.transactions.create(sale([P(p, 1, 10000)], { vatMode: "exclusive" }));
    expect(fromSettings).toMatchObject({ vatRate: 5, vatAmount: 500, total: 10500 });

    // inclusive VAT with a bill discount: VAT is taken from the discounted amount
    const incDisc = await t.api.transactions.create(sale([P(p, 1, 11700)], { vatMode: "inclusive", vatRate: 7, discount: 1000 }));
    expect(incDisc).toMatchObject({ subtotal: 11700, discount: 1000, total: 10700, vatAmount: 700 });
  });

  it("services and custom lines never touch stock; trackStock=false products write no movement", async () => {
    const svc = await serviceId(t, "ถ่วงล้อ");
    const noTrack = addProduct(t, { name: "น้ำยาล้างล้อ", trackStock: false });
    const bill = await t.api.transactions.create(
      sale([
        { itemType: "service", serviceItemId: svc, qty: 4, unitPrice: B(100) },
        { itemType: "custom", name: "ค่าแรงพิเศษ", unit: "งาน", qty: 1, unitPrice: B(250) },
        P(noTrack, 2, B(50)),
      ]),
    );
    expect(bill.items.map((i) => i.itemType)).toEqual(["service", "custom", "product"]);
    expect(bill.items[0]).toMatchObject({ name: "ถ่วงล้อ", unit: "ล้อ", serviceItemId: svc, productId: null, unitCost: 0, total: B(400) });
    expect(bill.items[1]).toMatchObject({ name: "ค่าแรงพิเศษ", unit: "งาน", productId: null, serviceItemId: null, unitCost: 0 });
    expect(bill.items[2]).toMatchObject({ productId: noTrack, unitCost: B(2000) });
    expect(movementsOf(t, bill.id)).toEqual([]);
    expect(count(t, "stock_movements")).toBe(0);
    expect(stockOf(t, noTrack)).toBe(0);
    expect(bill.total).toBe(B(400 + 250 + 100));
  });

  it("validates lines: custom needs a name, service must exist, product must exist and not be deleted", async () => {
    expect((await failure(() => t.api.transactions.create(sale([{ itemType: "custom", name: "  ", qty: 1, unitPrice: 100 }])))).message).toContain("กรุณากรอกชื่อรายการ");
    expect((await failure(() => t.api.transactions.create(sale([])))).message).toContain("ต้องมีอย่างน้อย 1 รายการ");
    expect((await failure(() => t.api.transactions.create(sale([{ itemType: "product", qty: 1, unitPrice: 100 }])))).message).toContain("กรุณาเลือกสินค้า");
    expect((await failure(() => t.api.transactions.create(sale([{ itemType: "service", serviceItemId: "nope", qty: 1, unitPrice: 100 }])))).code).toBe("VALIDATION");
    expect((await failure(() => t.api.transactions.create(sale([P("nope", 1, 100)])))).message).toContain("ไม่พบสินค้า");
    const gone = addProduct(t, { name: "ยางเลิกขาย", spec: null, deleted: true });
    const err = await failure(() => t.api.transactions.create(sale([P(gone, 1, 100)])));
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toContain("สินค้า \"ยางเลิกขาย\" ถูกลบแล้ว");
    const p = addProduct(t, { stock: 1 });
    expect((await failure(() => t.api.transactions.create(sale([P(p, 0, 100)])))).message).toContain("จำนวนต้องมากกว่า 0");
    expect((await failure(() => t.api.transactions.create(sale([P(p, 1.234, 100)])))).code).toBe("VALIDATION");
    expect((await failure(() => t.api.transactions.create(sale([P(p, 1, -5)])))).code).toBe("VALIDATION");
    expect((await failure(() => t.api.transactions.create(sale([P(p, 1, 10.5)])))).code).toBe("VALIDATION");
    expect(count(t, "transactions")).toBe(0);
  });

  it("snapshots the customer name/phone unless given, and rejects unknown or deleted customers", async () => {
    const c = addCustomer(t, { name: "วิภาวรรณ ศรีสุข", phone: "089-765-4321" });
    const p = addProduct(t, { stock: 5 });
    const b1 = await t.api.transactions.create(sale([P(p, 1, 100)], { customerId: c }));
    expect(b1).toMatchObject({ customerId: c, contactName: "วิภาวรรณ ศรีสุข", contactPhone: "089-765-4321" });
    expect(b1.customer?.name).toBe("วิภาวรรณ ศรีสุข");

    const b2 = await t.api.transactions.create(sale([P(p, 1, 100)], { customerId: c, contactName: "คุณวิภา (ภรรยา)", contactPhone: "02-111-2222" }));
    expect(b2).toMatchObject({ contactName: "คุณวิภา (ภรรยา)", contactPhone: "02-111-2222" });

    const walkIn = await t.api.transactions.create(sale([P(p, 1, 100)], { customerId: "", contactName: "ลูกค้าหน้าร้าน" }));
    expect(walkIn).toMatchObject({ customerId: null, customer: null, contactName: "ลูกค้าหน้าร้าน", contactPhone: null });

    expect((await failure(() => t.api.transactions.create(sale([P(p, 1, 100)], { customerId: "missing" })))).code).toBe("VALIDATION");
    const gone = addCustomer(t, { deleted: true });
    expect((await failure(() => t.api.transactions.create(sale([P(p, 1, 100)], { customerId: gone })))).message).toContain("ไม่พบลูกค้า");
    expect(stockOf(t, p)).toBe(2);
  });

  it("stores vehicle, payment and note fields", async () => {
    const svc = await serviceId(t, "ปะยาง");
    const bill = await t.api.transactions.create(
      sale([{ itemType: "service", serviceItemId: svc, qty: 1, unitPrice: B(150) }], {
        vehiclePlate: " กข 1234 กรุงเทพมหานคร ",
        vehicleModel: "Toyota Vios",
        mileage: 123456,
        paymentMethod: "credit",
        paymentStatus: "unpaid",
        note: "ชำระสิ้นเดือน",
      }),
    );
    expect(bill).toMatchObject({ vehiclePlate: "กข 1234 กรุงเทพมหานคร", vehicleModel: "Toyota Vios", mileage: 123456, paymentMethod: "credit", paymentStatus: "unpaid", note: "ชำระสิ้นเดือน" });
    expect(bill.createdAt).toBe(bill.updatedAt);
  });
});

// ---------------------------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------------------------

describe("purchases", () => {
  it("increases stock, records unit cost = unit price and updates the product cost", async () => {
    const tyre = addProduct(t, { cost: 2000, stock: 2 });
    const bill = await t.api.transactions.create(purchase([P(tyre, 8, B(2100))]));
    expect(stockOf(t, tyre)).toBe(10);
    expect(costOf(t, tyre)).toBe(B(2100));
    expect(bill.items[0]).toMatchObject({ unitCost: B(2100), total: B(16800) });
    expect(bill.costTotal).toBe(0);
    expect(bill.contactName).toBe("บจก. ไทยไทร์");
    expect(movementsOf(t, bill.id)[0]).toMatchObject({ qty: 8, type: "purchase", unit_cost: B(2100) });
  });

  it("does NOT update cost when an older-dated purchase is entered after a newer one", async () => {
    const tyre = addProduct(t, { cost: 2000 });
    await t.api.transactions.create(purchase([P(tyre, 4, B(2300))], { occurredAt: SEP15 }));
    expect(costOf(t, tyre)).toBe(B(2300));
    const older = await t.api.transactions.create(purchase([P(tyre, 4, B(1900))], { occurredAt: SEP15 - 5 * DAY }));
    expect(costOf(t, tyre)).toBe(B(2300));
    expect(stockOf(t, tyre)).toBe(8);
    // same timestamp: the bill entered last wins
    await t.api.transactions.create(purchase([P(tyre, 1, B(2400))], { occurredAt: SEP15 }));
    expect(costOf(t, tyre)).toBe(B(2400));
    // editing the older purchase to a later date makes it the latest
    await t.api.transactions.update({ ...purchase([P(tyre, 4, B(1950))], { occurredAt: SEP15 + DAY }), id: older.id });
    expect(costOf(t, tyre)).toBe(B(1950));
  });

  it("falls back to the previous purchase price when the latest purchase is voided or loses the product", async () => {
    const tyre = addProduct(t, { cost: 2000 });
    const other = addProduct(t, { cost: 500 });
    await t.api.transactions.create(purchase([P(tyre, 4, B(2200))], { occurredAt: SEP15 - DAY }));
    const latest = await t.api.transactions.create(purchase([P(tyre, 4, B(22000)), P(other, 1, B(600))], { occurredAt: SEP15 })); // typo price
    expect(costOf(t, tyre)).toBe(B(22000));
    // fix by removing the product from the latest purchase -> cost goes back to 2,200
    await t.api.transactions.update({ ...purchase([P(other, 1, B(600))], { occurredAt: SEP15 }), id: latest.id });
    expect(costOf(t, tyre)).toBe(B(2200));
    expect(stockOf(t, tyre)).toBe(4);
    // void -> other's cost falls back? there is no other purchase of it: keep the last known cost
    await t.api.transactions.void({ id: latest.id });
    expect(costOf(t, other)).toBe(B(600));
    expect(stockOf(t, other)).toBe(0);

    const again = await t.api.transactions.create(purchase([P(tyre, 2, B(2500))], { occurredAt: SEP15 + DAY }));
    expect(costOf(t, tyre)).toBe(B(2500));
    await t.api.transactions.void({ id: again.id, reason: "ใส่ผิด" });
    expect(costOf(t, tyre)).toBe(B(2200));
  });

  it("keeps the product cost when updateCostOnPurchase is off", async () => {
    await setSettings(t, { inventory: { updateCostOnPurchase: false } });
    const tyre = addProduct(t, { cost: 2000 });
    await t.api.transactions.create(purchase([P(tyre, 4, B(2600))]));
    expect(costOf(t, tyre)).toBe(B(2000));
    expect(stockOf(t, tyre)).toBe(4);
  });

  it("uses the last line's price when a purchase has the same product twice", async () => {
    const tyre = addProduct(t, { cost: 2000 });
    await t.api.transactions.create(purchase([P(tyre, 4, B(2100)), P(tyre, 2, B(2150))]));
    expect(costOf(t, tyre)).toBe(B(2150));
    expect(stockOf(t, tyre)).toBe(6);
  });

  it("purchase with services / custom lines records their cost but no stock", async () => {
    const svc = await serviceId(t, "ตั้งศูนย์ล้อ");
    const bill = await t.api.transactions.create(purchase([{ itemType: "service", serviceItemId: svc, qty: 1, unitPrice: B(300) }, { itemType: "custom", name: "ค่าขนส่ง", qty: 1, unitPrice: B(150) }]));
    expect(bill.items.map((i) => i.unitCost)).toEqual([B(300), B(150)]);
    expect(count(t, "stock_movements")).toBe(0);
    expect(bill.total).toBe(B(450));
  });
});

// ---------------------------------------------------------------------------------------------
// Editing & voiding
// ---------------------------------------------------------------------------------------------

describe("edit", () => {
  it("edit sale changing qty and swapping a product keeps both products' stock correct", async () => {
    const a = addProduct(t, { name: "A", cost: 1000, stock: 10 });
    const b = addProduct(t, { name: "B", cost: 500, stock: 10 });
    const c = addProduct(t, { name: "C", cost: 700, stock: 10 });
    const svc = await serviceId(t);
    const bill = await t.api.transactions.create(sale([P(a, 2, B(1500)), P(b, 3, B(800)), { itemType: "service", serviceItemId: svc, qty: 1, unitPrice: B(100) }]));
    expect([stockOf(t, a), stockOf(t, b), stockOf(t, c)]).toEqual([8, 7, 10]);

    // product cost changes between creation and edit
    await t.api.transactions.create(purchase([P(a, 1, B(1200)), P(c, 1, B(900))], { occurredAt: SEP15 - HOUR }));
    expect([stockOf(t, a), stockOf(t, c)]).toEqual([9, 11]);

    const edited = await t.api.transactions.update({ ...sale([P(a, 5, B(1400)), P(c, 1, B(1200))], { occurredAt: SEP15 + HOUR, note: "แก้ไข" }), id: bill.id });
    expect([stockOf(t, a), stockOf(t, b), stockOf(t, c)]).toEqual([9 + 2 - 5, 10, 10]);
    expect(edited.docNo).toBe(bill.docNo);
    expect(edited.createdAt).toBe(bill.createdAt);
    expect(edited.updatedAt).toBeGreaterThanOrEqual(bill.updatedAt);
    expect(edited.occurredAt).toBe(SEP15 + HOUR);
    expect(edited.items).toHaveLength(2);
    expect(edited.items.map((i) => i.lineNo)).toEqual([1, 2]);
    // A was on the original bill: keeps its original cost snapshot; C is new: current cost
    expect(edited.items[0].unitCost).toBe(B(1000));
    expect(edited.items[1].unitCost).toBe(B(900));
    expect(edited.total).toBe(B(7000 + 1200));
    expect(edited.note).toBe("แก้ไข");
    const mv = movementsOf(t, bill.id);
    expect(mv.map((m) => [m.product_id, m.qty, m.occurred_at])).toEqual([
      [a, -5, SEP15 + HOUR],
      [c, -1, SEP15 + HOUR],
    ]);
    expect(count(t, "transaction_items")).toBe(2 + 2); // old items replaced (+2 lines of the purchase)
  });

  it("edit purchase changes stock and cost", async () => {
    const a = addProduct(t, { cost: 1000, stock: 1 });
    const b = addProduct(t, { cost: 500 });
    const bill = await t.api.transactions.create(purchase([P(a, 10, B(1100))]));
    expect(stockOf(t, a)).toBe(11);
    const edited = await t.api.transactions.update({ ...purchase([P(a, 6, B(1050)), P(b, 3, B(450))], { contactName: "หจก. แบตเตอรี่เซ็นเตอร์" }), id: bill.id });
    expect(stockOf(t, a)).toBe(7);
    expect(stockOf(t, b)).toBe(3);
    expect(costOf(t, a)).toBe(B(1050));
    expect(costOf(t, b)).toBe(B(450));
    expect(edited.contactName).toBe("หจก. แบตเตอรี่เซ็นเตอร์");
    expect(edited.docNo).toBe(bill.docNo);
  });

  it("cannot change the bill type, edit a missing bill, or edit a void bill", async () => {
    const p = addProduct(t, { stock: 5 });
    const bill = await t.api.transactions.create(sale([P(p, 1, 100)]));
    expect((await failure(() => t.api.transactions.update({ ...purchase([P(p, 1, 100)]), id: bill.id }))).message).toContain("ประเภทบิล");
    expect((await failure(() => t.api.transactions.update({ ...sale([P(p, 1, 100)]), id: "missing" }))).code).toBe("NOT_FOUND");
    await t.api.transactions.void({ id: bill.id, reason: "ทดสอบ" });
    const err = await failure(() => t.api.transactions.update({ ...sale([P(p, 1, 100)]), id: bill.id }));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toContain("ยกเลิก");
    expect(stockOf(t, p)).toBe(5);
  });

  it("an edit can keep lines whose product/service/customer was deleted after the sale (e.g. mark as paid)", async () => {
    const p = addProduct(t, { cost: 1000, stock: 5 });
    const cust = addCustomer(t);
    const svc = await serviceId(t, "ปะยาง");
    const bill = await t.api.transactions.create(sale([P(p, 2, B(1500)), { itemType: "service", serviceItemId: svc, qty: 1, unitPrice: B(150) }], { customerId: cust, paymentStatus: "unpaid", paymentMethod: "credit" }));
    t.sqlite.prepare("update products set deleted_at = 1 where id = ?").run(p);
    t.sqlite.prepare("update service_items set deleted_at = 1 where id = ?").run(svc);
    t.sqlite.prepare("update customers set deleted_at = 1 where id = ?").run(cust);
    const input = {
      id: bill.id,
      type: bill.type,
      occurredAt: bill.occurredAt,
      customerId: bill.customerId,
      contactName: bill.contactName,
      contactPhone: bill.contactPhone,
      items: bill.items.map((i) => ({ itemType: i.itemType, productId: i.productId, serviceItemId: i.serviceItemId, name: i.name, unit: i.unit, qty: i.qty, unitPrice: i.unitPrice, discount: i.discount })),
      paymentMethod: bill.paymentMethod,
      paymentStatus: "paid" as const,
    };
    const paid = await t.api.transactions.update(input);
    expect(paid.paymentStatus).toBe("paid");
    expect(paid.total).toBe(bill.total);
    expect(paid.items.map((i) => i.name)).toEqual(bill.items.map((i) => i.name));
    expect(paid.items[0].unitCost).toBe(B(1000));
    expect(stockOf(t, p)).toBe(3);
    // but a NEW bill with the deleted product is rejected
    expect((await failure(() => t.api.transactions.create(sale([P(p, 1, 100)])))).message).toContain("ถูกลบแล้ว");
  });
});

describe("void", () => {
  it("restores stock, keeps items for audit, records reason, and cannot be repeated", async () => {
    const a = addProduct(t, { stock: 10 });
    const bill = await t.api.transactions.create(sale([P(a, 4, B(3000))]));
    expect(stockOf(t, a)).toBe(6);
    const v = await t.api.transactions.void({ id: bill.id, reason: "  ลูกค้ายกเลิก  " });
    expect(v.status).toBe("void");
    expect(v.voidReason).toBe("ลูกค้ายกเลิก");
    expect(v.voidedAt).toBeTypeOf("number");
    expect(v.items).toHaveLength(1);
    expect(v.total).toBe(bill.total);
    expect(stockOf(t, a)).toBe(10);
    expect(movementsOf(t, bill.id)).toEqual([]);
    const again = await failure(() => t.api.transactions.void({ id: bill.id }));
    expect(again.code).toBe("CONFLICT");
    expect(again.message).toContain("ยกเลิกไปแล้ว");
    expect((await failure(() => t.api.transactions.void({ id: "missing" }))).code).toBe("NOT_FOUND");

    const buy = await t.api.transactions.create(purchase([P(a, 5, B(2000))]));
    expect(stockOf(t, a)).toBe(15);
    const vb = await t.api.transactions.void({ id: buy.id });
    expect(vb.voidReason).toBeNull();
    expect(stockOf(t, a)).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------
// Document numbers
// ---------------------------------------------------------------------------------------------

describe("document numbers", () => {
  it("run sequentially per type and month with BE years", async () => {
    const svc = await serviceId(t);
    const line = { itemType: "service" as const, serviceItemId: svc, qty: 1, unitPrice: B(100) };
    expect(await t.api.transactions.nextDocNo("sale")).toMatch(/^S\d{4}-0001$/);
    const s1 = await t.api.transactions.create(sale([line]));
    const s2 = await t.api.transactions.create(sale([line]));
    const p1 = await t.api.transactions.create(purchase([line]));
    const s3 = await t.api.transactions.create(sale([line], { occurredAt: new Date(2026, 9, 1, 9, 0).getTime() }));
    const s4 = await t.api.transactions.create(sale([line], { occurredAt: new Date(2026, 8, 30, 23, 59).getTime() }));
    const old = await t.api.transactions.create(sale([line], { occurredAt: new Date(2025, 11, 31, 12, 0).getTime() }));
    expect([s1.docNo, s2.docNo, p1.docNo, s3.docNo, s4.docNo, old.docNo]).toEqual(["S6909-0001", "S6909-0002", "P6909-0001", "S6910-0001", "S6909-0003", "S6812-0001"]);
    // voided numbers are never reused
    await t.api.transactions.void({ id: s4.id });
    expect((await t.api.transactions.create(sale([line]))).docNo).toBe("S6909-0004");
  });

  it("supports CE years and custom prefixes; nextDocNo previews without reserving", async () => {
    await setSettings(t, { docs: { useBuddhistYear: false, salePrefix: "INV", purchasePrefix: "PO-" } });
    const svc = await serviceId(t);
    const line = { itemType: "service" as const, serviceItemId: svc, qty: 1, unitPrice: B(100) };
    const jun = new Date(2026, 5, 15, 10, 0).getTime();
    const s = await t.api.transactions.create(sale([line], { occurredAt: jun }));
    const p = await t.api.transactions.create(purchase([line], { occurredAt: jun }));
    expect(s.docNo).toBe("INV2606-0001");
    expect(p.docNo).toBe("PO-2606-0001");

    const d = new Date();
    const yymm = `${String(d.getFullYear() % 100).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}`;
    const preview = await t.api.transactions.nextDocNo("sale");
    expect(preview).toBe(`INV${yymm}-0001`);
    expect(await t.api.transactions.nextDocNo("sale")).toBe(preview);
    const now = await t.api.transactions.create(sale([line], { occurredAt: Date.now() }));
    expect(now.docNo).toBe(preview);
    expect(await t.api.transactions.nextDocNo("sale")).toBe(`INV${yymm}-0002`);
    expect(await t.api.transactions.nextDocNo("purchase")).toBe(`PO-${yymm}-0001`);
    expect((await failure(() => t.api.transactions.nextDocNo("refund" as never))).code).toBe("VALIDATION");
  });

  it("bumps past numbers that already exist (e.g. restored data with a stale sequence)", async () => {
    const svc = await serviceId(t);
    const line = { itemType: "service" as const, serviceItemId: svc, qty: 1, unitPrice: B(100) };
    const s1 = await t.api.transactions.create(sale([line]));
    expect(s1.docNo).toBe("S6909-0001");
    // restored data: bill 0003 exists but the sequence still says 1 -> next is 0004, never a duplicate
    t.sqlite.prepare("update transactions set doc_no = 'S6909-0003' where id = ?").run(s1.id);
    expect(await t.api.transactions.nextDocNo("sale")).toBe("S6909-0004");
    const s2 = await t.api.transactions.create(sale([line]));
    expect(s2.docNo).toBe("S6909-0004");
    // sequence row lost entirely
    t.sqlite.prepare("delete from doc_sequences").run();
    const s3 = await t.api.transactions.create(sale([line]));
    expect(s3.docNo).toBe("S6909-0005");
    // sequence ahead of the data (e.g. bills deleted by a restore): keep counting from the sequence
    t.sqlite.prepare("update doc_sequences set last_no = 20 where key = 'S6909'").run();
    const s4 = await t.api.transactions.create(sale([line]));
    expect(s4.docNo).toBe("S6909-0021");
    const seq = t.sqlite.prepare("select last_no from doc_sequences where key = 'S6909'").get() as { last_no: number };
    expect(seq.last_no).toBe(21);
    // odd doc numbers of another key/prefix do not interfere
    t.sqlite.prepare("update transactions set doc_no = 'S6909X-9999' where id = ?").run(s4.id);
    expect(await t.api.transactions.nextDocNo("sale")).toBe("S6909-0022");
    const all = (t.sqlite.prepare("select doc_no from transactions order by doc_no").all() as { doc_no: string }[]).map((r) => r.doc_no);
    expect(all).toEqual(["S6909-0003", "S6909-0004", "S6909-0005", "S6909X-9999"]);
  });

  it("continues the demo seed's sequences", async () => {
    await seedDemo(t.ctx);
    const svc = await serviceId(t);
    const latest = (await t.api.transactions.list({ type: "sale", limit: 1000 })).items.map((i) => i.docNo).filter((d) => d.startsWith(docKeyNow("S")));
    const max = Math.max(...latest.map((d) => Number(d.split("-")[1])));
    const bill = await t.api.transactions.create(sale([{ itemType: "service", serviceItemId: svc, qty: 1, unitPrice: B(100) }], { occurredAt: Date.now() }));
    expect(bill.docNo).toBe(`${docKeyNow("S")}-${String(max + 1).padStart(4, "0")}`);
  });
});

function docKeyNow(prefix: string) {
  const d = new Date();
  return `${prefix}${String((d.getFullYear() + 543) % 100).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------
// Negative stock policy
// ---------------------------------------------------------------------------------------------

describe("allowNegativeStock", () => {
  it("allowed (default): sale may push stock below zero", async () => {
    const p = addProduct(t, { stock: 1 });
    await t.api.transactions.create(sale([P(p, 3, 100)]));
    expect(stockOf(t, p)).toBe(-2);
  });

  it("blocked: create fails with INSUFFICIENT_STOCK and details, nothing is written", async () => {
    await setSettings(t, { inventory: { allowNegativeStock: false } });
    const p = addProduct(t, { name: "Michelin", spec: null, unit: "เส้น", stock: 3 });
    const q = addProduct(t, { name: "Bridgestone", spec: null, stock: 10 });
    const before = count(t, "transactions");
    const err = await failure(() => t.api.transactions.create(sale([P(p, 2, 100), P(q, 1, 100), P(p, 2, 100)])));
    expect(err.code).toBe("INSUFFICIENT_STOCK");
    expect(err.message).toContain("สต็อกไม่พอ");
    expect(err.message).toContain("Michelin (เหลือ 3 เส้น, ต้องการ 4)");
    expect(err.details).toEqual([{ productId: p, name: "Michelin", unit: "เส้น", available: 3, requested: 4 }]);
    expect(count(t, "transactions")).toBe(before);
    expect(count(t, "doc_sequences")).toBe(0);
    expect(stockOf(t, p)).toBe(3);
    // exactly the available qty is fine
    await t.api.transactions.create(sale([P(p, 3, 100)]));
    expect(stockOf(t, p)).toBe(0);
    // services/custom/non-tracked products are never blocked
    const nt = addProduct(t, { trackStock: false });
    await t.api.transactions.create(sale([P(nt, 5, 100), { itemType: "custom", name: "ค่าแรง", qty: 1, unitPrice: 100 }]));
    // purchases are never blocked
    await t.api.transactions.create(purchase([P(p, 1, 100)]));
    expect(stockOf(t, p)).toBe(1);
  });

  it("blocked: edit is checked against the stock before this bill; lowering qty is always allowed", async () => {
    const p = addProduct(t, { stock: 5 });
    const q = addProduct(t, { stock: 1 });
    const bill = await t.api.transactions.create(sale([P(p, 7, 100)])); // allowed now -> -2
    expect(stockOf(t, p)).toBe(-2);
    await setSettings(t, { inventory: { allowNegativeStock: false } });

    // raising qty further is blocked
    const err = await failure(() => t.api.transactions.update({ ...sale([P(p, 8, 100)]), id: bill.id }));
    expect(err.code).toBe("INSUFFICIENT_STOCK");
    expect(err.details).toEqual([expect.objectContaining({ productId: p, available: 5, requested: 8 })]);
    expect(stockOf(t, p)).toBe(-2);
    expect(movementsOf(t, bill.id)).toHaveLength(1);

    // same data (e.g. mark as paid) and lowering qty are allowed even though still negative
    await t.api.transactions.update({ ...sale([P(p, 7, 100)], { paymentStatus: "paid" }), id: bill.id });
    await t.api.transactions.update({ ...sale([P(p, 6, 100)]), id: bill.id });
    expect(stockOf(t, p)).toBe(-1);
    await t.api.transactions.update({ ...sale([P(p, 5, 100)]), id: bill.id });
    expect(stockOf(t, p)).toBe(0);

    // swapping to a product that is short is blocked; to one with stock is fine
    expect((await failure(() => t.api.transactions.update({ ...sale([P(q, 2, 100)]), id: bill.id }))).code).toBe("INSUFFICIENT_STOCK");
    expect(stockOf(t, p)).toBe(0);
    await t.api.transactions.update({ ...sale([P(q, 1, 100)]), id: bill.id });
    expect([stockOf(t, p), stockOf(t, q)]).toEqual([5, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------------------------

describe("atomicity", () => {
  it("a failing line leaves no partial rows on create", async () => {
    const a = addProduct(t, { stock: 10 });
    const gone = addProduct(t, { deleted: true, stock: 3 });
    const tables = ["transactions", "transaction_items", "stock_movements", "doc_sequences"];
    const before = tables.map((x) => count(t, x));
    const err = await failure(() => t.api.transactions.create(sale([P(a, 2, 100), P(gone, 1, 100)])));
    expect(err.code).toBe("VALIDATION");
    expect(tables.map((x) => count(t, x))).toEqual(before);
    expect(stockOf(t, a)).toBe(10);
    // purchase with a bad customer after valid lines: no stock / cost change either
    const err2 = await failure(() => t.api.transactions.create(purchase([P(a, 5, B(9999))], { customerId: "missing" })));
    expect(err2.code).toBe("VALIDATION");
    expect(stockOf(t, a)).toBe(10);
    expect(costOf(t, a)).toBe(B(2000));
  });

  it("a failing edit leaves the original bill intact", async () => {
    const a = addProduct(t, { stock: 10 });
    const bill = await t.api.transactions.create(sale([P(a, 2, B(100))], { note: "เดิม" }));
    const err = await failure(() => t.api.transactions.update({ ...sale([P(a, 1, B(100)), P("missing", 1, 100)], { note: "ใหม่" }), id: bill.id }));
    expect(err.code).toBe("VALIDATION");
    const after = await t.api.transactions.get(bill.id);
    expect(after).toEqual(bill);
    expect(stockOf(t, a)).toBe(8);
    expect(movementsOf(t, bill.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

describe("get & list", () => {
  it("get returns the detail; missing id is NOT_FOUND", async () => {
    expect((await failure(() => t.api.transactions.get("missing"))).code).toBe("NOT_FOUND");
    expect((await failure(() => t.api.transactions.get(""))).code).toBe("VALIDATION");
  });

  it("filters by type/status/payment/customer and [from, to) boundaries, newest first, paged, with sums", async () => {
    const p = addProduct(t, { stock: 100 });
    const cust = addCustomer(t);
    const d0 = new Date(2026, 8, 10, 0, 0, 0).getTime(); // local midnight
    const d1 = new Date(2026, 8, 11, 0, 0, 0).getTime();
    const a = await t.api.transactions.create(sale([P(p, 1, B(100))], { occurredAt: d0 })); // exactly at from
    const b = await t.api.transactions.create(sale([P(p, 1, B(200))], { occurredAt: d1 - 1, customerId: cust, paymentStatus: "unpaid", paymentMethod: "credit" }));
    const c = await t.api.transactions.create(sale([P(p, 1, B(400))], { occurredAt: d1 })); // exactly at to -> excluded
    const d = await t.api.transactions.create(purchase([P(p, 1, B(50))], { occurredAt: d0 + HOUR }));
    const e = await t.api.transactions.create(sale([P(p, 1, B(800))], { occurredAt: d0 + 2 * HOUR }));
    await t.api.transactions.void({ id: e.id });

    const day = await t.api.transactions.list({ from: d0, to: d1 });
    expect(day.items.map((i) => i.id)).toEqual([b.id, e.id, d.id, a.id]);
    expect(day.total).toBe(4);
    expect(day.sums).toEqual({ saleCount: 2, saleTotal: B(300), purchaseCount: 1, purchaseTotal: B(50), unpaidTotal: B(200), saleUnpaidTotal: B(200), purchaseUnpaidTotal: 0, voidCount: 1 });

    expect((await t.api.transactions.list({ from: d0, to: d1, status: "completed" })).items.map((i) => i.id)).toEqual([b.id, d.id, a.id]);
    expect((await t.api.transactions.list({ status: "void" })).items.map((i) => i.id)).toEqual([e.id]);
    expect((await t.api.transactions.list({ type: "purchase" })).items.map((i) => i.id)).toEqual([d.id]);
    expect((await t.api.transactions.list({ paymentStatus: "unpaid" })).items.map((i) => i.id)).toEqual([b.id]);
    expect((await t.api.transactions.list({ customerId: cust })).items.map((i) => i.id)).toEqual([b.id]);
    expect((await t.api.transactions.list({ from: d1 })).items.map((i) => i.id)).toEqual([c.id]);
    expect((await t.api.transactions.list({ to: d0 + 1 })).items.map((i) => i.id)).toEqual([a.id]);

    const page1 = await t.api.transactions.list({ limit: 2 });
    const page2 = await t.api.transactions.list({ limit: 2, offset: 2 });
    const page3 = await t.api.transactions.list({ limit: 2, offset: 4 });
    expect(page1.total).toBe(5);
    expect([...page1.items, ...page2.items, ...page3.items].map((i) => i.id)).toEqual([c.id, b.id, e.id, d.id, a.id]);
    expect(page3.items).toHaveLength(1);
    expect(page1.sums.saleTotal).toBe(B(700)); // sums cover all matching rows, not just the page

    const row = day.items[0];
    expect(row).toMatchObject({ type: "sale", docNo: b.docNo, displayName: "สมชาย ใจดี", itemCount: 1, total: B(200), paymentMethod: "credit", paymentStatus: "unpaid", status: "completed" });
  });

  it("orders same-time bills by id desc", async () => {
    const svc = await serviceId(t);
    const line = { itemType: "service" as const, serviceItemId: svc, qty: 1, unitPrice: 100 };
    const x = await t.api.transactions.create(sale([line]));
    const y = await t.api.transactions.create(sale([line]));
    expect((await t.api.transactions.list({})).items.map((i) => i.id)).toEqual([y.id, x.id]);
  });

  it("searches plate, item name, doc no, phone digits, customer name, contact name", async () => {
    const tyre = addProduct(t, { name: "Michelin Primacy 4", spec: "205/55R16", stock: 50 });
    const cust = addCustomer(t, { name: "ประเสริฐ ทองมา", phone: "086-111-2233" });
    const svc = await serviceId(t, "ตั้งศูนย์ล้อ");
    const s1 = await t.api.transactions.create(sale([P(tyre, 4, B(3000))], { vehiclePlate: "กข 1234 กรุงเทพมหานคร", customerId: cust }));
    const s2 = await t.api.transactions.create(sale([{ itemType: "service", serviceItemId: svc, qty: 1, unitPrice: B(500) }], { contactName: "ลูกค้าหน้าร้าน", contactPhone: "(089) 765 4321", vehiclePlate: "1กก 5678" }));
    const p1 = await t.api.transactions.create(purchase([P(tyre, 8, B(2500))], { contactName: "บจก. ไทยไทร์ 50%_off" }));
    const ids = async (search: string) => (await t.api.transactions.list({ search })).items.map((i) => i.id).sort();

    expect(await ids("กข 1234")).toEqual([s1.id]);
    expect(await ids("1234")).toEqual([s1.id]);
    expect(await ids("5678")).toEqual([s2.id]);
    expect(await ids("michelin")).toEqual([p1.id, s1.id].sort());
    expect(await ids("205/55")).toEqual([p1.id, s1.id].sort());
    expect(await ids("ตั้งศูนย์")).toEqual([s2.id]);
    expect(await ids(s1.docNo)).toEqual([s1.id]);
    expect(await ids(p1.docNo.slice(0, 5))).toEqual([p1.id]); // "P6909"
    expect(await ids("0861112233")).toEqual([s1.id]); // customer phone, digits only
    expect(await ids("086-111")).toEqual([s1.id]);
    expect(await ids("0897654321")).toEqual([s2.id]); // contact phone with spaces/brackets
    expect(await ids("ประเสริฐ")).toEqual([s1.id]);
    expect(await ids("หน้าร้าน")).toEqual([s2.id]);
    expect(await ids("ไทยไทร์")).toEqual([p1.id]);
    expect(await ids("50%_")).toEqual([p1.id]); // LIKE wildcards are escaped
    expect(await ids("%ไทร")).toEqual([]); // would match p1 if % were a wildcard
    expect(await ids("michelin กข")).toEqual([s1.id]); // every term must match
    expect(await ids("ไม่มีแน่นอน")).toEqual([]);
    expect((await t.api.transactions.list({ search: "michelin", type: "sale" })).items.map((i) => i.id)).toEqual([s1.id]);
  });

  it("works over the demo data set", async () => {
    await seedDemo(t.ctx);
    const all = await t.api.transactions.list({ limit: 1000 });
    expect(all.total).toBeGreaterThan(30);
    expect(all.items.some((i) => i.status === "void")).toBe(true);
    const somchai = await t.api.transactions.list({ search: "0812345678" });
    expect(somchai.items.length).toBeGreaterThan(0);
    expect(somchai.items.every((i) => i.displayName === "สมชาย ใจดี")).toBe(true);
    // edit + void a demo bill end to end
    const target = all.items.find((i) => i.type === "sale" && i.status === "completed" && i.itemsPreview.includes("ยาง"))!;
    const detail = await t.api.transactions.get(target.id);
    const edited = await t.api.transactions.update({
      id: detail.id,
      type: detail.type,
      occurredAt: detail.occurredAt,
      customerId: detail.customerId,
      items: detail.items.map((i) => ({ itemType: i.itemType, productId: i.productId, serviceItemId: i.serviceItemId, name: i.name, unit: i.unit, qty: i.qty + 1, unitPrice: i.unitPrice, discount: i.discount })),
      discount: detail.discount,
      paymentMethod: detail.paymentMethod,
      paymentStatus: detail.paymentStatus,
    });
    expect(edited.subtotal).toBeGreaterThan(detail.subtotal);
    await t.api.transactions.void({ id: detail.id, reason: "ทดสอบ" });
  });
});

// ---------------------------------------------------------------------------------------------
// Edge cases (trying to break it)
// ---------------------------------------------------------------------------------------------

describe("edge cases", () => {
  it("an edit that leaves the latest purchase as it was (e.g. mark as paid) keeps a hand-edited cost", async () => {
    const tyre = addProduct(t, { cost: 2000 });
    const bill = await t.api.transactions.create(purchase([P(tyre, 4, B(2100))], { paymentMethod: "credit", paymentStatus: "unpaid" }));
    expect(costOf(t, tyre)).toBe(B(2100));
    t.sqlite.prepare("update products set cost_price = ? where id = ?").run(B(2150), tyre); // owner fixes the cost by hand
    await t.api.transactions.update({ ...purchase([P(tyre, 4, B(2100))], { paymentMethod: "transfer", paymentStatus: "paid" }), id: bill.id });
    expect(costOf(t, tyre)).toBe(B(2150));
    // ...but a real price change on that purchase still wins
    await t.api.transactions.update({ ...purchase([P(tyre, 4, B(2120))]), id: bill.id });
    expect(costOf(t, tyre)).toBe(B(2120));
    // moving the latest purchase before an older one hands "latest" to the other bill
    await t.api.transactions.create(purchase([P(tyre, 1, B(1990))], { occurredAt: SEP15 - DAY }));
    expect(costOf(t, tyre)).toBe(B(2120));
    await t.api.transactions.update({ ...purchase([P(tyre, 4, B(2120))], { occurredAt: SEP15 - 2 * DAY }), id: bill.id });
    expect(costOf(t, tyre)).toBe(B(1990));
    expect(stockOf(t, tyre)).toBe(5);
  });

  it("an edit moving the bill to another month keeps its doc number; items get fresh ids and line numbers", async () => {
    const p = addProduct(t, { stock: 10 });
    const bill = await t.api.transactions.create(sale([P(p, 1, B(100)), P(p, 2, B(100))]));
    const moved = await t.api.transactions.update({ ...sale([P(p, 3, B(100))], { occurredAt: new Date(2026, 9, 2, 9, 0).getTime() }), id: bill.id });
    expect(moved.docNo).toBe(bill.docNo);
    expect(moved.items).toHaveLength(1);
    expect(moved.items[0].lineNo).toBe(1);
    expect(bill.items.map((i) => i.id)).not.toContain(moved.items[0].id);
    const mv = movementsOf(t, bill.id);
    expect(mv).toEqual([expect.objectContaining({ qty: -3, transaction_item_id: moved.items[0].id, occurred_at: moved.occurredAt })]);
    expect(stockOf(t, p)).toBe(7);
    // the next bill of the original month continues that month's sequence
    expect((await t.api.transactions.create(sale([P(p, 1, B(100))]))).docNo).toBe("S6909-0002");
  });

  it("an edit may keep a deleted customer that was already on the bill, but not switch to another deleted one", async () => {
    const p = addProduct(t, { stock: 10 });
    const a = addCustomer(t, { name: "ก" });
    const b = addCustomer(t, { name: "ข", deleted: true });
    const bill = await t.api.transactions.create(sale([P(p, 1, B(100))], { customerId: a }));
    t.sqlite.prepare("update customers set deleted_at = 1 where id = ?").run(a);
    expect((await t.api.transactions.update({ ...sale([P(p, 1, B(100))], { customerId: a }), id: bill.id })).customerId).toBe(a);
    expect((await failure(() => t.api.transactions.update({ ...sale([P(p, 1, B(100))], { customerId: b }), id: bill.id }))).message).toContain("ไม่พบลูกค้า");
    // dropping the customer (walk-in) is fine
    const walkIn = await t.api.transactions.update({ ...sale([P(p, 1, B(100))], { customerId: null, contactName: "หน้าร้าน" }), id: bill.id });
    expect(walkIn).toMatchObject({ customerId: null, customer: null, contactName: "หน้าร้าน" });
  });

  it("decimal quantities keep the ledger exact", async () => {
    const oil = addProduct(t, { name: "น้ำมันเครื่อง", spec: null, unit: "ลิตร", stock: 1 });
    await t.api.transactions.create(sale([P(oil, 0.1, B(300)), P(oil, 0.1, B(300)), P(oil, 0.1, B(300))]));
    expect(stockOf(t, oil)).toBe(0.7);
    const b = await t.api.transactions.create(sale([P(oil, 0.35, B(300))]));
    expect(stockOf(t, oil)).toBe(0.35);
    expect(b.items[0].total).toBe(B(105));
    await t.api.transactions.void({ id: b.id });
    expect(stockOf(t, oil)).toBe(0.7);
  });

  it("only sales are checked against negative stock: correcting or voiding a purchase is always possible", async () => {
    await setSettings(t, { inventory: { allowNegativeStock: false } });
    const p = addProduct(t);
    const buy = await t.api.transactions.create(purchase([P(p, 10, B(100))]));
    await t.api.transactions.create(sale([P(p, 8, B(150))]));
    await t.api.transactions.update({ ...purchase([P(p, 5, B(100))]), id: buy.id });
    expect(stockOf(t, p)).toBe(-3);
    await t.api.transactions.void({ id: buy.id });
    expect(stockOf(t, p)).toBe(-8);
    // a void of a sale gives the stock back
    expect((await failure(() => t.api.transactions.create(sale([P(p, 1, B(150))])))).code).toBe("INSUFFICIENT_STOCK");
  });

  it("a bill without stock lines (services only) can be voided; void keeps totals and payment for audit", async () => {
    const svc = await serviceId(t, "ปะยาง");
    const bill = await t.api.transactions.create(sale([{ itemType: "service", serviceItemId: svc, qty: 2, unitPrice: B(150) }], { paymentStatus: "unpaid", paymentMethod: "credit" }));
    const v = await t.api.transactions.void({ id: bill.id, reason: "x".repeat(10) });
    expect(v).toMatchObject({ status: "void", total: B(300), paymentStatus: "unpaid", paymentMethod: "credit", voidReason: "xxxxxxxxxx" });
    const list = await t.api.transactions.list({});
    expect(list.items[0]).toMatchObject({ id: bill.id, status: "void" });
    expect(list.sums).toMatchObject({ saleCount: 0, saleTotal: 0, unpaidTotal: 0, saleUnpaidTotal: 0, voidCount: 1 });
    expect((await t.api.transactions.list({ status: "completed" })).sums.voidCount).toBe(0);
  });

  it("rejects junk input from the renderer", async () => {
    const p = addProduct(t, { stock: 5 });
    const bad = [
      { ...sale([P(p, 1, 100)]), type: "refund" },
      { ...sale([P(p, 1, 100)]), occurredAt: 1.5 },
      { ...sale([P(p, 1, 100)]), mileage: -1 },
      { ...sale([P(p, 1, 100)]), discount: -100 },
      { ...sale([P(p, 1, 100)]), vatMode: "exclusive", vatRate: 101 },
      { ...sale([P(p, 1, 100)]), paymentMethod: "bitcoin" },
      { ...sale([P(p, Number.NaN, 100)]) },
      { ...sale([P(p, Number.POSITIVE_INFINITY, 100)]) },
      { ...sale([{ itemType: "gift", qty: 1, unitPrice: 100 } as never]) },
      null,
      "sale",
    ];
    for (const input of bad) expect((await failure(() => t.api.transactions.create(input as never))).code).toBe("VALIDATION");
    expect((await failure(() => t.api.transactions.list({ limit: 5000 }))).code).toBe("VALIDATION");
    expect((await failure(() => t.api.transactions.void({ id: "" }))).code).toBe("VALIDATION");
    expect(count(t, "transactions")).toBe(0);
    expect(stockOf(t, p)).toBe(5);
  });
});

// ---------------------------------------------------------------------------------------------
// Renderer draft <-> API round trips (src/components/transactions/bill-draft.ts)
// ---------------------------------------------------------------------------------------------

describe("bill form draft round trip", () => {
  it("re-saving a bill through the edit form / mark-as-paid leaves it unchanged", async () => {
    const { draftFromDetail, draftToInput, detailToUpdate } = await import("@/components/transactions/bill-draft");
    const settings = await t.api.settings.get();
    const p = addProduct(t, { cost: 1000, stock: 10 });
    const cust = addCustomer(t, { name: "สมศักดิ์", phone: "081-000-0000" });
    const svc = await serviceId(t, "ถ่วงล้อ");
    const bill = await t.api.transactions.create(
      sale([P(p, 2, B(1500), { discount: B(100) }), { itemType: "service", serviceItemId: svc, qty: 4, unitPrice: B(100) }, { itemType: "custom", name: "ค่าแรง", unit: "งาน", qty: 1, unitPrice: B(200), note: "ด่วน" }], {
        customerId: cust,
        vehiclePlate: "กข 1234",
        vehicleModel: "Vios",
        mileage: 45000,
        discount: B(50),
        vatMode: "inclusive",
        vatRate: 7,
        paymentMethod: "credit",
        paymentStatus: "unpaid",
        note: "นัดรับ 17:00",
      }),
    );
    const strip = (d: typeof bill) => ({ ...d, updatedAt: 0, items: d.items.map((i) => ({ ...i, id: "" })) });

    const viaForm = await t.api.transactions.update({ ...draftToInput("sale", draftFromDetail(bill, settings)), id: bill.id });
    expect(strip(viaForm)).toEqual(strip(bill));

    expect(bill.paidAt).toBeNull();
    const markedAt = Date.now();
    const paid = await t.api.transactions.update(detailToUpdate(bill, { paymentStatus: "paid", paymentMethod: "transfer" }));
    // marking paid records when the money came in (now), nothing else changes
    expect(paid.paidAt).toBeGreaterThanOrEqual(markedAt);
    expect(strip(paid)).toEqual({ ...strip(bill), paymentStatus: "paid", paymentMethod: "transfer", paidAt: paid.paidAt });
    expect(stockOf(t, p)).toBe(8);

    // a walk-in contact that differs from the customer snapshot survives the round trip too
    const other = await t.api.transactions.create(sale([P(p, 1, B(1500))], { customerId: cust, contactName: "ภรรยาคุณสมศักดิ์", contactPhone: "089-999-9999" }));
    const again = await t.api.transactions.update({ ...draftToInput("sale", draftFromDetail(other, settings)), id: other.id });
    expect(again).toMatchObject({ contactName: "ภรรยาคุณสมศักดิ์", contactPhone: "089-999-9999", customerId: cust });
  });

  it("a purchase round trips without vehicle fields", async () => {
    const { draftFromDetail, draftToInput } = await import("@/components/transactions/bill-draft");
    const settings = await t.api.settings.get();
    const p = addProduct(t, { cost: 1000 });
    const bill = await t.api.transactions.create(purchase([P(p, 5, B(990))], { contactPhone: "02-123-4567", note: "INV-7788" }));
    const again = await t.api.transactions.update({ ...draftToInput("purchase", draftFromDetail(bill, settings)), id: bill.id });
    expect(again).toMatchObject({ contactName: "บจก. ไทยไทร์", contactPhone: "02-123-4567", vehiclePlate: null, mileage: null, total: bill.total, note: "INV-7788" });
    expect(stockOf(t, p)).toBe(5);
  });
});

// ---------------------------------------------------------------------------------------------
// Regressions: trackStock toggled after a bill, purchase cost vs line discount, docNo preview period
// ---------------------------------------------------------------------------------------------

async function setTrackStock(x: T, productId: string, trackStock: boolean) {
  const p = await x.api.products.get(productId);
  await x.api.products.update({ ...p, trackStock });
}

/** Exactly what the bill page's "รับชำระแล้ว" dialog sends (a full transactions.update). */
async function markPaid(x: T, billId: string) {
  const { detailToUpdate } = await import("@/components/transactions/bill-draft");
  return x.api.transactions.update(detailToUpdate(await x.api.transactions.get(billId), { paymentStatus: "paid", paymentMethod: "transfer" }));
}

describe("edit keeps the stock tracking a product had ON THE BILL", () => {
  it("untracked at sale time, tracked + counted later: marking the old credit sale paid does not deduct it again", async () => {
    const p = addProduct(t, { cost: 1000, trackStock: false });
    const bill = await t.api.transactions.create(sale([P(p, 2, B(1500))], { paymentMethod: "credit", paymentStatus: "unpaid" }));
    expect(movementsOf(t, bill.id)).toHaveLength(0);
    await setTrackStock(t, p, true);
    await t.api.products.adjustStock({ productId: p, qty: 5, note: "นับสต็อก" });
    expect(stockOf(t, p)).toBe(5);

    const paid = await markPaid(t, bill.id);
    expect(paid.paymentStatus).toBe("paid");
    expect(stockOf(t, p)).toBe(5);
    expect(movementsOf(t, bill.id)).toHaveLength(0);
    // a real edit of that line (qty 2 -> 3) keeps it untracked on this bill too
    await t.api.transactions.update({ ...sale([P(p, 3, B(1500))]), id: bill.id });
    expect(stockOf(t, p)).toBe(5);
    expect(movementsOf(t, bill.id)).toHaveLength(0);
  });

  it("tracked at sale time, untracked later: marking paid keeps the sale's stock-out; re-tracking shows the right stock", async () => {
    const p = addProduct(t, { cost: 1000, stock: 10 });
    const bill = await t.api.transactions.create(sale([P(p, 4, B(1500))], { paymentMethod: "credit", paymentStatus: "unpaid" }));
    expect(stockOf(t, p)).toBe(6);
    await setTrackStock(t, p, false);
    expect(stockOf(t, p)).toBe(6); // toggling tracking never touches the ledger

    await markPaid(t, bill.id);
    expect(movementsOf(t, bill.id)).toEqual([expect.objectContaining({ product_id: p, qty: -4, unit_cost: B(1000) })]);
    expect(stockOf(t, p)).toBe(6);
    await setTrackStock(t, p, true);
    expect(stockOf(t, p)).toBe(6);
  });

  it("a plain mark-paid of a tracked product is stock-neutral and keeps the movement as it was", async () => {
    const p = addProduct(t, { cost: 1000, stock: 10 });
    const bill = await t.api.transactions.create(sale([P(p, 3, B(1500)), P(p, 1, B(1400))], { paymentMethod: "credit", paymentStatus: "unpaid" }));
    const before = movementsOf(t, bill.id).map((m) => ({ product_id: m.product_id, qty: m.qty, type: m.type, unit_cost: m.unit_cost, occurred_at: m.occurred_at }));
    expect(stockOf(t, p)).toBe(6);
    await markPaid(t, bill.id);
    expect(stockOf(t, p)).toBe(6);
    expect(movementsOf(t, bill.id).map((m) => ({ product_id: m.product_id, qty: m.qty, type: m.type, unit_cost: m.unit_cost, occurred_at: m.occurred_at }))).toEqual(before);
  });

  it("products newly added by the edit use their current trackStock; removed ones get their stock back", async () => {
    const old = addProduct(t, { name: "เดิม", stock: 10 });
    const fresh = addProduct(t, { name: "ใหม่", stock: 10 });
    const off = addProduct(t, { name: "ไม่นับ", trackStock: false });
    const bill = await t.api.transactions.create(sale([P(old, 2, B(100))]));
    await setTrackStock(t, old, false);
    await t.api.transactions.update({ ...sale([P(old, 2, B(100)), P(fresh, 3, B(100)), P(off, 1, B(100))]), id: bill.id });
    expect(movementsOf(t, bill.id).map((m) => [m.product_id, m.qty])).toEqual([
      [fresh, -3],
      [old, -2],
    ]);
    expect([stockOf(t, old), stockOf(t, fresh), stockOf(t, off)]).toEqual([8, 7, 0]);
    // dropping the (now untracked) product from the bill gives its stock back
    await t.api.transactions.update({ ...sale([P(fresh, 3, B(100))]), id: bill.id });
    expect([stockOf(t, old), stockOf(t, fresh)]).toEqual([10, 7]);
  });

  it("allowNegativeStock=false: only products that track stock today are checked", async () => {
    await setSettings(t, { inventory: { allowNegativeStock: false } });
    const p = addProduct(t, { stock: 3 });
    const bill = await t.api.transactions.create(sale([P(p, 3, B(100))]));
    expect(stockOf(t, p)).toBe(0);
    // still tracked: raising the qty is blocked
    expect((await failure(() => t.api.transactions.update({ ...sale([P(p, 4, B(100))]), id: bill.id }))).code).toBe("INSUFFICIENT_STOCK");
    // no longer tracked: the edit is allowed and the bill keeps writing its movement
    await setTrackStock(t, p, false);
    await t.api.transactions.update({ ...sale([P(p, 4, B(100))]), id: bill.id });
    expect(stockOf(t, p)).toBe(-1);
    expect(movementsOf(t, bill.id)).toEqual([expect.objectContaining({ qty: -4 })]);
    // untracked on the bill, tracked today: no movement, so nothing to check
    const q = addProduct(t, { trackStock: false });
    const other = await t.api.transactions.create(sale([P(q, 5, B(100))]));
    await setTrackStock(t, q, true);
    await t.api.transactions.update({ ...sale([P(q, 6, B(100))]), id: other.id });
    expect(stockOf(t, q)).toBe(0);
  });

  it("same rule for purchases: marking an old purchase paid never adds or drops its stock-in", async () => {
    const untracked = addProduct(t, { name: "ก", cost: 1000, trackStock: false });
    const tracked = addProduct(t, { name: "ข", cost: 1000 });
    const bill = await t.api.transactions.create(purchase([P(untracked, 4, B(900)), P(tracked, 4, B(900))], { paymentMethod: "credit", paymentStatus: "unpaid" }));
    expect([stockOf(t, untracked), stockOf(t, tracked)]).toEqual([0, 4]);
    await setTrackStock(t, untracked, true);
    await setTrackStock(t, tracked, false);
    await markPaid(t, bill.id);
    expect([stockOf(t, untracked), stockOf(t, tracked)]).toEqual([0, 4]);
    expect(movementsOf(t, bill.id).map((m) => [m.product_id, m.qty])).toEqual([[tracked, 4]]);
    // void removes exactly the movements the bill had
    await t.api.transactions.void({ id: bill.id });
    expect([stockOf(t, untracked), stockOf(t, tracked)]).toEqual([0, 0]);
  });
});

describe("purchase cost = net unit price after the line discount", () => {
  it("4 x 1,000 - 400 line discount -> unit cost and product cost 900; later sales use 900", async () => {
    const tyre = addProduct(t, { cost: 1000 });
    const bill = await t.api.transactions.create(purchase([P(tyre, 4, B(1000), { discount: B(400) })]));
    expect(bill.items[0]).toMatchObject({ unitPrice: B(1000), discount: B(400), total: B(3600), unitCost: B(900) });
    expect(costOf(t, tyre)).toBe(B(900));
    expect(movementsOf(t, bill.id)[0]).toMatchObject({ qty: 4, unit_cost: B(900) });
    const s = await t.api.transactions.create(sale([P(tyre, 1, B(1000))]));
    expect(s.costTotal).toBe(B(900));
    expect(s.total - s.costTotal).toBe(B(100));
  });

  it("rounds to satang; the bill discount and VAT are not allocated to the lines", async () => {
    const a = addProduct(t, { cost: 100 });
    const svc = await serviceId(t, "ตั้งศูนย์ล้อ");
    const bill = await t.api.transactions.create(
      purchase([P(a, 3, B(100), { discount: B(1) }), { itemType: "custom", name: "ค่าขนส่ง", qty: 2, unitPrice: B(50), discount: B(10) }, { itemType: "service", serviceItemId: svc, qty: 1, unitPrice: B(300) }], {
        discount: B(50),
        vatMode: "exclusive",
        vatRate: 7,
      }),
    );
    expect(bill.items.map((i) => i.unitCost)).toEqual([Math.round(B(299) / 3), B(45), B(300)]);
    expect(costOf(t, a)).toBe(9967);
  });

  it("cost sync compares net costs: re-saving keeps a hand-edited cost, changing only the discount updates it", async () => {
    const tyre = addProduct(t, { cost: 1000 });
    const bill = await t.api.transactions.create(purchase([P(tyre, 4, B(1000), { discount: B(400) })], { paymentMethod: "credit", paymentStatus: "unpaid" }));
    expect(costOf(t, tyre)).toBe(B(900));
    t.sqlite.prepare("update products set cost_price = ? where id = ?").run(B(950), tyre);
    await markPaid(t, bill.id);
    expect(costOf(t, tyre)).toBe(B(950));
    // same typed price, bigger discount -> the net cost changed -> product cost follows
    await t.api.transactions.update({ ...purchase([P(tyre, 4, B(1000), { discount: B(800) })]), id: bill.id });
    expect(costOf(t, tyre)).toBe(B(800));
    // voiding it with an older purchase left falls back to that purchase's NET cost
    await t.api.transactions.create(purchase([P(tyre, 2, B(1000), { discount: B(100) })], { occurredAt: SEP15 - DAY }));
    expect(costOf(t, tyre)).toBe(B(800));
    await t.api.transactions.void({ id: bill.id });
    expect(costOf(t, tyre)).toBe(B(950));
  });
});

describe("nextDocNo follows the bill date", () => {
  it("previews the number a bill with that date gets (period from docPeriodKey), without reserving", async () => {
    const svc = await serviceId(t);
    const line = { itemType: "service" as const, serviceItemId: svc, qty: 1, unitPrice: B(100) };
    const aug = new Date(2026, 7, 10, 10, 0).getTime();
    expect(await t.api.transactions.nextDocNo({ type: "sale", occurredAt: aug })).toBe("S6908-0001");
    expect(await t.api.transactions.nextDocNo({ type: "sale", occurredAt: SEP15 })).toBe("S6909-0001");
    const a1 = await t.api.transactions.create(sale([line], { occurredAt: aug }));
    expect(a1.docNo).toBe("S6908-0001");
    expect(await t.api.transactions.nextDocNo({ type: "sale", occurredAt: aug + 5 * DAY })).toBe("S6908-0002");
    expect(await t.api.transactions.nextDocNo({ type: "sale", occurredAt: SEP15 })).toBe("S6909-0001");
    expect(await t.api.transactions.nextDocNo({ type: "purchase", occurredAt: aug })).toBe("P6908-0001");
    const preview = await t.api.transactions.nextDocNo({ type: "sale", occurredAt: aug });
    expect((await t.api.transactions.create(sale([line], { occurredAt: aug + DAY }))).docNo).toBe(preview);
    // month boundary in local time
    expect(await t.api.transactions.nextDocNo({ type: "sale", occurredAt: new Date(2026, 7, 31, 23, 59).getTime() })).toBe("S6908-0003");
    expect(await t.api.transactions.nextDocNo({ type: "sale", occurredAt: new Date(2026, 8, 1, 0, 0).getTime() })).toBe("S6909-0001");
    // CE years / custom prefix apply to the preview too
    await setSettings(t, { docs: { useBuddhistYear: false, salePrefix: "INV" } });
    expect(await t.api.transactions.nextDocNo({ type: "sale", occurredAt: aug })).toBe("INV2608-0001");
  });

  it("no date (plain type, missing or null occurredAt) = a bill dated now; junk is rejected", async () => {
    const key = docKeyNow("S");
    for (const input of ["sale", { type: "sale" }, { type: "sale", occurredAt: null }] as const) {
      expect(await t.api.transactions.nextDocNo(input)).toBe(`${key}-0001`);
    }
    for (const bad of ["refund", { type: "refund" }, { type: "sale", occurredAt: 1.5 }, { type: "sale", occurredAt: "2026-08-01" }, {}, null, undefined]) {
      expect((await failure(() => t.api.transactions.nextDocNo(bad as never))).code).toBe("VALIDATION");
    }
  });
});
