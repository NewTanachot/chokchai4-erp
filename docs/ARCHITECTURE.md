# สถาปัตยกรรมระบบ และแผน Phase 2 (เชื่อมต่อ Web App)

## ภาพรวม (Phase 1 — ออฟไลน์ 100%)

```
┌──────────────────────── Electron app (เครื่องหน้าร้าน) ────────────────────────┐
│  Renderer: Next.js 16 static export (React 19, Tailwind 4, shadcn/ui)          │
│     หน้าจอทั้งหมดเรียกข้อมูลผ่าน  api.<namespace>.<method>()   (src/lib/api.ts)    │
│                         │  window.erp.invoke("products.list", {...})           │
│                         ▼  IPC ช่องเดียว "erp:invoke" (contextIsolation, sandbox) │
│  Main process: electron/api/*.ts  — ตรวจ input ด้วย zod, business logic           │
│                         ▼  Drizzle ORM                                         │
│  SQLite (better-sqlite3, WAL) : <userData>/chokchai4.db  + backups/             │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **สัญญา API กลาง** `shared/contract/*.ts` (`ErpApi`) — เป็นทั้ง TypeScript interface และ zod schema
  UI ไม่รู้จักฐานข้อมูลเลย รู้จักแค่สัญญานี้
- **ตัวเลขเงิน** เก็บเป็นสตางค์ (integer) ทุกที่ คำนวณบิลด้วย `shared/calc.ts` ชุดเดียวทั้ง UI และฝั่งบันทึก
- **สต็อก** เป็นแบบสมุดบัญชี (`stock_movements`) ยอดคงเหลือ = ผลรวมการเคลื่อนไหว แก้ไข/ยกเลิกบิลแล้วคำนวณใหม่ได้ถูกต้อง
- **เลขที่เอกสาร** `S6909-0001` (คำนำหน้า + ปี พ.ศ. 2 หลัก + เดือน + ลำดับ) ต่อเดือน ต่อประเภท

## ทำไมเลือก SQLite

| ตัวเลือก | ข้อดี | ข้อเสีย | สรุป |
|---|---|---|---|
| **SQLite (better-sqlite3 + Drizzle)** | เร็วมาก, เสถียรระดับอุตสาหกรรม, ไฟล์เดียว สำรองง่าย, ไม่ต้องลงเซิร์ฟเวอร์, v13 มี binary สำเร็จรูปทุก OS (build Windows จาก Mac ได้) | ไม่ sync เองอัตโนมัติ | ✅ เลือกใช้ |
| libSQL / Turso | SQLite-compatible + embedded replica sync ขึ้น cloud | ผูกกับผู้ให้บริการ, offline write ยังใหม่ | ตัวเลือก Phase 2 |
| PGlite (Postgres WASM) | dialect เดียวกับ Postgres ฝั่งเว็บ | ยังใหม่, กินหน่วยความจำกว่า | ไม่เลือกตอนนี้ |
| IndexedDB / sql.js | ไม่มี native module | ความทนทานข้อมูลต่ำ, query ยาก | ไม่เหมาะกับข้อมูลธุรกิจ |

## สิ่งที่เตรียมไว้แล้วเพื่อ Phase 2

- ID เป็น **UUIDv7** สร้างที่เครื่อง (ไม่ชนกันข้ามเครื่อง เรียงตามเวลาได้)
- ทุกตารางหลักมี `created_at / updated_at / deleted_at` (soft delete) → sync แบบ incremental ได้
- `deviceId` เก็บใน settings (meta) ไว้ระบุเครื่อง
- UI คุยผ่าน `ErpApi` เท่านั้น → เปลี่ยน transport จาก IPC เป็น HTTP ได้โดยไม่แก้หน้าจอ
- ข้อความทั้งหมดผ่าน `tr()` + พจนานุกรม `shared/i18n/en.json` (ไทย/อังกฤษ) ข้อความ error จากฝั่งเซิร์ฟเวอร์เป็นภาษาไทย
  แล้วหน้าจอแปลเอง → backend ใหม่ส่งข้อความแบบเดิมได้เลย
- Drizzle schema ย้ายไป Postgres ได้ไม่ยาก (โครงสร้างตารางเดียวกัน, เงินเป็น integer)

## แนวทาง Phase 2

**A. Online-first (ง่ายสุด)** — ทำ backend (เช่น Next.js route handlers / Hono + Postgres + Drizzle) ที่ implement `ErpApi`
เดิม ใช้ zod schema ชุดเดิม แล้วสลับ `src/lib/api.ts` เป็น `fetch` → ได้ทั้งเว็บและเดสก์ท็อปใช้ข้อมูลเดียวกัน
แต่ถ้าอินเทอร์เน็ตล่ม หน้าร้านจะใช้งานไม่ได้

**B. Offline-first + sync (แนะนำสำหรับหน้าร้าน)** — เครื่องหน้าร้านยังใช้ SQLite เหมือนเดิม และมีตัว sync ใน main process:
1. เพิ่มตาราง `sync_outbox` / คอลัมน์ `sync_version` บันทึกการเปลี่ยนแปลงที่ยังไม่ส่ง
2. ส่งขึ้น (push) เป็นหน่วย aggregate: ลูกค้า, สินค้า, บริการ, หมวดหมู่, บิล(+รายการ) — stock movements คำนวณใหม่ได้จากบิล
   ยกเว้นการปรับยอด (adjust) ที่ต้อง sync ด้วย
3. ดึงลง (pull) ตาม `updated_at > last_pulled_at`, ชนกันใช้ last-write-wins รายแถว (หรือกฎเฉพาะ เช่น บิลที่ void แล้วห้ามแก้)
4. เลขที่เอกสารใส่รหัสเครื่อง เช่น `S1-6909-0001` เพื่อไม่ให้ชนกันเมื่อมีหลายเครื่อง

Phase 2 ทุกแบบ: session ต้องเปลี่ยนจากตัวแปรใน main process เป็น token/cookie ต่อ request แต่ใช้กฎ `ACCESS`
ชุดเดิมได้ทั้งหมด ส่วน `audit_logs` / `price_changes` เป็นข้อมูลเพิ่มอย่างเดียว (append-only) จึง sync ง่าย

**C. ใช้บริการ sync สำเร็จรูป** — Turso embedded replicas, PowerSync หรือ ElectricSQL (+Postgres) ลดโค้ดที่ต้องเขียนเอง
แลกกับการผูกกับผู้ให้บริการ

## ความปลอดภัย

- Renderer ไม่มีสิทธิ์ Node (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`)
- IPC รับคำขอเฉพาะจากหน้าของแอปเอง (`app://erp` หรือ dev server) และทุก handler ตรวจ input ด้วย zod
- หน้าเว็บในแอปมี Content-Security-Policy, ห้ามเปิดหน้าต่างใหม่/นำทางออกนอกแอป (ลิงก์ภายนอกเปิดในเบราว์เซอร์)
- ต้องเข้าสู่ระบบก่อนใช้งาน (รหัสผ่านเก็บเป็น scrypt hash, ใส่ผิดหลายครั้งต้องรอ, เจ้าของร้านมีรหัสกู้คืน)
  เจ้าของร้านเลือกให้บางบัญชีไม่ใช้รหัสผ่านได้ (แตะชื่อเข้าใช้) — สิทธิ์ของบัญชีนั้นยังตรวจเหมือนเดิม
  ผู้ใช้ที่ล็อกอินอยู่เก็บใน main process (`ctx.session`) หน้าจอปลอมไม่ได้
- ทุกคำสั่งผ่านกฎสิทธิ์ `ACCESS` (electron/api/access.ts) ที่ขอบ IPC ก่อนถึง handler: สาธารณะ / ผู้ใช้ทุกคน /
  เจ้าของร้าน / สิทธิ์ที่เจ้าของร้านเลือกให้พนักงานแต่ละคน การซ่อนปุ่มในหน้าจอเป็นแค่ความสะดวก ไม่ใช่ตัวกันสิทธิ์
- ทุกการแก้ไขบันทึกประวัติ (`audit_logs`, `price_changes`) ใน transaction เดียวกับการแก้ไข และแก้ไข/ลบประวัติไม่ได้
