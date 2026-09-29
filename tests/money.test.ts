/**
 * Money details found by review: half-up line math (mulQty), purchase cost without VAT (purchaseUnitCost),
 * when a bill was paid (paidAt) and the cash-flow figures built on it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lineTotal, mulQty, purchaseUnitCost } from "@shared/calc";
import type { TransactionDetail, TransactionInput } from "@shared/contract";
import { createTestApi } from "./helpers/db";

const B = (baht: number) => Math.round(baht * 100);

/** Exact qty × amount (qty with ≤ 2 decimals) rounded half up, in BigInt. */
function exact(qty: number, amount: number): number {
  const h = BigInt(Math.round(qty * 100)) * BigInt(amount);
  const neg = h < 0n;
  const r = ((neg ? -h : h) + 50n) / 100n;
  return Number(neg ? -r : r);
}

describe("mulQty / lineTotal: qty × price rounded half up", () => {
  it("rounds exact halves up where float math rounded them down", () => {
    expect(0.35 * 1350).toBeLessThan(472.5); // the float trap: 472.49999999999994
    expect(mulQty(0.35, 1350)).toBe(473);
    expect(lineTotal({ qty: 0.35, unitPrice: 1350 })).toBe(473);
    expect(lineTotal({ qty: 0.35, unitPrice: 1350, discount: 73 })).toBe(400);
    expect(mulQty(-0.35, 1350)).toBe(-473);
    expect(mulQty(4, 365000)).toBe(1_460_000);
  });

  it("matches exact decimal math for every 2-decimal qty up to 10 on prices ending in .50 / odd satang", () => {
    for (let q100 = 1; q100 <= 1000; q100++) {
      const qty = q100 / 100;
      for (const price of [1, 50, 99, 150, 1350, 99_950, 100_050, 1_234_567]) {
        if (mulQty(qty, price) !== exact(qty, price)) throw new Error(`mulQty(${qty}, ${price}) = ${mulQty(qty, price)}, exact ${exact(qty, price)}`);
      }
    }
  });

  it("falls back to plain rounding beyond safe integers", () => {
    expect(mulQty(1e6, 1e13)).toBe(Math.round(1e6 * 1e13));
  });
});

describe("purchaseUnitCost: net per unit after the line discount, without VAT", () => {
  it("takes the line discount per unit", () => {
    expect(purchaseUnitCost({ qty: 4, unitPrice: B(1000), discount: B(400) }, "none", 0)).toBe(B(900));
    expect(purchaseUnitCost({ qty: 3, unitPrice: B(1000), discount: B(100) }, "exclusive", 7)).toBe(96_667);
    expect(purchaseUnitCost({ qty: 2, unitPrice: B(500), discount: B(5000) }, "none", 0)).toBe(0); // over-discount
  });

  it("takes the VAT out of VAT-inclusive prices only", () => {
    expect(purchaseUnitCost({ qty: 1, unitPrice: B(1070) }, "inclusive", 7)).toBe(B(1000));
    expect(purchaseUnitCost({ qty: 2, unitPrice: B(1070), discount: B(214) }, "inclusive", 7)).toBe(B(900));
    expect(purchaseUnitCost({ qty: 1, unitPrice: B(1070) }, "exclusive", 7)).toBe(B(1070)); // prices already before VAT
    expect(purchaseUnitCost({ qty: 1, unitPrice: B(1070) }, "none", 7)).toBe(B(1070));
  });

  it("keeps the typed price for a fractional qty without discount (not rebuilt from the rounded line total)", () => {
    expect(purchaseUnitCost({ qty: 0.35, unitPrice: 1350 }, "none", 0)).toBe(1350);
  });
});

describe("bills: VAT-inclusive purchase cost, paidAt, cash flow", () => {
  let t: ReturnType<typeof createTestApi>;
  beforeEach(() => {
    t = createTestApi();
  });
  afterEach(() => t.close());

  const day = (offset: number, h = 10, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const dayRange = (offset: number) => ({ from: day(offset, 0), to: day(offset + 1, 0) });
  const custom = (price: number): TransactionInput["items"] => [{ itemType: "custom", name: "ค่าแรง", qty: 1, unitPrice: price }];
  const markPaid = (d: TransactionDetail, method: "cash" | "transfer" = "cash") =>
    t.api.transactions.update({
      id: d.id,
      type: d.type,
      occurredAt: d.occurredAt,
      customerId: d.customerId,
      items: d.items.map((i) => ({ itemType: i.itemType, productId: i.productId, serviceItemId: i.serviceItemId, name: i.name, unit: i.unit, qty: i.qty, unitPrice: i.unitPrice, discount: i.discount })),
      discount: d.discount,
      vatMode: d.vatMode,
      vatRate: d.vatRate,
      paymentMethod: method,
      paymentStatus: "paid",
    });

  it("a VAT-inclusive purchase sets the product cost before VAT, so gross profit is not understated", async () => {
    await t.api.settings.update({ tax: { vatRegistered: true, vatRate: 7, defaultVatMode: "inclusive" } });
    const p = await t.api.products.create({ name: "แบตเตอรี่ 3K", costPrice: B(900), sellPrice: B(1070) });
    const buy = await t.api.transactions.create({ type: "purchase", occurredAt: day(0, 9), vatMode: "inclusive", vatRate: 7, items: [{ itemType: "product", productId: p.id, qty: 1, unitPrice: B(1070) }] });
    expect(buy.vatAmount).toBe(B(70));
    expect(buy.items[0].unitCost).toBe(B(1000));
    expect((await t.api.products.get(p.id)).costPrice).toBe(B(1000));

    const sell = await t.api.transactions.create({ type: "sale", occurredAt: day(0, 11), vatMode: "inclusive", vatRate: 7, items: [{ itemType: "product", productId: p.id, qty: 1, unitPrice: B(1070) }] });
    expect(sell.costTotal).toBe(B(1000));
    const s = await t.api.reports.summary(dayRange(0));
    expect(s.grossProfit).toBe(0); // revenue before VAT 1,000 - cost before VAT 1,000
  });

  it("paidAt: paid on entry = bill date; unpaid = null; marking paid = now; back to unpaid = null", async () => {
    const paidOnEntry = await t.api.transactions.create({ type: "sale", occurredAt: day(-2), items: custom(B(100)) });
    expect(paidOnEntry.paidAt).toBe(paidOnEntry.occurredAt);

    const credit = await t.api.transactions.create({ type: "sale", occurredAt: day(-2), paymentMethod: "credit", paymentStatus: "unpaid", items: custom(B(200)) });
    expect(credit.paidAt).toBeNull();
    const before = Date.now();
    const collected = await markPaid(credit);
    expect(collected.paidAt).toBeGreaterThanOrEqual(before);
    expect(collected.paidAt).toBeLessThanOrEqual(Date.now());

    const reopened = await t.api.transactions.update({ ...inputOf(collected), paymentStatus: "unpaid", paymentMethod: "credit" });
    expect(reopened.paidAt).toBeNull();
  });

  it("paidAt follows a corrected bill date when the bill was paid on entry, and stays put when it was collected later", async () => {
    const onEntry = await t.api.transactions.create({ type: "sale", occurredAt: day(0, 9), items: custom(B(100)) });
    const moved = await t.api.transactions.update({ ...inputOf(onEntry), occurredAt: day(-1, 9) });
    expect(moved.paidAt).toBe(day(-1, 9));

    const credit = await t.api.transactions.create({ type: "sale", occurredAt: day(-3), paymentMethod: "credit", paymentStatus: "unpaid", items: custom(B(200)) });
    const collected = await markPaid(credit);
    const edited = await t.api.transactions.update({ ...inputOf(collected), occurredAt: day(-4), note: "แก้วันที่บิล" });
    expect(edited.paidAt).toBe(collected.paidAt);
  });

  it("summary: money received counts bills paid in the range (by paidAt), never unpaid ones; collected credit is shown", async () => {
    await t.api.transactions.create({ type: "sale", occurredAt: day(0, 9), paymentMethod: "cash", items: custom(B(1000)) });
    await t.api.transactions.create({ type: "sale", occurredAt: day(0, 10), paymentMethod: "cash", paymentStatus: "unpaid", items: custom(B(500)) });
    await t.api.transactions.create({ type: "purchase", occurredAt: day(0, 11), paymentMethod: "cash", paymentStatus: "unpaid", items: custom(B(300)) });
    await t.api.transactions.create({ type: "purchase", occurredAt: day(0, 12), paymentMethod: "cash", items: custom(B(120)) });
    await t.api.transactions.create({ type: "sale", occurredAt: day(0, 13), paymentMethod: "transfer", items: custom(B(700)) });
    const yesterdayCredit = await t.api.transactions.create({ type: "sale", occurredAt: day(-1, 15), paymentMethod: "credit", paymentStatus: "unpaid", items: custom(B(2000)) });
    await markPaid(yesterdayCredit, "cash");
    const voided = await t.api.transactions.create({ type: "sale", occurredAt: day(0, 14), paymentMethod: "cash", items: custom(B(9999)) });
    await t.api.transactions.void({ id: voided.id, reason: "ทดสอบ" });

    const today = await t.api.reports.summary(dayRange(0));
    expect(today.salesReceivedByPaymentMethod).toEqual([
      { method: "cash", count: 2, total: B(3000) },
      { method: "transfer", count: 1, total: B(700) },
    ]);
    expect(today.purchasesPaidByPaymentMethod).toEqual([{ method: "cash", count: 1, total: B(120) }]);
    expect(today.salesCollectedEarlier).toEqual({ count: 1, total: B(2000) });
    // sales by BILL DATE are unchanged: today's sales incl. the unpaid one, and yesterday keeps its (now cash) bill
    expect(today.sales.total).toBe(B(2200));
    expect(today.sales.unpaidTotal).toBe(B(500));
    const yesterday = await t.api.reports.summary(dayRange(-1));
    expect(yesterday.sales.total).toBe(B(2000));
    expect(yesterday.salesReceivedByPaymentMethod).toEqual([]);
    expect(yesterday.salesCollectedEarlier).toEqual({ count: 0, total: 0 });
  });
});

/** Update input that re-saves a bill unchanged (plus overrides). */
function inputOf(d: TransactionDetail) {
  return {
    id: d.id,
    type: d.type,
    occurredAt: d.occurredAt,
    customerId: d.customerId,
    items: d.items.map((i) => ({ itemType: i.itemType, productId: i.productId, serviceItemId: i.serviceItemId, name: i.name, unit: i.unit, qty: i.qty, unitPrice: i.unitPrice, discount: i.discount })),
    discount: d.discount,
    vatMode: d.vatMode,
    vatRate: d.vatRate,
    paymentMethod: d.paymentMethod,
    paymentStatus: d.paymentStatus,
    note: d.note,
  };
}

describe("new bill drafts: default VAT mode per bill type", () => {
  it("sales use tax.defaultVatMode, purchases tax.defaultPurchaseVatMode, nothing without VAT registration", async () => {
    const { DEFAULT_SETTINGS } = await import("@shared/contract");
    const { emptyDraft } = await import("@/components/transactions/bill-draft");
    const registered = { ...DEFAULT_SETTINGS, tax: { vatRegistered: true, vatRate: 7, defaultVatMode: "exclusive" as const, defaultPurchaseVatMode: "inclusive" as const } };
    expect(emptyDraft(registered, "sale").vatMode).toBe("exclusive");
    expect(emptyDraft(registered, "purchase").vatMode).toBe("inclusive");
    const notRegistered = { ...registered, tax: { ...registered.tax, vatRegistered: false } };
    expect(emptyDraft(notRegistered, "sale").vatMode).toBe("none");
    expect(emptyDraft(notRegistered, "purchase").vatMode).toBe("none");
    // a stored tax section from 0.1.0 has no defaultPurchaseVatMode: readSettings fills the default ("none")
    expect(DEFAULT_SETTINGS.tax.defaultPurchaseVatMode).toBe("none");
  });

  it("readSettings gives old stored tax settings the purchase default", async () => {
    const t = createTestApi();
    try {
      t.sqlite.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('tax', ?, 1)").run(JSON.stringify({ vatRegistered: true, vatRate: 7, defaultVatMode: "exclusive" }));
      const s = await t.api.settings.get();
      expect(s.tax).toEqual({ vatRegistered: true, vatRate: 7, defaultVatMode: "exclusive", defaultPurchaseVatMode: "none" });
    } finally {
      t.close();
    }
  });
});

describe("fetchFirst: 'แสดงเพิ่ม' past the API's 1,000-row cap", () => {
  it("splits big limits into requests of at most MAX_PAGE_LIMIT and keeps first-page fields", async () => {
    const { fetchFirst } = await import("@/lib/paging");
    const { MAX_PAGE_LIMIT } = await import("@shared/contract");
    const rows = Array.from({ length: 2600 }, (_, i) => ({ id: `r${i}` }));
    const calls: [number, number][] = [];
    const page = async (limit: number, offset: number) => {
      calls.push([limit, offset]);
      return { items: rows.slice(offset, offset + limit), total: rows.length, sums: { n: calls.length } };
    };
    const small = await fetchFirst(50, page);
    expect(small.items).toHaveLength(50);
    expect(calls).toEqual([[50, 0]]);

    calls.length = 0;
    const big = await fetchFirst(2500, page);
    expect(calls).toEqual([
      [MAX_PAGE_LIMIT, 0],
      [MAX_PAGE_LIMIT, 1000],
      [500, 2000],
    ]);
    expect(big.items.map((r) => r.id)).toEqual(rows.slice(0, 2500).map((r) => r.id));
    expect(big.sums).toEqual({ n: 1 });

    calls.length = 0;
    const all = await fetchFirst(5000, page);
    expect(all.items).toHaveLength(2600);
    expect(calls.at(-1)).toEqual([MAX_PAGE_LIMIT, 2000]);
  });

  it("de-duplicates rows that shifted between requests", async () => {
    const { fetchFirst } = await import("@/lib/paging");
    let shifted = false;
    const page = async (limit: number, offset: number) => {
      // a new row lands at the top after the first request, pushing row 999 into the second page
      const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `r${i}` }));
      const list = shifted ? [{ id: "new" }, ...rows] : rows;
      shifted = true;
      return { items: list.slice(offset, offset + limit), total: list.length };
    };
    const got = await fetchFirst(1200, page);
    const ids = got.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[999]).toBe("r999");
  });

  it("works against the real list API with more than 1,000 rows", async () => {
    const { fetchFirst } = await import("@/lib/paging");
    const t = createTestApi();
    try {
      const ins = t.sqlite.prepare("INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)");
      t.sqlite.transaction(() => {
        for (let i = 0; i < 1100; i++) ins.run(`c${String(i).padStart(5, "0")}`, `ลูกค้า ${i}`, i, i);
      })();
      expect(() => t.api.customers.list({ limit: 1050 })).toThrow(); // the API cap itself stays (handlers are sync)
      const got = await fetchFirst(1050, async (limit, offset) => t.api.customers.list({ limit, offset }));
      expect(got.total).toBe(1100);
      expect(new Set(got.items.map((c) => c.id)).size).toBe(1050);
    } finally {
      t.close();
    }
  });
});
