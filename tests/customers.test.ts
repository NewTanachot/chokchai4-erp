import { afterEach, describe, expect, it } from "vitest";
import { seedDemo } from "../electron/dev/demo-seed";
import { toApiError } from "../electron/api/errors";
import { newId } from "../electron/api/util";
import { transactionItems, transactions } from "../electron/db/schema";
import { createTestApi } from "./helpers/db";

type T = ReturnType<typeof createTestApi>;
let t: T | null = null;
afterEach(() => {
  t?.close();
  t = null;
});
const setup = () => (t = createTestApi());

/** Runs a (possibly sync) handler and returns the mapped API error it throws. */
async function apiError(fn: () => unknown) {
  try {
    await fn();
  } catch (e) {
    return toApiError(e);
  }
  throw new Error("expected an error");
}

let docSeq = 0;
/** Inserts a bill directly (transactions.create is owned by another module). */
function insertBill(
  db: T["db"],
  b: {
    customerId: string | null;
    occurredAt: number;
    type?: "sale" | "purchase";
    status?: "completed" | "void";
    total?: number;
    paymentStatus?: "paid" | "unpaid";
    plate?: string | null;
    model?: string | null;
    mileage?: number | null;
    contactName?: string | null;
    items?: { name: string; itemType?: "product" | "service" | "custom"; qty?: number; unitPrice?: number }[];
  },
) {
  const id = newId();
  const total = b.total ?? 10000;
  db.insert(transactions)
    .values({
      id,
      type: b.type ?? "sale",
      docNo: `T-${++docSeq}`,
      status: b.status ?? "completed",
      occurredAt: b.occurredAt,
      customerId: b.customerId,
      contactName: b.contactName ?? null,
      vehiclePlate: b.plate ?? null,
      vehicleModel: b.model ?? null,
      mileage: b.mileage ?? null,
      subtotal: total,
      total,
      paymentStatus: b.paymentStatus ?? "paid",
      voidedAt: b.status === "void" ? b.occurredAt + 1000 : null,
      voidReason: b.status === "void" ? "ทดสอบยกเลิก" : null,
      createdAt: b.occurredAt,
      updatedAt: b.occurredAt,
    })
    .run();
  (b.items ?? [{ name: "ปะยาง", itemType: "custom" }]).forEach((it, i) => {
    const qty = it.qty ?? 1;
    const unitPrice = it.unitPrice ?? total;
    db.insert(transactionItems)
      .values({
        id: newId(),
        transactionId: id,
        lineNo: i + 1,
        itemType: it.itemType ?? "custom",
        name: it.name,
        qty,
        unitPrice,
        total: Math.round(qty * unitPrice),
        createdAt: b.occurredAt,
        updatedAt: b.occurredAt,
      })
      .run();
  });
  return id;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 3, 0, 0);

describe("customers CRUD", () => {
  it("creates, reads, updates and lists a customer", async () => {
    const { api } = setup();
    const c = await api.customers.create({
      name: "  สมหญิง รักดี ",
      phone: "089-111-2222",
      lineId: "somying",
      email: "",
      shopName: "ร้านสมหญิงการยาง",
      taxId: "  ",
      address: "12 ถ.สุขุมวิท",
      note: null,
    });
    expect(c.id).toBeTruthy();
    expect(c.name).toBe("สมหญิง รักดี");
    expect(c.email).toBeNull();
    expect(c.taxId).toBeNull();
    expect(c.createdAt).toBe(c.updatedAt);

    const got = await api.customers.get(c.id);
    expect(got).toMatchObject({ name: "สมหญิง รักดี", saleCount: 0, totalSpent: 0, unpaidTotal: 0, unpaidCount: 0, firstVisitAt: null, lastVisitAt: null, vehiclePlates: [], vehicles: [] });

    const upd = await api.customers.update({ id: c.id, name: "สมหญิง รักดีมาก", phone: "0891112222", email: "SOMYING@example.com" });
    expect(upd.name).toBe("สมหญิง รักดีมาก");
    expect(upd.phone).toBe("0891112222");
    expect(upd.email).toBe("SOMYING@example.com");
    expect(upd.lineId).toBeNull(); // full replacement: omitted optional fields are cleared
    expect(upd.updatedAt).toBeGreaterThanOrEqual(c.updatedAt);

    const list = await api.customers.list({});
    expect(list.total).toBe(1);
    expect(list.items[0].name).toBe("สมหญิง รักดีมาก");
  });

  it("validates input", async () => {
    const { api } = setup();
    const e1 = await apiError(() => api.customers.create({ name: "   " }));
    expect(e1.code).toBe("VALIDATION");
    expect(e1.message).toContain("กรุณากรอกชื่อลูกค้า");
    const e2 = await apiError(() => api.customers.create({ name: "ก", email: "not-an-email" }));
    expect(e2.code).toBe("VALIDATION");
    expect(e2.message).toContain("อีเมลไม่ถูกต้อง");
    const e3 = await apiError(() => api.customers.create({ name: "x".repeat(201) }));
    expect(e3.code).toBe("VALIDATION");
    const e4 = await apiError(() => api.customers.update({ id: "missing", name: "ก" }));
    expect(e4.code).toBe("NOT_FOUND");
    const e5 = await apiError(() => api.customers.get(""));
    expect(e5.code).toBe("VALIDATION");
    expect((await api.customers.list({})).total).toBe(0);
  });

  it("soft-deletes: hidden from list/get/history, bills keep the contact snapshot", async () => {
    const { api, db, sqlite } = setup();
    const c = await api.customers.create({ name: "ลบทิ้ง ทดสอบ", phone: "081-000-0000" });
    const keep = await api.customers.create({ name: "ยังอยู่" });
    const billId = insertBill(db, { customerId: c.id, occurredAt: T0, plate: "กก 1111" });

    await api.customers.remove(c.id);
    const list = await api.customers.list({});
    expect(list.items.map((x) => x.id)).toEqual([keep.id]);
    expect(list.total).toBe(1);
    expect((await api.customers.list({ search: "ลบทิ้ง" })).total).toBe(0);
    expect((await api.customers.list({ search: "กก 1111" })).total).toBe(0);
    expect((await apiError(() => api.customers.get(c.id))).code).toBe("NOT_FOUND");
    expect((await apiError(() => api.customers.history({ customerId: c.id }))).code).toBe("NOT_FOUND");
    expect((await apiError(() => api.customers.update({ id: c.id, name: "x" }))).code).toBe("NOT_FOUND");
    expect((await apiError(() => api.customers.remove(c.id))).code).toBe("NOT_FOUND");

    const row = sqlite.prepare("select customer_id, contact_name, contact_phone from transactions where id = ?").get(billId) as Record<string, string>;
    expect(row).toEqual({ customer_id: c.id, contact_name: "ลบทิ้ง ทดสอบ", contact_phone: "081-000-0000" });
    const deleted = sqlite.prepare("select deleted_at from customers where id = ?").get(c.id) as { deleted_at: number | null };
    expect(deleted.deleted_at).toBeGreaterThan(0);
  });
});

describe("customers search", () => {
  it("matches name, formatted/unformatted phone, LINE, email, shop and plates", async () => {
    const { api, db } = setup();
    const a = await api.customers.create({ name: "สมชาย ใจดี", phone: "081-234-5678", lineId: "somchai.j" });
    const b = await api.customers.create({ name: "วิภา ศรีสุข", phone: "0897654321", email: "wipa@gmail.com" });
    const s = await api.customers.create({ name: "คุณวิชัย", phone: "(02) 123 4567", shopName: "บริษัท สยามขนส่ง จำกัด" });
    insertBill(db, { customerId: a.id, occurredAt: T0, plate: "กข 1234 กรุงเทพมหานคร", model: "Toyota Vios" });
    insertBill(db, { customerId: s.id, occurredAt: T0, plate: "70-1234 กรุงเทพมหานคร" });
    // a plate that only appears on a void bill does not count
    insertBill(db, { customerId: b.id, occurredAt: T0, plate: "ฮฮ 9999", status: "void" });

    const names = async (search: string) => (await api.customers.list({ search })).items.map((c) => c.name).sort();

    expect(await names("0812345678")).toEqual(["สมชาย ใจดี"]);
    expect(await names("081-234-5678")).toEqual(["สมชาย ใจดี"]);
    expect(await names("5678")).toEqual(["สมชาย ใจดี"]);
    expect(await names("089-765-4321")).toEqual(["วิภา ศรีสุข"]);
    expect(await names("+66897654321")).toEqual(["วิภา ศรีสุข"]);
    expect(await names("021234567")).toEqual(["คุณวิชัย"]);
    expect(await names("somchai")).toEqual(["สมชาย ใจดี"]);
    expect(await names("SOMCHAI.J")).toEqual(["สมชาย ใจดี"]);
    expect(await names("wipa@")).toEqual(["วิภา ศรีสุข"]);
    expect(await names("สยามขนส่ง")).toEqual(["คุณวิชัย"]);
    expect(await names("กข 1234")).toEqual(["สมชาย ใจดี"]);
    expect(await names("กข1234")).toEqual(["สมชาย ใจดี"]);
    expect(await names("701234")).toEqual(["คุณวิชัย"]);
    expect(await names("1234")).toEqual(["คุณวิชัย", "สมชาย ใจดี"]);
    expect(await names("ฮฮ 9999")).toEqual([]);
    // multiple words must all match (any field)
    expect(await names("สมชาย 081")).toEqual(["สมชาย ใจดี"]);
    expect(await names("สมชาย 089")).toEqual([]);
    // LIKE wildcards are literal
    expect(await names("%")).toEqual([]);
    expect(await names("_")).toEqual([]);
  });

  it("works over demo data (phone formats + plates)", async () => {
    const { api, ctx } = setup();
    await seedDemo(ctx);
    const byPhone = await api.customers.list({ search: "0812345678" });
    expect(byPhone.items[0]?.name).toBe("สมชาย ใจดี");
    const byPlate = await api.customers.list({ search: "กข1234" });
    expect(byPlate.items.map((c) => c.name)).toContain("สมชาย ใจดี");
  });
});

describe("customer stats", () => {
  it("count only completed sales (no purchases, no void bills)", async () => {
    const { api, db } = setup();
    const c = await api.customers.create({ name: "ลูกค้า สถิติ" });
    insertBill(db, { customerId: c.id, occurredAt: T0, total: 100000, plate: "กก 1" });
    insertBill(db, { customerId: c.id, occurredAt: T0 + 2 * DAY, total: 50000, paymentStatus: "unpaid", plate: "กก 2" });
    insertBill(db, { customerId: c.id, occurredAt: T0 + 3 * DAY, total: 999900, status: "void", plate: "ขข 3" });
    insertBill(db, { customerId: c.id, occurredAt: T0 - 5 * DAY, total: 777700, type: "purchase", plate: "คค 4" });
    insertBill(db, { customerId: c.id, occurredAt: T0 + 9 * DAY, total: 30000, type: "purchase", paymentStatus: "unpaid" });

    const got = await api.customers.get(c.id);
    expect(got.saleCount).toBe(2);
    expect(got.totalSpent).toBe(150000);
    expect(got.unpaidTotal).toBe(50000);
    expect(got.unpaidCount).toBe(1);
    expect(got.firstVisitAt).toBe(T0);
    expect(got.lastVisitAt).toBe(T0 + 2 * DAY);
    expect(got.vehiclePlates).toEqual(["กก 2", "กก 1"]);

    const listed = (await api.customers.list({})).items[0];
    expect(listed).toMatchObject({ saleCount: 2, totalSpent: 150000, unpaidTotal: 50000, lastVisitAt: T0 + 2 * DAY, vehiclePlates: ["กก 2", "กก 1"] });
  });

  it("groups vehicles by plate (spacing variants merged) with latest model and mileage", async () => {
    const { api, db } = setup();
    const c = await api.customers.create({ name: "เจ้าของรถ" });
    insertBill(db, { customerId: c.id, occurredAt: T0, plate: "กข1234", model: "Toyota Vios", mileage: 40000 });
    insertBill(db, { customerId: c.id, occurredAt: T0 + DAY, plate: "กข 1234", model: null, mileage: 45000 });
    insertBill(db, { customerId: c.id, occurredAt: T0 + 2 * DAY, plate: "ฒษ 9012", model: "Isuzu D-Max" });
    insertBill(db, { customerId: c.id, occurredAt: T0 + 3 * DAY, plate: "ฮฮ 1", status: "void" });
    const got = await api.customers.get(c.id);
    expect(got.vehicles).toEqual([
      { plate: "ฒษ 9012", model: "Isuzu D-Max", lastMileage: null, lastSeenAt: T0 + 2 * DAY, visitCount: 1 },
      { plate: "กข 1234", model: "Toyota Vios", lastMileage: 45000, lastSeenAt: T0 + DAY, visitCount: 2 },
    ]);
    expect(got.vehiclePlates).toEqual(["ฒษ 9012", "กข 1234"]);
  });
});

describe("customer list sorting", () => {
  it("sorts by recent visit, Thai name order and total spent", async () => {
    const { api, db } = setup();
    const a = await api.customers.create({ name: "ไพโรจน์" });
    const b = await api.customers.create({ name: "กมล" });
    const c = await api.customers.create({ name: "เอกชัย" });
    const d = await api.customers.create({ name: "Zed" });
    insertBill(db, { customerId: a.id, occurredAt: T0 + 5 * DAY, total: 1000 });
    insertBill(db, { customerId: b.id, occurredAt: T0 + 1 * DAY, total: 90000 });
    insertBill(db, { customerId: c.id, occurredAt: T0 + 3 * DAY, total: 5000 });
    void d;

    const order = async (sort: "name" | "recent" | "spent") => (await api.customers.list({ sort })).items.map((x) => x.name);
    // "Zed" has no visits: sorted by creation time (just now) -> first
    expect(await order("recent")).toEqual(["Zed", "ไพโรจน์", "เอกชัย", "กมล"]);
    // leading vowels are skipped: เอกชัย ~ อ, ไพโรจน์ ~ พ
    expect(await order("name")).toEqual(["Zed", "กมล", "ไพโรจน์", "เอกชัย"]);
    expect(await order("spent")).toEqual(["กมล", "เอกชัย", "ไพโรจน์", "Zed"]);

    const page = await api.customers.list({ sort: "name", limit: 2, offset: 1 });
    expect(page.total).toBe(4);
    expect(page.items.map((x) => x.name)).toEqual(["กมล", "ไพโรจน์"]);
  });
});

describe("customer history", () => {
  it("returns bills newest first with items, paging, and void only on request", async () => {
    const { api, db } = setup();
    const c = await api.customers.create({ name: "ประวัติ ยาว" });
    const other = await api.customers.create({ name: "คนอื่น" });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        insertBill(db, {
          customerId: c.id,
          occurredAt: T0 + i * DAY,
          plate: "กข 1234",
          items: [
            { name: "Michelin Primacy 4", itemType: "product", qty: 4, unitPrice: 365000 },
            { name: "ถ่วงล้อ", itemType: "service", qty: 4, unitPrice: 10000 },
          ],
        }),
      );
    }
    // same timestamp as the newest bill -> tie broken by id desc (later id first)
    const tie = insertBill(db, { customerId: c.id, occurredAt: T0 + 4 * DAY });
    const voided = insertBill(db, { customerId: c.id, occurredAt: T0 + 10 * DAY, status: "void" });
    insertBill(db, { customerId: other.id, occurredAt: T0 + 20 * DAY });

    const all = await api.customers.history({ customerId: c.id });
    expect(all.total).toBe(6);
    expect(all.items.map((x) => x.id)).toEqual([tie, ids[4], ids[3], ids[2], ids[1], ids[0]]);
    expect(all.items[1].items.map((i) => [i.itemType, i.name, i.qty])).toEqual([
      ["product", "Michelin Primacy 4", 4],
      ["service", "ถ่วงล้อ", 4],
    ]);
    expect(all.items[1].customer?.name).toBe("ประวัติ ยาว");
    expect(all.items[1].vehiclePlate).toBe("กข 1234");

    const page2 = await api.customers.history({ customerId: c.id, limit: 2, offset: 2 });
    expect(page2.total).toBe(6);
    expect(page2.items.map((x) => x.id)).toEqual([ids[3], ids[2]]);

    const withVoid = await api.customers.history({ customerId: c.id, includeVoid: true, limit: 3 });
    expect(withVoid.total).toBe(7);
    expect(withVoid.items[0].id).toBe(voided);
    expect(withVoid.items[0].status).toBe("void");
    expect(withVoid.items[0].voidReason).toBe("ทดสอบยกเลิก");

    const none = await api.customers.history({ customerId: other.id, offset: 5 });
    expect(none).toEqual({ items: [], total: 1 });
    expect((await apiError(() => api.customers.history({ customerId: "nope" }))).code).toBe("NOT_FOUND");
  });
});
