import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry, TransactionInput } from "@shared/contract";
import { diffBillItems } from "../electron/api/transactions";
import { addStaff, apiError, guardedApi, loginAs, setupOwner } from "./helpers/auth";
import { createTestApi } from "./helpers/db";

type T = ReturnType<typeof createTestApi>;
let t: T;
beforeEach(() => {
  t = createTestApi();
});
afterEach(() => t.close());

const B = (baht: number) => Math.round(baht * 100);
const history = async (entityType: string, entityId: string) => (await t.api.audit.list({ entityType, entityId })).items;
const byField = (e: AuditEntry) => Object.fromEntries(e.changes.map((c) => [c.field, [c.from, c.to]]));

async function catalog() {
  const tyre = await t.api.products.create({ name: "Michelin Primacy 4", spec: "205/55R16", costPrice: B(2900), sellPrice: B(3650), initialStock: 20 });
  const battery = await t.api.products.create({ name: "GS MFX-50L", costPrice: B(1650), sellPrice: B(2200), initialStock: 5 });
  const svc = await t.api.serviceItems.create({ name: "ถ่วงล้อ", defaultPrice: B(100) });
  const cust = await t.api.customers.create({ name: "สมชาย ใจดี", phone: "081-111-1111" });
  const cust2 = await t.api.customers.create({ name: "วิภา", phone: "089-222-2222" });
  return { tyre, battery, svc, cust, cust2 };
}

describe("who created / changed a bill", () => {
  it("stamps createdBy, updatedBy and voidedBy, and lists bills by creator", async () => {
    const { user: owner } = await setupOwner(t);
    const { tyre } = await catalog();
    const staff = await addStaff(t, "น้องเมย์", ["transactions.edit"], "1111");
    await loginAs(t, staff.id, "1111");
    const input: TransactionInput = { type: "sale", occurredAt: Date.now(), items: [{ itemType: "product", productId: tyre.id, qty: 2, unitPrice: B(3650) }] };
    const bill = await t.api.transactions.create(input);
    expect(bill.createdBy).toEqual({ id: staff.id, name: "น้องเมย์" });
    expect(bill.updatedBy).toEqual({ id: staff.id, name: "น้องเมย์" });
    expect(bill.voidedBy).toBeNull();

    await loginAs(t, owner.id, "1234");
    const edited = await t.api.transactions.update({ ...input, id: bill.id, note: "แก้ไขโดยเจ้าของ" });
    expect(edited.createdBy?.name).toBe("น้องเมย์");
    expect(edited.updatedBy?.name).toBe("เจ้าของร้าน");
    const voided = await t.api.transactions.void({ id: bill.id, reason: "ลูกค้ายกเลิก" });
    expect(voided.voidedBy?.name).toBe("เจ้าของร้าน");

    await t.api.transactions.create(input);
    const mine = await t.api.transactions.list({ createdBy: staff.id });
    expect(mine.items.map((b) => b.id)).toEqual([bill.id]);
    expect(mine.items[0].createdByName).toBe("น้องเมย์");
    expect((await t.api.transactions.list({ createdBy: owner.id })).total).toBe(1);

    // renaming the user renames them everywhere; deleting keeps the name on old bills
    await t.api.users.update({ ...staff, name: "เมย์" });
    await t.api.users.remove(staff.id);
    expect((await t.api.transactions.get(bill.id)).createdBy?.name).toBe("เมย์");
  });

  it("bills from before the user system (or system writes) have no user", async () => {
    const { tyre } = await catalog();
    const bill = await t.api.transactions.create({ type: "sale", occurredAt: Date.now(), items: [{ itemType: "product", productId: tyre.id, qty: 1, unitPrice: B(3650) }] });
    expect(bill.createdBy).toBeNull();
    expect((await t.api.transactions.list({})).items[0].createdByName).toBeNull();
    expect((await history("transaction", bill.id))[0]).toMatchObject({ action: "create", userId: null, userName: null });
  });
});

describe("bill history", () => {
  it("records create, a field + line edit, payment and void with the details", async () => {
    await setupOwner(t);
    const { tyre, battery, svc, cust, cust2 } = await catalog();
    const occurredAt = new Date(2026, 8, 20, 10, 0).getTime();
    const input: TransactionInput = {
      type: "sale",
      occurredAt,
      customerId: cust.id,
      vehiclePlate: "กข 1234",
      paymentMethod: "credit",
      paymentStatus: "unpaid",
      items: [
        { itemType: "product", productId: tyre.id, qty: 4, unitPrice: B(3650) },
        { itemType: "service", serviceItemId: svc.id, qty: 4, unitPrice: B(100) },
        { itemType: "custom", name: "ค่าแรงพิเศษ", qty: 1, unitPrice: B(200) },
      ],
    };
    const bill = await t.api.transactions.create(input);
    let log = await history("transaction", bill.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "create", entityLabel: bill.docNo, userName: "เจ้าของร้าน" });
    expect(byField(log[0])).toMatchObject({ customer: [null, "สมชาย ใจดี"], total: [null, B(15200)], paymentStatus: [null, "unpaid"], items: [null, 3] });

    // re-saving unchanged writes nothing
    await t.api.transactions.update({ ...input, id: bill.id });
    expect(await history("transaction", bill.id)).toHaveLength(1);

    await t.api.transactions.update({
      ...input,
      id: bill.id,
      customerId: cust2.id,
      discount: B(300),
      note: "ลดให้",
      items: [
        { itemType: "product", productId: tyre.id, qty: 2, unitPrice: B(3500) }, // changed
        { itemType: "product", productId: battery.id, qty: 1, unitPrice: B(2200) }, // added
        { itemType: "custom", name: "ค่าแรงพิเศษ", qty: 1, unitPrice: B(200) }, // same
        // service removed
      ],
    });
    log = await history("transaction", bill.id);
    expect(log[0].action).toBe("update");
    expect(byField(log[0])).toMatchObject({
      customer: ["สมชาย ใจดี", "วิภา"],
      contactPhone: ["081-111-1111", "089-222-2222"],
      discount: [0, B(300)],
      total: [B(15200), B(7000) + B(2200) + B(200) - B(300)],
      note: [null, "ลดให้"],
    });
    expect(log[0].changes.map((c) => c.field)).not.toContain("contactName");
    expect(log[0].items).toEqual([
      {
        change: "changed",
        name: "Michelin Primacy 4 205/55R16",
        unit: "ชิ้น",
        before: { qty: 4, unitPrice: B(3650), discount: 0, total: B(14600) },
        after: { qty: 2, unitPrice: B(3500), discount: 0, total: B(7000) },
        fields: [
          { field: "qty", from: 4, to: 2 },
          { field: "unitPrice", from: B(3650), to: B(3500) },
          { field: "lineTotal", from: B(14600), to: B(7000) },
        ],
      },
      { change: "added", name: "GS MFX-50L", unit: "ชิ้น", before: null, after: { qty: 1, unitPrice: B(2200), discount: 0, total: B(2200) }, fields: [] },
      { change: "removed", name: "ถ่วงล้อ", unit: "ครั้ง", before: { qty: 4, unitPrice: B(100), discount: 0, total: B(400) }, after: null, fields: [] },
    ]);

    // marking paid through the edit form is recorded as a payment
    const current = await t.api.transactions.get(bill.id);
    await t.api.transactions.update({
      ...input,
      id: bill.id,
      customerId: cust2.id,
      discount: B(300),
      note: "ลดให้",
      items: current.items.map((i) => ({ itemType: i.itemType, productId: i.productId, serviceItemId: i.serviceItemId, name: i.name, qty: i.qty, unitPrice: i.unitPrice })),
      paymentMethod: "transfer",
      paymentStatus: "paid",
    });
    log = await history("transaction", bill.id);
    expect(log[0].action).toBe("pay");
    expect(byField(log[0])).toEqual({ paymentMethod: ["credit", "transfer"], paymentStatus: ["unpaid", "paid"] });

    await t.api.transactions.void({ id: bill.id, reason: "เปิดบิลซ้ำ" });
    log = await history("transaction", bill.id);
    expect(log[0]).toMatchObject({ action: "void", note: "เปิดบิลซ้ำ", changes: [{ field: "status", from: "completed", to: "void" }] });
    expect(log.map((e) => e.action)).toEqual(["void", "pay", "update", "create"]);
  });

  it("markPaid receives an unpaid bill without touching lines or stock", async () => {
    await setupOwner(t);
    const { tyre } = await catalog();
    const bill = await t.api.transactions.create({ type: "sale", occurredAt: Date.now() - 86_400_000, paymentMethod: "credit", paymentStatus: "unpaid", items: [{ itemType: "product", productId: tyre.id, qty: 4, unitPrice: B(3650) }] });
    const stockBefore = (await t.api.products.get(tyre.id)).stockQty;
    const paid = await t.api.transactions.markPaid({ id: bill.id, paymentMethod: "transfer" });
    expect(paid).toMatchObject({ paymentStatus: "paid", paymentMethod: "transfer", total: bill.total, items: bill.items });
    expect(paid.paidAt).toBeGreaterThan(bill.occurredAt);
    expect((await t.api.products.get(tyre.id)).stockQty).toBe(stockBefore);
    expect((await history("transaction", bill.id))[0]).toMatchObject({ action: "pay", userName: "เจ้าของร้าน" });
    expect((await apiError(() => t.api.transactions.markPaid({ id: bill.id, paymentMethod: "cash" }))).message).toContain("ชำระเงินแล้ว");
    await t.api.transactions.void({ id: bill.id });
    expect((await apiError(() => t.api.transactions.markPaid({ id: bill.id, paymentMethod: "cash" }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.transactions.markPaid({ id: "nope", paymentMethod: "cash" }))).code).toBe("NOT_FOUND");
    expect((await apiError(() => t.api.transactions.markPaid({ id: bill.id, paymentMethod: "credit" as never }))).code).toBe("VALIDATION");
  });

  it("matches repeated products in order and custom lines by name", () => {
    const line = (over: Record<string, unknown>) => ({ itemType: "product" as const, productId: "p1", serviceItemId: null, name: "ยาง", unit: "เส้น", qty: 1, unitPrice: 100, discount: 0, total: 100, ...over });
    const out = diffBillItems(
      [line({}), line({ qty: 2, total: 200 }), line({ itemType: "custom", productId: null, name: "ค่าแรง" })],
      [line({}), line({ itemType: "custom", productId: null, name: "ค่าแรงใหม่" })],
    );
    expect(out.map((c) => [c.change, c.name])).toEqual([
      ["added", "ค่าแรงใหม่"],
      ["removed", "ยาง"],
      ["removed", "ค่าแรง"],
    ]);
  });
});

describe("price history", () => {
  it("records the first prices, manual edits and who made them", async () => {
    const { user: owner } = await setupOwner(t);
    const p = await t.api.products.create({ name: "Bridgestone T005A", costPrice: B(3100), sellPrice: B(3900) });
    const zero = await t.api.products.create({ name: "ยังไม่ตั้งราคา" });
    expect((await t.api.products.priceHistory({ id: zero.id })).total).toBe(0);

    const staff = await addStaff(t, "ผู้จัดการ", ["catalog.manage"], "1111");
    await loginAs(t, staff.id, "1111");
    await t.api.products.update({ ...p, sellPrice: B(4200) });
    await t.api.products.update({ ...p, sellPrice: B(4200), note: "ไม่เกี่ยวกับราคา" });
    await loginAs(t, owner.id, "1234");
    await t.api.products.update({ ...p, sellPrice: B(4100), costPrice: B(3200), note: "ไม่เกี่ยวกับราคา" });

    const h = await t.api.products.priceHistory({ id: p.id });
    expect(h.total).toBe(5);
    expect(h.items.map((c) => [c.field, c.oldValue, c.newValue, c.source, c.userName])).toEqual([
      ["cost", B(3100), B(3200), "manual", "เจ้าของร้าน"],
      ["sell", B(4200), B(4100), "manual", "เจ้าของร้าน"],
      ["sell", B(3900), B(4200), "manual", "ผู้จัดการ"],
      ["cost", null, B(3100), "create", "เจ้าของร้าน"],
      ["sell", null, B(3900), "create", "เจ้าของร้าน"],
    ]);

    const productLog = await history("product", p.id);
    expect(productLog.map((e) => e.action)).toEqual(["update", "update", "update", "create"]);
    expect(byField(productLog[1])).toEqual({ note: [null, "ไม่เกี่ยวกับราคา"] });
  });

  it("services: default price history, also from the inline price edit", async () => {
    await setupOwner(t);
    const s = await t.api.serviceItems.create({ name: "ตั้งศูนย์ล้อ", defaultPrice: 0 });
    await t.api.serviceItems.update({ ...s, defaultPrice: B(500) });
    await t.api.serviceItems.update({ ...s, defaultPrice: B(550) });
    const h = await t.api.serviceItems.priceHistory({ id: s.id });
    expect(h.items.map((c) => [c.oldValue, c.newValue, c.field, c.source])).toEqual([
      [B(500), B(550), "sell", "manual"],
      [0, B(500), "sell", "manual"],
    ]);
    await t.api.serviceItems.remove(s.id);
    expect((await t.api.serviceItems.priceHistory({ id: s.id })).total).toBe(2);
    expect((await history("service", s.id)).map((e) => e.action)).toEqual(["delete", "update", "update", "create"]);
  });

  it("purchases move the cost with a link to the bill; voiding falls back to the previous purchase", async () => {
    await setupOwner(t);
    const p = await t.api.products.create({ name: "แบต 3K", costPrice: B(1800), sellPrice: B(2450) });
    const buy = (price: number, daysAgo: number) =>
      t.api.transactions.create({ type: "purchase", occurredAt: Date.now() - daysAgo * 86_400_000, items: [{ itemType: "product", productId: p.id, qty: 2, unitPrice: price }] });
    const p1 = await buy(B(1850), 10);
    const p2 = await buy(B(1900), 1);
    await buy(B(1700), 20); // older date: cost stays 1,900, no history row
    let h = (await t.api.products.priceHistory({ id: p.id })).items.filter((c) => c.field === "cost");
    expect(h.map((c) => [c.oldValue, c.newValue, c.source, c.docNo])).toEqual([
      [B(1850), B(1900), "purchase", p2.docNo],
      [B(1800), B(1850), "purchase", p1.docNo],
      [null, B(1800), "create", null],
    ]);
    await t.api.transactions.void({ id: p2.id });
    h = (await t.api.products.priceHistory({ id: p.id })).items.filter((c) => c.field === "cost");
    expect(h[0]).toMatchObject({ oldValue: B(1900), newValue: B(1850), source: "purchase", transactionId: p1.id, docNo: p1.docNo });
    expect(h[0].note).toContain(`ยกเลิกบิล ${p2.docNo}`);
    expect((await t.api.products.get(p.id)).costPrice).toBe(B(1850));
  });

  it("stock adjustments are recorded with the user on the stock card and in the history", async () => {
    await setupOwner(t);
    const p = await t.api.products.create({ name: "จุ๊บลม", initialStock: 10 });
    await t.api.products.adjustStock({ productId: p.id, qty: -2, note: "นับสต็อก" });
    const mv = await t.api.products.movements({ productId: p.id });
    expect(mv.items.map((m) => [m.type, m.userName])).toEqual([
      ["adjust", "เจ้าของร้าน"],
      ["initial", "เจ้าของร้าน"],
    ]);
    const log = await history("product", p.id);
    expect(log[0]).toMatchObject({ action: "stock_adjust", note: "นับสต็อก" });
    expect(byField(log[0])).toEqual({ adjustQty: [null, -2], stockQty: [10, 8] });
  });
});

describe("history of other records", () => {
  it("customers, categories and settings", async () => {
    await setupOwner(t);
    const c = await t.api.customers.create({ name: "ลูกค้า A", phone: "081" });
    await t.api.customers.update({ ...c, phone: "082", email: "a@b.co" });
    await t.api.customers.remove(c.id);
    expect((await history("customer", c.id)).map((e) => [e.action, e.changes.length])).toEqual([
      ["delete", 0],
      ["update", 2],
      ["create", 2],
    ]);

    const cat = await t.api.categories.create({ name: "หมวดใหม่" });
    await t.api.categories.update({ id: cat.id, name: "หมวดใหม่ 2" });
    expect(byField((await history("category", cat.id))[0])).toEqual({ name: ["หมวดใหม่", "หมวดใหม่ 2"] });

    await t.api.settings.update({ tax: { vatRate: 7 } }); // unchanged -> nothing
    await t.api.settings.update({ tax: { vatRegistered: true }, shop: { logoDataUrl: "data:image/png;base64," + "A".repeat(5000) } });
    const s = (await t.api.audit.list({ entityType: "settings" })).items;
    expect(s).toHaveLength(1);
    expect(byField(s[0])).toEqual({ "shop.logoDataUrl": [null, "(มีรูปโลโก้)"], "tax.vatRegistered": [false, true] });
  });

  it("the feed filters by user, type, time and text; pay data stays private without employees.manage", async () => {
    const { user: owner } = await setupOwner(t);
    await t.api.customers.create({ name: "ลูกค้าเก่า" });
    const e = await t.api.employees.create({ firstName: "สมศักดิ์", payRate: B(15000) });
    await t.api.employees.update({ ...e, payRate: B(16000) });
    const auditor = await addStaff(t, "ผู้ตรวจ", ["audit.view"], "1111");

    const all = await t.api.audit.list({ limit: 100 });
    expect(all.items.some((x) => x.entityType === "employee")).toBe(true);
    expect((await t.api.audit.list({ userId: owner.id })).total).toBe(all.total);
    expect((await t.api.audit.list({ search: "ลูกค้าเก่า" })).items.map((x) => x.entityType)).toEqual(["customer"]);
    expect((await t.api.audit.list({ from: Date.now() + 60_000 })).total).toBe(0);

    await loginAs(t, auditor.id, "1111");
    const g = guardedApi(t);
    const seen = await g.audit.list({ limit: 100 });
    expect(seen.items.some((x) => x.entityType === "employee")).toBe(false);
    expect(seen.items.some((x) => x.entityType === "customer")).toBe(true);
    expect((await g.audit.list({ entityType: "employee", entityId: e.id })).total).toBe(0);
  });
});
