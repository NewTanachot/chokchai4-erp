/**
 * Client-side model of a bill being edited, and conversions to/from the API shapes.
 * Money is integer satang, quantities are numbers (<= 2 decimals).
 */
import type { VatMode } from "@shared/calc";
import type {
  AppSettings,
  LineItemInput,
  LineItemType,
  PaymentMethod,
  PaymentStatus,
  Product,
  ServiceItem,
  TransactionDetail,
  TransactionInput,
  TransactionType,
} from "@shared/contract";
import { roundQty } from "@shared/money";
import { tr } from "@/lib/i18n";

export interface DraftLine {
  /** Local key (stable across renders). */
  key: string;
  itemType: LineItemType;
  productId: string | null;
  serviceItemId: string | null;
  name: string;
  unit: string | null;
  qty: number;
  unitPrice: number;
  discount: number;
  note: string | null;
}

export interface DraftCustomer {
  id: string;
  name: string;
  phone: string | null;
  shopName: string | null;
  vehiclePlates: string[];
}

export interface BillDraft {
  /** null = "now" (new bill whose time was not changed; resolved at save time). */
  occurredAt: number | null;
  customer: DraftCustomer | null;
  contactName: string;
  contactPhone: string;
  vehiclePlate: string;
  vehicleModel: string;
  mileage: string;
  lines: DraftLine[];
  discount: number;
  vatMode: VatMode;
  vatRate: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  note: string;
}

let seq = 0;
export const lineKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function productLineName(p: Pick<Product, "name" | "spec">): string {
  return p.spec ? `${p.name} ${p.spec}` : p.name;
}

/** Catalog ("normal") price of a line for this bill type. null = no reference price. */
export function catalogPrice(type: TransactionType, line: Pick<DraftLine, "itemType">, product?: Product | null, service?: ServiceItem | null): number | null {
  if (line.itemType === "product" && product) return type === "sale" ? product.sellPrice : product.costPrice;
  if (line.itemType === "service" && service) return type === "sale" ? service.defaultPrice : null;
  return null;
}

export function newProductLine(type: TransactionType, p: Product): DraftLine {
  return {
    key: lineKey(),
    itemType: "product",
    productId: p.id,
    serviceItemId: null,
    name: productLineName(p),
    unit: p.unit,
    qty: 1,
    unitPrice: type === "sale" ? p.sellPrice : p.costPrice,
    discount: 0,
    note: null,
  };
}

export function newServiceLine(type: TransactionType, s: ServiceItem): DraftLine {
  return {
    key: lineKey(),
    itemType: "service",
    productId: null,
    serviceItemId: s.id,
    name: s.name,
    unit: s.unit,
    qty: 1,
    unitPrice: type === "sale" ? s.defaultPrice : 0,
    discount: 0,
    note: null,
  };
}

export function newCustomLine(): DraftLine {
  return { key: lineKey(), itemType: "custom", productId: null, serviceItemId: null, name: "", unit: null, qty: 1, unitPrice: 0, discount: 0, note: null };
}

export function emptyDraft(settings: AppSettings, type: TransactionType): BillDraft {
  return {
    occurredAt: null,
    customer: null,
    contactName: "",
    contactPhone: "",
    vehiclePlate: "",
    vehicleModel: "",
    mileage: "",
    lines: [],
    discount: 0,
    vatMode: !settings.tax.vatRegistered ? "none" : type === "purchase" ? settings.tax.defaultPurchaseVatMode : settings.tax.defaultVatMode,
    vatRate: settings.tax.vatRate,
    paymentMethod: "cash",
    paymentStatus: "paid",
    note: "",
  };
}

function detailCustomer(d: TransactionDetail, plates: string[] = []): DraftCustomer | null {
  return d.customer ? { id: d.customer.id, name: d.customer.name, phone: d.customer.phone, shopName: d.customer.shopName, vehiclePlates: plates } : null;
}

/** Draft for editing an existing bill. */
export function draftFromDetail(d: TransactionDetail, settings: AppSettings): BillDraft {
  const cust = detailCustomer(d);
  return {
    occurredAt: d.occurredAt,
    customer: cust,
    // contactName that merely repeats the customer's name is shown via the customer block
    contactName: cust && d.contactName === cust.name ? "" : (d.contactName ?? ""),
    contactPhone: cust && d.contactPhone === cust.phone ? "" : (d.contactPhone ?? ""),
    vehiclePlate: d.vehiclePlate ?? "",
    vehicleModel: d.vehicleModel ?? "",
    mileage: d.mileage != null ? d.mileage.toLocaleString("en-US") : "",
    lines: d.items.map((i) => ({
      key: lineKey(),
      itemType: i.itemType,
      productId: i.productId,
      serviceItemId: i.serviceItemId,
      name: i.name,
      unit: i.unit,
      qty: i.qty,
      unitPrice: i.unitPrice,
      discount: i.discount,
      note: i.note,
    })),
    discount: d.discount,
    vatMode: d.vatMode,
    vatRate: d.vatMode === "none" ? settings.tax.vatRate : d.vatRate,
    paymentMethod: d.paymentMethod,
    paymentStatus: d.paymentStatus,
    note: d.note ?? "",
  };
}

/** Draft for "เปิดบิลใหม่จากบิลนี้": same customer, vehicle and lines; fresh date and payment. */
export function draftCopyOf(d: TransactionDetail, settings: AppSettings): BillDraft {
  const base = draftFromDetail(d, settings);
  return { ...base, occurredAt: null, paymentMethod: "cash", paymentStatus: "paid", note: "", mileage: "", discount: d.discount };
}

export function draftToInput(type: TransactionType, draft: BillDraft, now = Date.now()): TransactionInput {
  const mileage = draft.mileage.replace(/[^\d]/g, "");
  return {
    type,
    occurredAt: draft.occurredAt ?? now,
    customerId: draft.customer?.id ?? null,
    contactName: draft.contactName.trim() || (draft.customer?.name ?? null),
    contactPhone: draft.contactPhone.trim() || (draft.customer?.phone ?? null),
    vehiclePlate: type === "sale" ? draft.vehiclePlate.trim() || null : null,
    vehicleModel: type === "sale" ? draft.vehicleModel.trim() || null : null,
    mileage: type === "sale" && mileage ? Number(mileage) : null,
    items: draft.lines.map(lineToInput),
    discount: draft.discount,
    vatMode: draft.vatMode,
    vatRate: draft.vatRate,
    paymentMethod: draft.paymentMethod,
    paymentStatus: draft.paymentStatus,
    note: draft.note.trim() || null,
  };
}

function lineToInput(l: DraftLine): LineItemInput {
  return {
    itemType: l.itemType,
    productId: l.productId,
    serviceItemId: l.serviceItemId,
    name: l.name.trim(),
    unit: l.unit?.trim() || null,
    qty: roundQty(l.qty),
    unitPrice: l.unitPrice,
    discount: l.discount,
    note: l.note,
  };
}

/** Same bill data as stored (for "mark as paid" and other one-field updates). */
export function detailToUpdate(d: TransactionDetail, patch: Partial<TransactionInput> = {}) {
  return {
    id: d.id,
    type: d.type,
    occurredAt: d.occurredAt,
    customerId: d.customerId,
    contactName: d.contactName,
    contactPhone: d.contactPhone,
    vehiclePlate: d.vehiclePlate,
    vehicleModel: d.vehicleModel,
    mileage: d.mileage,
    items: d.items.map((i) => ({
      itemType: i.itemType,
      productId: i.productId,
      serviceItemId: i.serviceItemId,
      name: i.name,
      unit: i.unit,
      qty: i.qty,
      unitPrice: i.unitPrice,
      discount: i.discount,
      note: i.note,
    })),
    discount: d.discount,
    vatMode: d.vatMode,
    vatRate: d.vatRate,
    paymentMethod: d.paymentMethod,
    paymentStatus: d.paymentStatus,
    note: d.note,
    ...patch,
  };
}

/** Human validation of a draft before sending it (Thai). Returns the first problem or null. */
export function validateDraft(type: TransactionType, draft: BillDraft): string | null {
  if (draft.lines.length === 0) return type === "sale" ? tr("ยังไม่มีรายการในบิล — ค้นหาสินค้าหรือบริการเพื่อเพิ่ม") : tr("ยังไม่มีรายการสินค้าที่ซื้อ");
  for (const [i, l] of draft.lines.entries()) {
    if (l.itemType === "custom" && !l.name.trim()) return tr("กรุณากรอกชื่อรายการที่ {0}", i + 1);
    if (!(l.qty > 0)) return tr("จำนวนของรายการที่ {0} ต้องมากกว่า 0", i + 1);
  }
  return null;
}
