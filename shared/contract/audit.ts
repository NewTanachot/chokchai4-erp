/** Change history (ประวัติการแก้ไข): who changed what and when, plus the price history of products and services. */
import { z } from "zod";
import { idSchema, pageSchema, type ID, type Millis, type Paged } from "./common";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, TRANSACTION_STATUS_LABELS } from "./transactions";

export type AuditEntityType =
  | "transaction"
  | "product"
  | "service"
  | "category"
  | "customer"
  | "employee"
  | "user"
  | "attendance"
  | "leave"
  | "advance"
  | "payroll"
  | "payslip"
  | "settings"
  | "system";

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  transaction: "บิลซื้อ-ขาย",
  product: "สินค้า",
  service: "บริการ",
  category: "หมวดหมู่",
  customer: "ลูกค้า",
  employee: "พนักงาน",
  user: "ผู้ใช้งาน",
  attendance: "เวลาทำงาน",
  leave: "วันลา",
  advance: "เบิกเงินล่วงหน้า",
  payroll: "งวดเงินเดือน",
  payslip: "สลิปเงินเดือน",
  settings: "ตั้งค่า",
  system: "ระบบ",
};

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "void"
  | "pay"
  | "unpay"
  | "stock_adjust"
  | "login"
  | "login_failed"
  | "logout"
  | "password_change"
  | "password_reset"
  | "password_remove"
  | "recover"
  | "backup"
  | "restore";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: "สร้าง",
  update: "แก้ไข",
  delete: "ลบ",
  void: "ยกเลิก",
  pay: "ชำระเงิน",
  unpay: "ยกเลิกการชำระ",
  stock_adjust: "ปรับสต็อก",
  login: "เข้าสู่ระบบ",
  login_failed: "เข้าสู่ระบบไม่สำเร็จ",
  logout: "ออกจากระบบ",
  password_change: "เปลี่ยนรหัสผ่าน",
  password_reset: "ตั้งรหัสผ่านใหม่",
  password_remove: "ยกเลิกรหัสผ่าน",
  recover: "กู้คืนรหัสผ่าน",
  backup: "สำรองข้อมูล",
  restore: "กู้คืนข้อมูล",
};

/** Values stored in a change: money in satang, dates in epoch ms or "YYYY-MM-DD", enums as their code. */
export type AuditValue = string | number | boolean | null;

export interface AuditFieldChange {
  field: string;
  from: AuditValue;
  to: AuditValue;
}

/** Numbers of a bill line in a change. */
export interface AuditLineValues {
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
}

/** A bill line that was added, removed or changed by an edit. */
export interface AuditItemChange {
  change: "added" | "removed" | "changed";
  name: string;
  unit: string | null;
  before: AuditLineValues | null;
  after: AuditLineValues | null;
  /** changed: which of name / qty / unitPrice / discount / total differ. */
  fields: AuditFieldChange[];
}

export interface AuditEntry {
  id: ID;
  at: Millis;
  /** null = the system or someone not logged in. */
  userId: ID | null;
  userName: string | null;
  entityType: AuditEntityType;
  entityId: ID | null;
  /** Snapshot of what it was about, e.g. a doc number or product name. */
  entityLabel: string | null;
  action: AuditAction;
  /** Field changes (update) or key values (create: from = null). */
  changes: AuditFieldChange[];
  /** Bill line changes (transactions only). */
  items: AuditItemChange[];
  note: string | null;
}

export const auditListQuerySchema = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(100).optional(),
  userId: z.string().max(100).optional(),
  /** at >= from (epoch ms) */
  from: z.number().int().optional(),
  /** at < to */
  to: z.number().int().optional(),
  /** Matches the label, the user name and the note. */
  search: z.string().trim().max(200).optional(),
  ...pageSchema,
});
export type AuditListQuery = z.input<typeof auditListQuerySchema>;

export interface AuditApi {
  /** Newest first. */
  list(query: AuditListQuery): Promise<Paged<AuditEntry>>;
}

// ---------- Price history ----------
export type PriceField = "cost" | "sell";
export type PriceSource = "create" | "manual" | "purchase";

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  create: "ตั้งราคาตอนเพิ่ม",
  manual: "แก้ไขราคา",
  purchase: "ตามบิลซื้อ",
};

export interface PriceChange {
  id: ID;
  itemType: "product" | "service";
  itemId: ID;
  /** cost = ราคาทุน, sell = ราคาขาย (services: ราคาตั้งต้น). */
  field: PriceField;
  oldValue: number | null;
  newValue: number;
  source: PriceSource;
  /** Purchase bill the cost came from. */
  transactionId: ID | null;
  docNo: string | null;
  userId: ID | null;
  userName: string | null;
  at: Millis;
  note: string | null;
}

export const priceHistoryQuerySchema = z.object({ id: idSchema, ...pageSchema });
export type PriceHistoryQuery = z.input<typeof priceHistoryQuerySchema>;

// ---------- Display metadata (renderer) ----------
export type AuditFieldKind = "text" | "money" | "datetime" | "date" | "bool" | "number" | "qty" | "percent" | "enum" | "list";

export interface AuditFieldMeta {
  label: string;
  kind?: AuditFieldKind;
  /** enum: code -> label */
  options?: Record<string, string>;
}

const VAT_MODE_LABELS = { none: "ไม่มี VAT", inclusive: "รวม VAT", exclusive: "แยก VAT" };
const PAY_TYPE_LABELS = { monthly: "รายเดือน", daily: "รายวัน" };
const LEAVE_LABELS = { sick: "ลาป่วย", personal: "ลากิจ", vacation: "ลาพักร้อน", unpaid: "ลาไม่รับค่าจ้าง" };
const ROLE_LABELS = { owner: "เจ้าของร้าน", staff: "พนักงาน" };

/** Labels (and value formats) of the fields that appear in changes, per entity type. Unknown fields show their key. */
export const AUDIT_FIELDS: Partial<Record<AuditEntityType, Record<string, AuditFieldMeta>>> = {
  transaction: {
    docNo: { label: "เลขที่บิล" },
    type: { label: "ประเภท", kind: "enum", options: { sale: "ขาย", purchase: "ซื้อ" } },
    status: { label: "สถานะบิล", kind: "enum", options: TRANSACTION_STATUS_LABELS },
    occurredAt: { label: "วันที่บิล", kind: "datetime" },
    customer: { label: "ลูกค้า / ผู้ติดต่อ" },
    contactName: { label: "ชื่อผู้ติดต่อ" },
    contactPhone: { label: "เบอร์โทร" },
    vehiclePlate: { label: "ทะเบียนรถ" },
    vehicleModel: { label: "รุ่นรถ" },
    mileage: { label: "เลขไมล์", kind: "number" },
    subtotal: { label: "รวมเป็นเงิน", kind: "money" },
    discount: { label: "ส่วนลดท้ายบิล", kind: "money" },
    vatMode: { label: "VAT", kind: "enum", options: VAT_MODE_LABELS },
    vatRate: { label: "อัตรา VAT", kind: "percent" },
    vatAmount: { label: "ภาษีมูลค่าเพิ่ม", kind: "money" },
    total: { label: "ยอดสุทธิ", kind: "money" },
    paymentMethod: { label: "วิธีชำระ", kind: "enum", options: PAYMENT_METHOD_LABELS },
    paymentStatus: { label: "สถานะการชำระ", kind: "enum", options: PAYMENT_STATUS_LABELS },
    note: { label: "หมายเหตุ" },
    items: { label: "จำนวนรายการ", kind: "number" },
    // line fields (AuditItemChange.fields)
    name: { label: "ชื่อรายการ" },
    qty: { label: "จำนวน", kind: "qty" },
    unitPrice: { label: "ราคา/หน่วย", kind: "money" },
    lineDiscount: { label: "ส่วนลด", kind: "money" },
    lineTotal: { label: "รวม", kind: "money" },
  },
  product: {
    name: { label: "ชื่อสินค้า" },
    sku: { label: "รหัสสินค้า" },
    barcode: { label: "บาร์โค้ด" },
    category: { label: "หมวดหมู่" },
    brand: { label: "ยี่ห้อ" },
    model: { label: "รุ่น" },
    spec: { label: "ขนาด / สเปก" },
    unit: { label: "หน่วย" },
    costPrice: { label: "ราคาทุน", kind: "money" },
    sellPrice: { label: "ราคาขาย", kind: "money" },
    minStock: { label: "แจ้งเตือนเมื่อเหลือ", kind: "qty" },
    trackStock: { label: "นับสต็อก", kind: "bool" },
    isActive: { label: "เปิดขาย", kind: "bool" },
    note: { label: "หมายเหตุ" },
    initialStock: { label: "ยอดยกมา", kind: "qty" },
    stockQty: { label: "คงเหลือ", kind: "qty" },
    adjustQty: { label: "ปรับจำนวน", kind: "qty" },
  },
  service: {
    name: { label: "ชื่อบริการ" },
    code: { label: "รหัสบริการ" },
    defaultPrice: { label: "ราคาตั้งต้น", kind: "money" },
    unit: { label: "หน่วย" },
    isActive: { label: "เปิดใช้งาน", kind: "bool" },
    note: { label: "หมายเหตุ" },
  },
  category: {
    name: { label: "ชื่อหมวดหมู่" },
    sortOrder: { label: "ลำดับ", kind: "number" },
  },
  customer: {
    name: { label: "ชื่อ" },
    phone: { label: "เบอร์โทร" },
    lineId: { label: "LINE ID" },
    email: { label: "อีเมล" },
    shopName: { label: "ชื่อร้าน / บริษัท" },
    taxId: { label: "เลขผู้เสียภาษี" },
    address: { label: "ที่อยู่" },
    note: { label: "หมายเหตุ" },
  },
  employee: {
    code: { label: "รหัสพนักงาน" },
    firstName: { label: "ชื่อ" },
    lastName: { label: "นามสกุล" },
    nickname: { label: "ชื่อเล่น" },
    position: { label: "ตำแหน่ง" },
    phone: { label: "เบอร์โทร" },
    lineId: { label: "LINE ID" },
    nationalId: { label: "เลขบัตรประชาชน" },
    birthDate: { label: "วันเกิด", kind: "date" },
    address: { label: "ที่อยู่" },
    emergencyName: { label: "ผู้ติดต่อฉุกเฉิน" },
    emergencyPhone: { label: "เบอร์ผู้ติดต่อฉุกเฉิน" },
    startDate: { label: "วันเริ่มงาน", kind: "date" },
    endDate: { label: "วันสิ้นสุดการทำงาน", kind: "date" },
    isActive: { label: "ยังทำงานอยู่", kind: "bool" },
    payType: { label: "ประเภทค่าจ้าง", kind: "enum", options: PAY_TYPE_LABELS },
    payRate: { label: "อัตราค่าจ้าง", kind: "money" },
    socialSecurity: { label: "หักประกันสังคม", kind: "bool" },
    bankName: { label: "ธนาคาร" },
    bankAccount: { label: "เลขบัญชี" },
    note: { label: "หมายเหตุ" },
  },
  user: {
    name: { label: "ชื่อผู้ใช้" },
    role: { label: "ระดับ", kind: "enum", options: ROLE_LABELS },
    permissions: { label: "สิทธิ์", kind: "list" },
    employee: { label: "พนักงานที่ผูกไว้" },
    isActive: { label: "เปิดใช้งาน", kind: "bool" },
    hasPassword: { label: "ใช้รหัสผ่าน", kind: "bool" },
  },
  attendance: {
    employee: { label: "พนักงาน" },
    workDate: { label: "วันที่", kind: "date" },
    clockIn: { label: "เวลาเข้า", kind: "datetime" },
    clockOut: { label: "เวลาออก", kind: "datetime" },
    note: { label: "หมายเหตุ" },
  },
  leave: {
    employee: { label: "พนักงาน" },
    date: { label: "วันที่", kind: "date" },
    type: { label: "ประเภทการลา", kind: "enum", options: LEAVE_LABELS },
    halfDay: { label: "ครึ่งวัน", kind: "bool" },
    note: { label: "หมายเหตุ" },
  },
  advance: {
    employee: { label: "พนักงาน" },
    date: { label: "วันที่เบิก", kind: "date" },
    amount: { label: "จำนวนเงิน", kind: "money" },
    note: { label: "หมายเหตุ" },
  },
  payroll: {
    title: { label: "ชื่องวด" },
    periodStart: { label: "ตั้งแต่", kind: "date" },
    periodEnd: { label: "ถึง", kind: "date" },
    payslips: { label: "จำนวนสลิป", kind: "number" },
    net: { label: "ยอดจ่ายสุทธิรวม", kind: "money" },
    note: { label: "หมายเหตุ" },
  },
  payslip: {
    employee: { label: "พนักงาน" },
    earnings: { label: "รายได้รวม", kind: "money" },
    deductions: { label: "รายการหักรวม", kind: "money" },
    net: { label: "รับสุทธิ", kind: "money" },
    paymentMethod: { label: "จ่ายโดย", kind: "enum", options: { cash: "เงินสด", transfer: "โอนเงิน" } },
    note: { label: "หมายเหตุ" },
  },
  // "<section>.<field>" of AppSettings
  settings: {
    "shop.name": { label: "ชื่อร้าน" },
    "shop.branch": { label: "สาขา" },
    "shop.address": { label: "ที่อยู่ร้าน" },
    "shop.phone": { label: "เบอร์โทรร้าน" },
    "shop.taxId": { label: "เลขผู้เสียภาษีของร้าน" },
    "shop.lineId": { label: "LINE ร้าน" },
    "shop.logoDataUrl": { label: "โลโก้บนใบเสร็จ" },
    "shop.receiptFooter": { label: "ข้อความท้ายใบเสร็จ" },
    "tax.vatRegistered": { label: "จดทะเบียน VAT", kind: "bool" },
    "tax.vatRate": { label: "อัตรา VAT", kind: "percent" },
    "tax.defaultVatMode": { label: "VAT เริ่มต้นของบิลขาย", kind: "enum", options: VAT_MODE_LABELS },
    "tax.defaultPurchaseVatMode": { label: "VAT เริ่มต้นของบิลซื้อ", kind: "enum", options: VAT_MODE_LABELS },
    "docs.salePrefix": { label: "คำนำหน้าเลขที่บิลขาย" },
    "docs.purchasePrefix": { label: "คำนำหน้าเลขที่บิลซื้อ" },
    "docs.useBuddhistYear": { label: "ใช้ปี พ.ศ. ในเลขที่เอกสาร", kind: "bool" },
    "print.defaultPaper": { label: "กระดาษเริ่มต้น" },
    "print.printerName": { label: "เครื่องพิมพ์" },
    "print.silent": { label: "พิมพ์ทันทีโดยไม่ถาม", kind: "bool" },
    "print.copies": { label: "จำนวนชุดที่พิมพ์", kind: "number" },
    "print.showLogo": { label: "พิมพ์โลโก้", kind: "bool" },
    "print.autoPrintAfterSale": { label: "พิมพ์อัตโนมัติหลังขาย", kind: "bool" },
    "print.showStaffName": { label: "พิมพ์ชื่อผู้ออกบิล", kind: "bool" },
    "print.documentLanguage": { label: "ภาษาในเอกสาร", kind: "enum", options: { th: "ไทย", en: "English" } },
    "inventory.allowNegativeStock": { label: "ขายเกินสต็อกได้", kind: "bool" },
    "inventory.updateCostOnPurchase": { label: "อัปเดตราคาทุนตามการซื้อ", kind: "bool" },
    "backup.autoBackup": { label: "สำรองข้อมูลอัตโนมัติ", kind: "bool" },
    "backup.keepDays": { label: "เก็บไฟล์สำรอง (วัน)", kind: "number" },
    "security.autoLockMinutes": { label: "ล็อกหน้าจออัตโนมัติ (นาที)", kind: "number" },
    "payroll.workStart": { label: "เวลาเข้างาน" },
    "payroll.workEnd": { label: "เวลาเลิกงาน" },
    "payroll.lateGraceMinutes": { label: "มาสายได้ไม่เกิน (นาที)", kind: "number" },
    "payroll.workDays": { label: "วันทำงาน", kind: "list" },
    "payroll.holidays": { label: "วันหยุดร้าน", kind: "list" },
    "payroll.hoursPerDay": { label: "ชั่วโมงทำงานต่อวัน", kind: "number" },
    "payroll.daysPerMonth": { label: "วันต่อเดือน (คิดค่าแรงรายวัน)", kind: "number" },
    "payroll.lateDeduction": { label: "การหักมาสาย", kind: "enum", options: { none: "ไม่หัก", per_minute: "หักตามนาที", per_time: "หักครั้งละเท่ากัน" } },
    "payroll.lateDeductionAmount": { label: "หักมาสายครั้งละ", kind: "money" },
    "payroll.deductAbsence": { label: "หักวันขาดงาน", kind: "bool" },
    "payroll.otEnabled": { label: "คิดค่าล่วงเวลาอัตโนมัติ", kind: "bool" },
    "payroll.otMultiplier": { label: "อัตรา OT (เท่า)", kind: "number" },
    "payroll.otMinMinutes": { label: "OT ขั้นต่ำ (นาที)", kind: "number" },
    "payroll.socialSecurityRate": { label: "อัตราประกันสังคม", kind: "percent" },
    "payroll.socialSecurityMinBase": { label: "ฐานค่าจ้างประกันสังคมต่ำสุด", kind: "money" },
    "payroll.socialSecurityMaxBase": { label: "ฐานค่าจ้างประกันสังคมสูงสุด", kind: "money" },
  },
};
