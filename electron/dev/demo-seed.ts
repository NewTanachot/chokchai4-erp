/**
 * Realistic sample data for development / screenshots (ERP_DEMO_SEED=1). Never runs in normal use.
 * Writes rows directly (deterministic PRNG, dates relative to "now") and keeps the stock ledger
 * consistent: products.stock_qty == SUM(stock_movements.qty).
 */
import { eq, sql } from "drizzle-orm";
import { computeTotals, lineTotal } from "@shared/calc";
import type { Permission } from "@shared/contract";
import { addDays, dateTimeMs, dayOfWeek, diffDays, startOfMonth, toDateStr } from "@shared/dates";
import { createCoreApi } from "../api";
import { writeAudit } from "../api/audit";
import type { ApiContext } from "../api/context";
import { recordPriceChange } from "../api/price-history";
import { hashPassword, type Actor } from "../api/session";
import { recomputeStock } from "../api/stock";
import { newId } from "../api/util";
import {
  attendance,
  categories,
  customers,
  docSequences,
  employees,
  leaves,
  products,
  salaryAdvances,
  serviceItems,
  stockMovements,
  transactionItems,
  transactions,
  users,
} from "../db/schema";

const B = (baht: number) => Math.round(baht * 100);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Cat = "tyre" | "battery" | "suspension" | "oil" | "other";
const CAT_NAME: Record<Cat, string> = {
  tyre: "ยางรถยนต์",
  battery: "แบตเตอรี่",
  suspension: "ช่วงล่าง",
  oil: "น้ำมันเครื่อง / ของเหลว",
  other: "อะไหล่อื่น ๆ",
};

const PRODUCTS: { cat: Cat; sku: string; name: string; brand: string; spec: string; unit: string; cost: number; sell: number; stock: number; min: number }[] = [
  { cat: "tyre", sku: "TY-MI-2055516", name: "Michelin Primacy 4", brand: "Michelin", spec: "205/55R16 91V", unit: "เส้น", cost: 2900, sell: 3650, stock: 16, min: 4 },
  { cat: "tyre", sku: "TY-BS-2156016", name: "Bridgestone Turanza T005A", brand: "Bridgestone", spec: "215/60R16 95H", unit: "เส้น", cost: 3100, sell: 3900, stock: 12, min: 4 },
  { cat: "tyre", sku: "TY-DL-1956515", name: "Dunlop SP Sport LM705", brand: "Dunlop", spec: "195/65R15 91V", unit: "เส้น", cost: 1950, sell: 2450, stock: 20, min: 8 },
  { cat: "tyre", sku: "TY-YK-2254517", name: "Yokohama BluEarth-GT AE51", brand: "Yokohama", spec: "225/45R17 94W", unit: "เส้น", cost: 3300, sell: 4200, stock: 8, min: 4 },
  { cat: "tyre", sku: "TY-GY-1856015", name: "Goodyear Assurance TripleMax 2", brand: "Goodyear", spec: "185/60R15 88H", unit: "เส้น", cost: 1800, sell: 2300, stock: 20, min: 8 },
  { cat: "tyre", sku: "TY-MX-1855515", name: "Maxxis MA-P5", brand: "Maxxis", spec: "185/55R15 82V", unit: "เส้น", cost: 1350, sell: 1750, stock: 12, min: 4 },
  { cat: "tyre", sku: "TY-DS-2656517", name: "Deestone Payak HT603", brand: "Deestone", spec: "265/65R17 112S", unit: "เส้น", cost: 2700, sell: 3450, stock: 16, min: 4 },
  { cat: "tyre", sku: "TY-BS-2656018", name: "Bridgestone Dueler H/T 684II", brand: "Bridgestone", spec: "265/60R18 110H", unit: "เส้น", cost: 3900, sell: 4900, stock: 6, min: 4 },
  { cat: "tyre", sku: "TY-MI-2457016", name: "Michelin LTX Trail", brand: "Michelin", spec: "245/70R16 111T", unit: "เส้น", cost: 3500, sell: 4450, stock: 8, min: 4 },
  { cat: "battery", sku: "BT-GS-MFX50L", name: "GS Battery MFX-50L", brand: "GS", spec: "12V 45Ah", unit: "ลูก", cost: 1650, sell: 2200, stock: 8, min: 3 },
  { cat: "battery", sku: "BT-3K-VS60L", name: "3K VS60L", brand: "3K", spec: "12V 50Ah", unit: "ลูก", cost: 1850, sell: 2450, stock: 6, min: 3 },
  { cat: "battery", sku: "BT-FB-55B24L", name: "FB Battery MF 55B24L", brand: "FB", spec: "12V 45Ah", unit: "ลูก", cost: 1750, sell: 2350, stock: 5, min: 3 },
  { cat: "battery", sku: "BT-AM-55D23L", name: "Amaron Pro 55D23L", brand: "Amaron", spec: "12V 60Ah", unit: "ลูก", cost: 2650, sell: 3390, stock: 4, min: 2 },
  { cat: "battery", sku: "BT-BS-80D26L", name: "Boss แบตแห้ง 80D26L", brand: "Boss", spec: "12V 70Ah", unit: "ลูก", cost: 2900, sell: 3700, stock: 3, min: 2 },
  { cat: "suspension", sku: "SU-KYB-VIOS-F", name: "โช้คอัพหน้า KYB Excel-G (Vios)", brand: "KYB", spec: "Toyota Vios 2013-2022", unit: "ต้น", cost: 1050, sell: 1450, stock: 6, min: 2 },
  { cat: "suspension", sku: "SU-MON-CITY-R", name: "โช้คอัพหลัง Monroe OESpectrum (City)", brand: "Monroe", spec: "Honda City 2014-2019", unit: "ต้น", cost: 1150, sell: 1600, stock: 12, min: 2 },
  { cat: "suspension", sku: "SU-333-CIVIC", name: "ลูกหมากปีกนกล่าง 333 (Civic)", brand: "333", spec: "Honda Civic FD/FB", unit: "ตัว", cost: 450, sell: 750, stock: 6, min: 2 },
  { cat: "suspension", sku: "SU-BUSH-STAB", name: "บูชกันโคลงหน้า", brand: "RBI", spec: "", unit: "คู่", cost: 120, sell: 250, stock: 10, min: 4 },
  { cat: "suspension", sku: "SU-NSK-HUB", name: "ลูกปืนล้อหน้า NSK", brand: "NSK", spec: "", unit: "ตัว", cost: 650, sell: 1050, stock: 4, min: 2 },
  { cat: "oil", sku: "OL-SH-HX8-4L", name: "Shell Helix HX8 5W-30 (4 ลิตร)", brand: "Shell", spec: "สังเคราะห์แท้ 5W-30", unit: "แกลลอน", cost: 980, sell: 1390, stock: 10, min: 4 },
  { cat: "oil", sku: "OL-CA-EDGE-4L", name: "Castrol EDGE 0W-20 (4 ลิตร)", brand: "Castrol", spec: "สังเคราะห์แท้ 0W-20", unit: "แกลลอน", cost: 1250, sell: 1690, stock: 6, min: 2 },
  { cat: "oil", sku: "OL-PTT-5W40-4L", name: "PTT Performa Synthetic 5W-40 (4 ลิตร)", brand: "PTT", spec: "5W-40", unit: "แกลลอน", cost: 690, sell: 990, stock: 12, min: 4 },
  { cat: "other", sku: "OT-VALVE-4", name: "จุ๊บลมยาง (ชุด 4 ตัว)", brand: "", spec: "", unit: "ชุด", cost: 40, sell: 100, stock: 30, min: 10 },
  { cat: "other", sku: "OT-FILTER-TY", name: "ไส้กรองน้ำมันเครื่อง Toyota", brand: "Toyota", spec: "90915-YZZE1", unit: "ลูก", cost: 120, sell: 220, stock: 15, min: 5 },
  { cat: "other", sku: "OT-WATER-1L", name: "น้ำกลั่นแบตเตอรี่ 1 ลิตร", brand: "", spec: "", unit: "ขวด", cost: 12, sell: 25, stock: 24, min: 6 },
];

const SERVICE_PRICES: Record<string, number> = {
  "ถอด-ใส่ยาง / เปลี่ยนยาง": 100,
  ปะยาง: 150,
  ถ่วงล้อ: 100,
  ตั้งศูนย์ล้อ: 500,
  สลับยาง: 200,
  เปลี่ยนแบตเตอรี่: 100,
  "ตรวจเช็คแบตเตอรี่ / ระบบไฟชาร์จ": 0,
  เปลี่ยนโช้คอัพ: 300,
  ตรวจเช็คช่วงล่าง: 200,
  เปลี่ยนน้ำมันเครื่อง: 150,
};

const CUSTOMERS = [
  { name: "สมชาย ใจดี", phone: "081-234-5678", lineId: "somchai.j" },
  { name: "วิภาวรรณ ศรีสุข", phone: "089-765-4321" },
  { name: "ประเสริฐ ทองมา", phone: "086-111-2233", shopName: "อู่ประเสริฐการช่าง" },
  { name: "นภัสสร แก้วกาญจนา", phone: "092-345-6789", email: "napassorn.k@gmail.com" },
  { name: "ธนากร วงศ์ใหญ่", phone: "085-222-3344", lineId: "tanakorn_w" },
  { name: "คุณวิชัย (สยามขนส่ง)", phone: "02-123-4567", shopName: "บริษัท สยามขนส่ง จำกัด", taxId: "0105561234567", address: "99/9 ถ.พหลโยธิน แขวงสามเสนใน เขตพญาไท กรุงเทพฯ 10400" },
  { name: "กิตติพงษ์ มั่นคง", phone: "083-456-7890" },
  { name: "สุดารัตน์ พรหมมา", phone: "087-654-3210", lineId: "sudarat.p" },
  { name: "อนุชา บุญเรือง", phone: "061-234-5678", shopName: "ร้านอนุชายางยนต์" },
  { name: "ปิยะพงษ์ แสงทอง", phone: "095-111-2222" },
  { name: "จันทร์เพ็ญ ชัยมงคล", phone: "064-999-8888", email: "chanpen.c@hotmail.com" },
  { name: "วีระ สุขสวัสดิ์", phone: "080-777-6666" },
];

const VEHICLES = [
  { plate: "กข 1234 กรุงเทพมหานคร", model: "Toyota Vios" },
  { plate: "1กก 5678 กรุงเทพมหานคร", model: "Honda City" },
  { plate: "ฒษ 9012 นนทบุรี", model: "Isuzu D-Max" },
  { plate: "3ขค 4455 กรุงเทพมหานคร", model: "Toyota Fortuner" },
  { plate: "7กย 8899 ปทุมธานี", model: "Honda Civic" },
  { plate: "2ฒท 1122 กรุงเทพมหานคร", model: "Mazda 2" },
  { plate: "บต 3344 สมุทรปราการ", model: "Ford Ranger" },
  { plate: "5กฉ 7788 กรุงเทพมหานคร", model: "Toyota Yaris" },
  { plate: "ญท 6655 นนทบุรี", model: "Nissan Almera" },
  { plate: "4กพ 2468 กรุงเทพมหานคร", model: "Mitsubishi Pajero Sport" },
  { plate: "70-1234 กรุงเทพมหานคร", model: "Isuzu NLR (รถบรรทุก)" },
  { plate: "8กม 1357 กรุงเทพมหานคร", model: "Toyota Camry" },
];

const SUPPLIERS = ["บจก. ไทยไทร์ ดิสทริบิวชั่น", "หจก. แบตเตอรี่เซ็นเตอร์", "ร้านอะไหล่ช่วงล่างเจริญยนต์", "บจก. ออยล์ พลัส"];

type StaffKey = "ton" | "may" | "ek" | "pong" | "wee";

/** Demo staff. Login PINs: เจ้าของร้าน 1234, พี่ต้น 2222, น้องเมย์ 1111. */
const STAFF: Record<StaffKey, { firstName: string; lastName: string; nickname: string; position: string; payType: "monthly" | "daily"; pay: number; ssf: boolean; start: string; phone: string; arrive: number }> = {
  ton: { firstName: "ธนพล", lastName: "ศรีสุข", nickname: "ต้น", position: "ผู้จัดการร้าน", payType: "monthly", pay: 18000, ssf: true, start: "2021-03-01", phone: "081-555-0101", arrive: 7 * 60 + 45 },
  may: { firstName: "เมทินี", lastName: "แก้วใส", nickname: "เมย์", position: "แคชเชียร์ / พนักงานขาย", payType: "monthly", pay: 12000, ssf: true, start: "2023-06-15", phone: "089-555-0202", arrive: 7 * 60 + 55 },
  ek: { firstName: "เอกชัย", lastName: "บุญมา", nickname: "เอก", position: "ช่างยาง", payType: "daily", pay: 450, ssf: false, start: "2022-01-10", phone: "086-555-0303", arrive: 8 * 60 + 5 },
  pong: { firstName: "สมพงษ์", lastName: "ใจกล้า", nickname: "พงษ์", position: "ช่างช่วงล่าง", payType: "daily", pay: 500, ssf: false, start: "2024-05-01", phone: "092-555-0404", arrive: 7 * 60 + 50 },
  wee: { firstName: "วีระ", lastName: "ทองคำ", nickname: "วี", position: "ผู้ช่วยช่าง", payType: "daily", pay: 400, ssf: false, start: "2025-11-01", phone: "064-555-0505", arrive: 8 * 60 + 10 },
};

const MANAGER_PERMISSIONS: Permission[] = [
  "purchases.create",
  "transactions.edit",
  "transactions.void",
  "customers.manage",
  "catalog.manage",
  "stock.adjust",
  "reports.view",
  "attendance.manage",
];

interface Line {
  itemType: "product" | "service" | "custom";
  productId?: string;
  serviceItemId?: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  discount?: number;
  unitCost: number;
}

export async function seedDemo(ctx: ApiContext): Promise<void> {
  const { db } = ctx;
  const existing = db.select({ n: sql<number>`count(*)` }).from(transactions).get()?.n ?? 0;
  if (existing > 0) return;

  const rnd = mulberry32(42);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const nowMs = Date.now();
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const at = (daysAgo: number, hour: number, minute: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return Math.min(d.getTime(), nowMs - 60_000);
  };
  const created = nowMs;
  // Separate random stream for the staff / history data, so the sales above stay the same as before.
  const srnd = mulberry32(7);
  const staffIds = {} as Record<StaffKey, string>;
  const userIds = { owner: newId(), ton: newId(), may: newId(), ek: newId() };
  const actors: Record<keyof typeof userIds, Actor> = {
    owner: { id: userIds.owner, name: "เจ้าของร้าน" },
    ton: { id: userIds.ton, name: "พี่ต้น" },
    may: { id: userIds.may, name: "น้องเมย์" },
    ek: { id: userIds.ek, name: "ช่างเอก" },
  };

  db.transaction((tx) => {
    for (const [key, e] of Object.entries(STAFF) as [StaffKey, (typeof STAFF)[StaffKey]][]) {
      const id = newId();
      staffIds[key] = id;
      tx.insert(employees)
        .values({
          id,
          code: `E${String(Object.keys(staffIds).length).padStart(2, "0")}`,
          firstName: e.firstName,
          lastName: e.lastName,
          nickname: e.nickname,
          position: e.position,
          phone: e.phone,
          startDate: e.start,
          payType: e.payType,
          payRate: B(e.pay),
          socialSecurity: e.ssf,
          bankName: e.payType === "monthly" ? "กสิกรไทย" : null,
          bankAccount: e.payType === "monthly" ? `123-4-5${String(Object.keys(staffIds).length).padStart(4, "0")}-0` : null,
          createdAt: at(60, 9, 0),
          updatedAt: at(60, 9, 0),
        })
        .run();
    }
    const addUser = (key: keyof typeof userIds, name: string, role: "owner" | "staff", password: string | null, perms: Permission[], employeeId: string | null) =>
      tx.insert(users)
        .values({
          id: userIds[key],
          name,
          role,
          permissions: JSON.stringify(perms),
          passwordHash: password === null ? null : hashPassword(password),
          employeeId,
          createdAt: at(60, 9, 0),
          updatedAt: at(60, 9, 0),
        })
        .run();
    addUser("owner", "เจ้าของร้าน", "owner", "1234", [], null);
    addUser("ton", "พี่ต้น", "staff", "2222", MANAGER_PERMISSIONS, staffIds.ton);
    addUser("may", "น้องเมย์", "staff", "1111", ["purchases.create", "transactions.edit", "customers.manage"], staffIds.may);
    // Logs in by tapping the name (no password).
    addUser("ek", "ช่างเอก", "staff", null, [], staffIds.ek);
  });

  db.transaction((tx) => {
    const catIds = new Map<string, string>();
    for (const c of tx.select().from(categories).all()) catIds.set(c.name, c.id);
    for (const [key, name] of Object.entries(CAT_NAME)) {
      if (!catIds.has(name)) {
        const id = newId();
        tx.insert(categories).values({ id, name, sortOrder: 99, createdAt: created, updatedAt: created }).run();
        catIds.set(name, id);
      }
      void key;
    }

    const prod = PRODUCTS.map((p) => {
      const id = newId();
      tx.insert(products)
        .values({
          id,
          sku: p.sku,
          name: p.name,
          categoryId: catIds.get(CAT_NAME[p.cat]) ?? null,
          brand: p.brand || null,
          spec: p.spec || null,
          unit: p.unit,
          costPrice: B(p.cost),
          sellPrice: B(p.sell),
          minStock: p.min,
          createdAt: at(60, 9, 0),
          updatedAt: at(60, 9, 0),
        })
        .run();
      tx.insert(stockMovements)
        .values({ id: newId(), productId: id, type: "initial", qty: p.stock, unitCost: B(p.cost), note: "ยอดยกมา", occurredAt: at(45, 9, 0), createdAt: created, updatedAt: created })
        .run();
      return { ...p, id };
    });
    const byCat = (c: Cat) => prod.filter((p) => p.cat === c);

    const svc = new Map<string, { id: string; name: string; unit: string; price: number }>();
    for (const s of tx.select().from(serviceItems).all()) {
      const price = SERVICE_PRICES[s.name];
      if (price !== undefined && s.defaultPrice === 0) {
        tx.update(serviceItems).set({ defaultPrice: B(price), updatedAt: created }).where(eq(serviceItems.id, s.id)).run();
      }
      svc.set(s.name, { id: s.id, name: s.name, unit: s.unit, price: B(price ?? 0) || s.defaultPrice });
    }
    const S = (name: string, qty = 1): Line => {
      const s = svc.get(name);
      if (!s) return { itemType: "custom", name, unit: "ครั้ง", qty, unitPrice: 0, unitCost: 0 };
      return { itemType: "service", serviceItemId: s.id, name: s.name, unit: s.unit, qty, unitPrice: s.price, unitCost: 0 };
    };
    const P = (p: (typeof prod)[number], qty: number, price = B(p.sell)): Line => ({
      itemType: "product",
      productId: p.id,
      name: p.spec ? `${p.name} ${p.spec}` : p.name,
      unit: p.unit,
      qty,
      unitPrice: price,
      unitCost: B(p.cost),
    });

    const custIds = CUSTOMERS.map((c, i) => {
      const id = newId();
      tx.insert(customers)
        .values({ id, name: c.name, phone: c.phone, lineId: c.lineId ?? null, email: c.email ?? null, shopName: c.shopName ?? null, taxId: c.taxId ?? null, address: c.address ?? null, createdAt: at(50 - i, 10, 0), updatedAt: at(50 - i, 10, 0) })
        .run();
      return id;
    });

    const seq = new Map<string, number>();
    const docNo = (type: "sale" | "purchase", ms: number) => {
      const d = new Date(ms);
      const key = `${type === "sale" ? "S" : "P"}${String((d.getFullYear() + 543) % 100).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}`;
      const n = (seq.get(key) ?? 0) + 1;
      seq.set(key, n);
      return `${key}-${String(n).padStart(4, "0")}`;
    };

    const write = (t: {
      type: "sale" | "purchase";
      occurredAt: number;
      customerIdx?: number;
      contactName?: string;
      vehicle?: { plate: string; model: string };
      mileage?: number;
      lines: Line[];
      discount?: number;
      paymentMethod?: "cash" | "transfer" | "card" | "credit";
      unpaid?: boolean;
      /** Paid later than the bill date (credit collected): when the money came in. */
      paidAt?: number;
      note?: string;
      void?: boolean;
    }) => {
      const id = newId();
      // Who entered it: purchases by the owner / manager, sales mostly at the counter.
      const by: Actor = t.type === "purchase" ? (srnd() < 0.5 ? actors.owner : actors.ton) : [actors.may, actors.may, actors.ton, actors.owner][Math.floor(srnd() * 4)];
      const voidBy = actors.ton;
      const totals = computeTotals({ lines: t.lines, discount: t.discount ?? 0, vatMode: "none", vatRate: 0 });
      tx.insert(transactions)
        .values({
          id,
          type: t.type,
          docNo: docNo(t.type, t.occurredAt),
          status: t.void ? "void" : "completed",
          occurredAt: t.occurredAt,
          customerId: t.customerIdx !== undefined ? custIds[t.customerIdx] : null,
          contactName: t.contactName ?? (t.customerIdx !== undefined ? CUSTOMERS[t.customerIdx].name : null),
          contactPhone: t.customerIdx !== undefined ? CUSTOMERS[t.customerIdx].phone : null,
          vehiclePlate: t.vehicle?.plate ?? null,
          vehicleModel: t.vehicle?.model ?? null,
          mileage: t.mileage ?? null,
          subtotal: totals.subtotal,
          discount: totals.discount,
          vatMode: "none",
          vatRate: 0,
          vatAmount: 0,
          total: totals.total,
          paymentMethod: t.paymentMethod ?? "cash",
          paymentStatus: t.unpaid ? "unpaid" : "paid",
          paidAt: t.unpaid ? null : (t.paidAt ?? t.occurredAt),
          note: t.note ?? null,
          voidedAt: t.void ? t.occurredAt + 3_600_000 : null,
          voidReason: t.void ? "ลูกค้ายกเลิก" : null,
          createdBy: by.id,
          updatedBy: t.void ? voidBy.id : by.id,
          voidedBy: t.void ? voidBy.id : null,
          createdAt: t.occurredAt,
          updatedAt: t.occurredAt,
        })
        .run();
      const docNoOf = tx.select({ docNo: transactions.docNo }).from(transactions).where(eq(transactions.id, id)).get()!.docNo;
      writeAudit(tx, by, {
        entityType: "transaction",
        entityId: id,
        entityLabel: docNoOf,
        action: "create",
        changes: [
          { field: "total", from: null, to: totals.total },
          { field: "paymentMethod", from: null, to: t.paymentMethod ?? "cash" },
          { field: "paymentStatus", from: null, to: t.unpaid ? "unpaid" : "paid" },
        ],
        at: t.occurredAt,
      });
      if (t.void) {
        writeAudit(tx, voidBy, {
          entityType: "transaction",
          entityId: id,
          entityLabel: docNoOf,
          action: "void",
          changes: [{ field: "status", from: "completed", to: "void" }],
          note: "ลูกค้ายกเลิก",
          at: t.occurredAt + 3_600_000,
        });
      }
      t.lines.forEach((l, i) => {
        const itemId = newId();
        tx.insert(transactionItems)
          .values({
            id: itemId,
            transactionId: id,
            lineNo: i + 1,
            itemType: l.itemType,
            productId: l.productId ?? null,
            serviceItemId: l.serviceItemId ?? null,
            name: l.name,
            unit: l.unit,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discount: l.discount ?? 0,
            total: lineTotal(l),
            unitCost: t.type === "purchase" ? l.unitPrice : l.unitCost,
            createdAt: t.occurredAt,
            updatedAt: t.occurredAt,
          })
          .run();
        if (l.productId && !t.void) {
          tx.insert(stockMovements)
            .values({
              id: newId(),
              productId: l.productId,
              type: t.type,
              qty: t.type === "sale" ? -l.qty : l.qty,
              unitCost: t.type === "purchase" ? l.unitPrice : l.unitCost,
              transactionId: id,
              transactionItemId: itemId,
              occurredAt: t.occurredAt,
              createdAt: t.occurredAt,
              updatedAt: t.occurredAt,
            })
            .run();
        }
      });
    };

    // --- purchases (restocking) ---
    const purchasePlan: { daysAgo: number; supplier: number; items: [Cat, number, number][] }[] = [
      { daysAgo: 28, supplier: 0, items: [["tyre", 0, 8], ["tyre", 2, 12], ["tyre", 4, 8]] },
      { daysAgo: 21, supplier: 1, items: [["battery", 0, 6], ["battery", 1, 4]] },
      { daysAgo: 16, supplier: 2, items: [["suspension", 0, 4], ["suspension", 2, 4]] },
      { daysAgo: 12, supplier: 3, items: [["oil", 0, 6], ["oil", 2, 6]] },
      { daysAgo: 7, supplier: 0, items: [["tyre", 6, 8], ["tyre", 1, 8]] },
      { daysAgo: 3, supplier: 1, items: [["battery", 2, 4], ["battery", 3, 2]] },
      { daysAgo: 0, supplier: 0, items: [["tyre", 3, 4], ["tyre", 5, 8]] },
    ];
    for (const p of purchasePlan) {
      const lines = p.items.map(([cat, idx, qty]) => {
        const item = byCat(cat)[idx];
        return P(item, qty, B(item.cost));
      });
      write({ type: "purchase", occurredAt: at(p.daysAgo, 9, 15 + p.supplier * 7), contactName: SUPPLIERS[p.supplier], lines, paymentMethod: p.daysAgo === 0 ? "credit" : "transfer", unpaid: p.daysAgo <= 3, note: p.daysAgo === 0 ? "ครบกำหนดชำระ 30 วัน" : undefined });
    }

    // --- sales over the last 30 days ---
    const recipes: ((c?: number) => { lines: Line[]; discount?: number })[] = [
      () => {
        const t = pick(byCat("tyre"));
        const lines = [P(t, 4), S("ถอด-ใส่ยาง / เปลี่ยนยาง", 4), S("ถ่วงล้อ", 4)];
        if (rnd() < 0.5) lines.push(S("ตั้งศูนย์ล้อ"));
        if (rnd() < 0.4) lines.push(P(byCat("other")[0], 1));
        const sub = lines.reduce((s, l) => s + lineTotal(l), 0);
        return { lines, discount: sub % 10000 }; // ปัดเศษร้อย
      },
      () => {
        const t = pick(byCat("tyre"));
        return { lines: [P(t, 2), S("ถอด-ใส่ยาง / เปลี่ยนยาง", 2), S("ถ่วงล้อ", 2)] };
      },
      () => ({ lines: [P(pick(byCat("battery")), 1), S("เปลี่ยนแบตเตอรี่"), S("ตรวจเช็คแบตเตอรี่ / ระบบไฟชาร์จ")] }),
      () => ({ lines: [S("ปะยาง", rnd() < 0.3 ? 2 : 1)] }),
      () => ({ lines: [P(pick(byCat("oil")), 1), P(byCat("other")[1], 1), S("เปลี่ยนน้ำมันเครื่อง")] }),
      () => {
        const s = byCat("suspension")[Math.floor(rnd() * 2)];
        return { lines: [P(s, 2), S("เปลี่ยนโช้คอัพ", 2), S("ตั้งศูนย์ล้อ"), S("ตรวจเช็คช่วงล่าง")] };
      },
      () => ({ lines: [S("สลับยาง"), S("ถ่วงล้อ", 4)] }),
      () => ({ lines: [P(byCat("suspension")[2], 2), P(byCat("suspension")[3], 1), S("ตรวจเช็คช่วงล่าง"), { itemType: "custom", name: "ค่าแรงเปลี่ยนลูกหมาก", unit: "งาน", qty: 1, unitPrice: B(400), unitCost: 0 }] }),
    ];

    let saleNo = 0;
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      const count = daysAgo === 0 ? 4 : Math.floor(rnd() * 3) + (new Date(at(daysAgo, 12, 0)).getDay() === 0 ? 0 : 1);
      for (let k = 0; k < count; k++) {
        saleNo++;
        const walkIn = rnd() < 0.3;
        const customerIdx = walkIn ? undefined : Math.floor(rnd() * CUSTOMERS.length);
        const recipe = walkIn && rnd() < 0.6 ? recipes[3] : pick(recipes);
        const { lines, discount } = recipe(customerIdx);
        const vehicle = customerIdx !== undefined ? VEHICLES[customerIdx] : rnd() < 0.5 ? pick(VEHICLES) : undefined;
        const hour = daysAgo === 0 ? 8 + k * 1 : 8 + Math.floor(rnd() * 9);
        write({
          type: "sale",
          occurredAt: at(daysAgo, hour, Math.floor(rnd() * 60)),
          customerIdx,
          contactName: walkIn ? "ลูกค้าหน้าร้าน" : undefined,
          vehicle,
          mileage: vehicle ? 20000 + Math.floor(rnd() * 150000) : undefined,
          lines,
          discount,
          paymentMethod: pick(["cash", "cash", "transfer", "transfer", "card"] as const),
          void: saleNo === 9,
        });
      }
    }

    // Wholesale on credit to a shop customer (unpaid)
    write({
      type: "sale",
      occurredAt: at(2, 15, 30),
      customerIdx: 8,
      lines: [P(byCat("tyre")[2], 4, B(2200)), P(byCat("tyre")[4], 4, B(2050))],
      paymentMethod: "credit",
      unpaid: true,
      note: "ราคาส่ง — ชำระภายใน 15 วัน",
    });
    write({
      type: "sale",
      occurredAt: at(5, 11, 0),
      customerIdx: 5,
      vehicle: VEHICLES[10],
      mileage: 312450,
      lines: [P(byCat("tyre")[6], 6, B(3300)), S("ถอด-ใส่ยาง / เปลี่ยนยาง", 6), S("ถ่วงล้อ", 6), S("ตั้งศูนย์ล้อ")],
      paymentMethod: "credit",
      unpaid: true,
      note: "วางบิลสิ้นเดือน",
    });
    // Credit sale from last week, collected in cash this morning (dashboard: รับชำระบิลค้างที่ออกก่อนวันนี้)
    write({
      type: "sale",
      occurredAt: at(8, 14, 10),
      customerIdx: 3,
      lines: [P(byCat("battery")[0], 2), S("เปลี่ยนแบตเตอรี่", 2)],
      paymentMethod: "cash",
      paidAt: at(0, 8, 5),
      note: "ขายเชื่อ — รับชำระแล้ว",
    });

    for (const [key, lastNo] of seq) {
      tx.insert(docSequences).values({ key, lastNo }).onConflictDoUpdate({ target: docSequences.key, set: { lastNo } }).run();
    }
    for (const p of prod) recomputeStock(tx, p.id, created);

    // Price history: prices set when the products were added; a few sell prices raised by the manager since.
    for (const p of prod) {
      const raised = ["TY-MI-2055516", "BT-GS-MFX50L", "OL-SH-HX8-4L"].includes(p.sku);
      const firstSell = raised ? B(p.sell - 100) : B(p.sell);
      recordPriceChange(tx, { itemType: "product", itemId: p.id, field: "sell", oldValue: null, newValue: firstSell, source: "create", actor: actors.owner, at: at(60, 9, 0) });
      recordPriceChange(tx, { itemType: "product", itemId: p.id, field: "cost", oldValue: null, newValue: B(p.cost), source: "create", actor: actors.owner, at: at(60, 9, 0) });
      if (raised) {
        recordPriceChange(tx, { itemType: "product", itemId: p.id, field: "sell", oldValue: firstSell, newValue: B(p.sell), source: "manual", actor: actors.ton, at: at(12, 17, 30) });
        writeAudit(tx, actors.ton, {
          entityType: "product",
          entityId: p.id,
          entityLabel: p.spec ? `${p.name} ${p.spec}` : p.name,
          action: "update",
          changes: [{ field: "sellPrice", from: firstSell, to: B(p.sell) }],
          at: at(12, 17, 30),
        });
      }
    }
    for (const s of svc.values()) {
      if (s.price > 0) recordPriceChange(tx, { itemType: "service", itemId: s.id, field: "sell", oldValue: 0, newValue: s.price, source: "manual", actor: actors.owner, at: at(59, 10, 0) });
    }

    // Attendance since the start of last month (Mon-Sat): a sick day, an absence, some late mornings and OT evenings.
    const firstDay = startOfMonth(addDays(startOfMonth(toDateStr(nowMs)), -1));
    for (let daysAgo = diffDays(firstDay, toDateStr(nowMs)); daysAgo >= 0; daysAgo--) {
      const date = toDateStr(at(daysAgo, 12, 0));
      if (dayOfWeek(date) === 0) continue;
      for (const [key, e] of Object.entries(STAFF) as [StaffKey, (typeof STAFF)[StaffKey]][]) {
        if (date < e.start) continue;
        const r = srnd();
        if (key === "wee" && daysAgo === 16) {
          tx.insert(leaves).values({ id: newId(), employeeId: staffIds[key], date, type: "sick", note: "ไข้หวัด", createdBy: userIds.ton, createdAt: created, updatedAt: created }).run();
          continue;
        }
        if (key === "pong" && daysAgo === 9) continue; // absent (no leave)
        const late = r < 0.12 ? 20 + Math.floor(srnd() * 25) : 0;
        const inMin = e.arrive + Math.floor(srnd() * 12) - 6 + late;
        const outMin = 17 * 60 + (srnd() < 0.2 ? 45 + Math.floor(srnd() * 60) : Math.floor(srnd() * 20));
        const clockIn = dateTimeMs(date, `${String(Math.floor(inMin / 60)).padStart(2, "0")}:${String(inMin % 60).padStart(2, "0")}`);
        if (clockIn > nowMs) continue; // not here yet today
        const outAt = dateTimeMs(date, `${String(Math.floor(outMin / 60)).padStart(2, "0")}:${String(outMin % 60).padStart(2, "0")}`);
        tx.insert(attendance)
          .values({
            id: newId(),
            employeeId: staffIds[key],
            workDate: date,
            clockIn,
            clockOut: outAt > nowMs ? null : outAt,
            source: "clock",
            createdAt: clockIn,
            updatedAt: outAt > nowMs ? clockIn : outAt,
          })
          .run();
      }
    }

    // Salary advances this month (not yet deducted).
    const thisMonth = startOfMonth(toDateStr(nowMs));
    tx.insert(salaryAdvances)
      .values({ id: newId(), employeeId: staffIds.ek, date: addDays(thisMonth, 4) <= toDateStr(nowMs) ? addDays(thisMonth, 4) : thisMonth, amount: B(1500), note: "เบิกค่าเทอมลูก", createdBy: userIds.owner, createdAt: created, updatedAt: created })
      .run();
    tx.insert(salaryAdvances)
      .values({ id: newId(), employeeId: staffIds.may, date: thisMonth, amount: B(1000), createdBy: userIds.owner, createdAt: created, updatedAt: created })
      .run();
  });

  // Last month's payroll, calculated and paid through the API (as the owner).
  const api = createCoreApi(ctx);
  const prevEnd = addDays(startOfMonth(toDateStr(nowMs)), -1);
  const prevStart = startOfMonth(prevEnd);
  const saved = ctx.session.userId;
  ctx.session.userId = userIds.owner;
  try {
    const run = await api.payroll.createRun({ periodStart: prevStart, periodEnd: prevEnd, employeeIds: Object.values(staffIds) });
    await api.payroll.pay({ ids: run.payslips.map((p) => p.id), paymentMethod: "transfer", paidAt: dateTimeMs(addDays(prevEnd, 1), "10:00") });
  } finally {
    ctx.session.userId = saved;
  }
  console.log("[demo-seed] sample data created");
}
