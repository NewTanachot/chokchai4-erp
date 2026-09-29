import { describe, expect, it } from "vitest";
import { seedDemo } from "../electron/dev/demo-seed";
import { createTestApi } from "./helpers/db";

describe("baseline reads over demo data", () => {
  it("lists products, services, customers with stats", async () => {
    const t = createTestApi();
    await seedDemo(t.ctx);
    const prods = await t.api.products.list({ search: "michelin 205" });
    expect(prods.total).toBe(1);
    expect(prods.items[0].categoryName).toBe("ยางรถยนต์");
    const low = await t.api.products.list({ lowStockOnly: true });
    expect(low.items.every((p) => p.stockQty <= p.minStock)).toBe(true);
    const services = await t.api.serviceItems.list({});
    expect(services.total).toBeGreaterThanOrEqual(10);
    const cats = await t.api.categories.list();
    expect(cats.find((c) => c.name === "แบตเตอรี่")?.productCount).toBe(5);
    const byPhone = await t.api.customers.list({ search: "0812345678" });
    expect(byPhone.items[0]?.name).toBe("สมชาย ใจดี");
    expect(byPhone.items[0].saleCount).toBeGreaterThan(0);
    expect(byPhone.items[0].vehiclePlates[0]).toContain("กข 1234");
    const byPlate = await t.api.customers.list({ search: "กข 1234" });
    expect(byPlate.items.map((c) => c.name)).toContain("สมชาย ใจดี");
    const one = await t.api.customers.get(byPhone.items[0].id);
    expect(one.totalSpent).toBe(byPhone.items[0].totalSpent);
    // ledger consistency
    const bad = t.sqlite
      .prepare("select p.id from products p where abs(p.stock_qty - (select coalesce(sum(qty),0) from stock_movements m where m.product_id = p.id)) > 0.001")
      .all();
    expect(bad).toEqual([]);
    t.close();
  });
});
