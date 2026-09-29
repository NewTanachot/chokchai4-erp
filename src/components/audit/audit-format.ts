/** Turns stored history values into Thai display text (field labels and formats from shared/contract/audit.ts). */
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_FIELDS,
  type AuditEntityType,
  type AuditEntry,
  type AuditFieldMeta,
  type AuditValue,
} from "@shared/contract";
import { formatBaht, formatDateStr, formatDateTime, formatQty } from "@/lib/format";
import { lang, LOCALE, tr, trc } from "@/lib/i18n";

export function fieldMeta(entity: AuditEntityType, field: string): AuditFieldMeta {
  return AUDIT_FIELDS[entity]?.[field] ?? { label: field };
}

const EMPTY = "—";

export function formatAuditValue(entity: AuditEntityType, field: string, v: AuditValue): string {
  if (v === null || v === "") return EMPTY;
  const meta = fieldMeta(entity, field);
  switch (meta.kind) {
    case "money":
      return typeof v === "number" ? formatBaht(v) : String(v);
    case "datetime":
      return typeof v === "number" ? tr("{0} น.", formatDateTime(v)) : String(v);
    case "date":
      return typeof v === "string" ? formatDateStr(v) : String(v);
    case "bool":
      return v === true ? tr("ใช่") : v === false ? tr("ไม่") : String(v);
    case "qty":
      return typeof v === "number" ? formatQty(v) : String(v);
    case "number":
      return typeof v === "number" ? v.toLocaleString(LOCALE) : String(v);
    case "percent":
      return `${v}%`;
    case "enum":
      return meta.options?.[String(v)] ?? String(v);
    case "list":
      // Stored as Thai labels joined with ", " (e.g. permissions).
      return String(v)
        .split(", ")
        .map((x) => tr(x))
        .join(", ");
    default:
      // Text written by the program in Thai (e.g. "ทุกสิทธิ์") is shown translated; typed text stays as it is.
      return typeof v === "string" ? tr(v) : String(v);
  }
}

/** What happened, e.g. "แก้ไขบิล", "ปรับสต็อก", "เข้าสู่ระบบ" (English: "Bill edited", "Stock adjusted", "Logged in"). */
export function auditTitle(e: Pick<AuditEntry, "entityType" | "action">): string {
  const { entityType: t, action: a } = e;
  if (t === "transaction") {
    const own: Partial<Record<string, string>> = {
      create: trc("audit", "เปิดบิล"),
      update: trc("audit", "แก้ไขบิล"),
      void: trc("audit", "ยกเลิกบิล"),
      pay: trc("audit", "บันทึกการชำระเงิน"),
      delete: trc("audit", "ลบบิล"),
    };
    if (own[a]) return own[a];
  }
  if (t === "user") {
    const own: Partial<Record<string, string>> = {
      login: trc("audit", "เข้าสู่ระบบ"),
      logout: trc("audit", "ออกจากระบบ"),
      login_failed: trc("audit", "ใส่รหัสผ่านผิด"),
      password_change: trc("audit", "เปลี่ยนรหัสผ่าน"),
      password_reset: trc("audit", "ตั้งรหัสผ่านใหม่ให้ผู้ใช้"),
      password_remove: trc("audit", "ยกเลิกรหัสผ่านของผู้ใช้"),
      recover: trc("audit", "กู้คืนรหัสผ่านเจ้าของร้าน"),
    };
    if (own[a]) return own[a];
  }
  if (t === "payslip" && a === "pay") return trc("audit", "จ่ายเงินเดือน");
  if (t === "payslip" && a === "unpay") return trc("audit", "ยกเลิกการจ่ายเงินเดือน");
  if (t === "product" && a === "stock_adjust") return trc("audit", "ปรับสต็อก");
  if (t === "settings") return trc("audit", "แก้ไขการตั้งค่า");
  if (t === "system" && a === "backup") return trc("audit", "สำรองข้อมูล");
  if (t === "system" && a === "restore") return trc("audit", "กู้คืนข้อมูล");
  // "<verb><thing>", e.g. "แก้ไขสินค้า" / "Edited product".
  const thing = lang === "th" ? AUDIT_ENTITY_LABELS[t] : AUDIT_ENTITY_LABELS[t].toLowerCase();
  const added = t === "product" || t === "service" || t === "customer" || t === "employee" || t === "category";
  switch (a) {
    case "create":
      return added ? trc("audit", "เพิ่ม{0}", thing) : trc("audit", "สร้าง{0}", thing);
    case "update":
      return trc("audit", "แก้ไข{0}", thing);
    case "delete":
      return trc("audit", "ลบ{0}", thing);
    default:
      return `${AUDIT_ACTION_LABELS[a]} · ${AUDIT_ENTITY_LABELS[t]}`;
  }
}

/** Link to the record an entry is about, when it has a page. */
export function auditHref(e: Pick<AuditEntry, "entityType" | "entityId" | "action">): string | null {
  if (!e.entityId || e.action === "delete") return null;
  switch (e.entityType) {
    case "transaction":
      return `/transactions/view/?id=${encodeURIComponent(e.entityId)}`;
    case "product":
      return `/products/view/?id=${encodeURIComponent(e.entityId)}`;
    case "customer":
      return `/customers/view/?id=${encodeURIComponent(e.entityId)}`;
    case "employee":
      return `/employees/view/?id=${encodeURIComponent(e.entityId)}`;
    case "payroll":
      return `/payroll/view/?id=${encodeURIComponent(e.entityId)}`;
    case "service":
      return "/services/";
    default:
      return null;
  }
}
