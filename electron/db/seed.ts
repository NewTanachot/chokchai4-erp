import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { categories, serviceItems } from "./schema";
import { newId } from "../api/util";
import { readMeta, writeMeta } from "../api/settings";

const DEFAULT_CATEGORIES = ["ยางรถยนต์", "แบตเตอรี่", "ช่วงล่าง", "น้ำมันเครื่อง / ของเหลว", "อะไหล่อื่น ๆ"];

/** Common services as a starting template. Prices are 0 on purpose - the shop sets its own. */
const DEFAULT_SERVICES: { name: string; unit: string }[] = [
  { name: "ถอด-ใส่ยาง / เปลี่ยนยาง", unit: "เส้น" },
  { name: "ปะยาง", unit: "จุด" },
  { name: "ถ่วงล้อ", unit: "ล้อ" },
  { name: "ตั้งศูนย์ล้อ", unit: "คัน" },
  { name: "สลับยาง", unit: "คัน" },
  { name: "เปลี่ยนแบตเตอรี่", unit: "ครั้ง" },
  { name: "ตรวจเช็คแบตเตอรี่ / ระบบไฟชาร์จ", unit: "ครั้ง" },
  { name: "เปลี่ยนโช้คอัพ", unit: "ต้น" },
  { name: "ตรวจเช็คช่วงล่าง", unit: "ครั้ง" },
  { name: "เปลี่ยนน้ำมันเครื่อง", unit: "ครั้ง" },
];

/** First-run defaults. Runs once per database (tracked in settings meta). */
export function seedDefaults(db: Db): void {
  if (readMeta<boolean>(db, "seeded")) return;
  const at = Date.now();
  db.transaction((tx) => {
    const hasCategories = tx.select({ n: sql<number>`count(*)` }).from(categories).get()?.n ?? 0;
    if (!hasCategories) {
      DEFAULT_CATEGORIES.forEach((name, i) =>
        tx.insert(categories).values({ id: newId(), name, sortOrder: i, createdAt: at, updatedAt: at }).run(),
      );
    }
    const hasServices = tx.select({ n: sql<number>`count(*)` }).from(serviceItems).get()?.n ?? 0;
    if (!hasServices) {
      for (const s of DEFAULT_SERVICES) {
        tx.insert(serviceItems).values({ id: newId(), name: s.name, unit: s.unit, defaultPrice: 0, createdAt: at, updatedAt: at }).run();
      }
    }
  });
  writeMeta(db, "seeded", true);
  if (!readMeta<string>(db, "deviceId")) writeMeta(db, "deviceId", newId());
}
