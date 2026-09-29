import { describe, expect, it } from "vitest";
import { computeTotals, lineTotal } from "@shared/calc";
import { bahtToSatang, formatBaht } from "@shared/money";
import { DEFAULT_SETTINGS } from "@shared/contract";
import { createTestApi } from "./helpers/db";

describe("money", () => {
  it("converts baht to satang without float drift", () => {
    expect(bahtToSatang(0.1 + 0.2)).toBe(30);
    expect(bahtToSatang("1,234.56")).toBe(123456);
    expect(formatBaht(123456)).toBe("฿1,234.56");
    expect(formatBaht(-500)).toBe("-฿5.00");
  });
});

describe("calc", () => {
  it("line totals round and apply discount", () => {
    expect(lineTotal({ qty: 4, unitPrice: 250000 })).toBe(1000000);
    expect(lineTotal({ qty: 1.5, unitPrice: 333 })).toBe(500);
    expect(lineTotal({ qty: 1, unitPrice: 100, discount: 500 })).toBe(0);
  });
  it("vat modes", () => {
    const lines = [{ qty: 1, unitPrice: 10700 }];
    expect(computeTotals({ lines, vatMode: "none", vatRate: 7 })).toMatchObject({ total: 10700, vatAmount: 0 });
    expect(computeTotals({ lines, vatMode: "inclusive", vatRate: 7 })).toMatchObject({ total: 10700, vatAmount: 700, beforeVat: 10000 });
    expect(computeTotals({ lines: [{ qty: 1, unitPrice: 10000 }], vatMode: "exclusive", vatRate: 7 })).toMatchObject({ total: 10700, vatAmount: 700 });
    expect(computeTotals({ lines, discount: 99999, vatMode: "none", vatRate: 0 })).toMatchObject({ discount: 10700, total: 0 });
  });
});

describe("database bootstrap", () => {
  it("migrates, seeds defaults and reads/updates settings", async () => {
    const { api, sqlite, close } = createTestApi();
    const tables = sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["products", "transactions", "stock_movements"]));
    const s = await api.settings.get();
    expect(s.shop.name).toBe(DEFAULT_SETTINGS.shop.name);
    const s2 = await api.settings.update({ shop: { phone: "081-234-5678" }, tax: { vatRegistered: true } });
    expect(s2.shop.phone).toBe("081-234-5678");
    expect(s2.shop.name).toBe(DEFAULT_SETTINGS.shop.name);
    expect(s2.tax.vatRegistered).toBe(true);
    expect(s2.tax.vatRate).toBe(7);
    close();
  });
  it("partial unique index on sku allows re-use after soft delete", () => {
    const { sqlite, close } = createTestApi();
    const ins = sqlite.prepare("insert into products (id, sku, name, created_at, updated_at, deleted_at) values (?, ?, ?, 0, 0, ?)");
    ins.run("a", "SKU1", "x", 1);
    ins.run("b", "SKU1", "y", null);
    expect(() => ins.run("c", "SKU1", "z", null)).toThrow();
    ins.run("d", null, "n1", null);
    ins.run("e", null, "n2", null);
    close();
  });
});
