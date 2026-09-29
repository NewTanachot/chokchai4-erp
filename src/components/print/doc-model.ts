/**
 * Pure view-model for printed documents (receipt / invoice / purchase record).
 * Turns a TransactionDetail + AppSettings into exactly what the templates print, so the
 * templates stay dumb and the rules (titles, VAT wording, who the counter-party is) are testable.
 */
import { amountInWords } from "@shared/bahttext";
import type { AppSettings, PaperSize, PrintKind, TransactionDetail } from "@shared/contract";
import { PAYMENT_METHOD_LABELS } from "@shared/contract";
import type { VatMode } from "@shared/calc";
import { lang, tr } from "@/lib/i18n";

export const PAPER_SIZES: PaperSize[] = ["80mm", "58mm", "a4", "a5"];
export const PRINT_KINDS: PrintKind[] = ["receipt", "invoice", "purchase"];

export const isThermal = (paper: PaperSize): paper is "80mm" | "58mm" => paper === "80mm" || paper === "58mm";

/** Screen width (CSS px @96dpi) of the whole paper - used to size preview iframes and hidden print windows. */
export const PAPER_WIDTH_PX: Record<PaperSize, number> = { "80mm": 302, "58mm": 219, a4: 794, a5: 559 };

export function parsePaper(v: string | null | undefined): PaperSize | null {
  return v && (PAPER_SIZES as string[]).includes(v) ? (v as PaperSize) : null;
}
export function parseKind(v: string | null | undefined): PrintKind | null {
  return v && (PRINT_KINDS as string[]).includes(v) ? (v as PrintKind) : null;
}

/** A purchase always prints as a purchase record; a sale prints as receipt or invoice. */
export function effectiveKind(type: TransactionDetail["type"], kind: PrintKind | null | undefined): PrintKind {
  if (type === "purchase") return "purchase";
  return kind === "invoice" ? "invoice" : "receipt";
}

export function documentTitle(kind: PrintKind, opts: { thermal: boolean; taxInvoice: boolean }): string {
  if (kind === "purchase") return tr("ใบบันทึกการซื้อสินค้า");
  if (kind === "invoice") return tr("ใบแจ้งหนี้ / ใบส่งของ");
  if (!opts.taxInvoice) return tr("ใบเสร็จรับเงิน");
  return opts.thermal ? tr("ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ") : tr("ใบเสร็จรับเงิน/ใบกำกับภาษี");
}

export interface DocParty {
  /** "ลูกค้า" or "ผู้ขาย". */
  label: string;
  name: string | null;
  shopName: string | null;
  address: string | null;
  taxId: string | null;
  phone: string | null;
}

export interface DocLine {
  no: number;
  name: string;
  note: string | null;
  qty: number;
  unit: string | null;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface DocModel {
  kind: PrintKind;
  paper: PaperSize;
  thermal: boolean;
  title: string;
  isTaxInvoice: boolean;
  shop: AppSettings["shop"];
  logoSrc: string | null;
  docNo: string;
  occurredAt: number;
  party: DocParty;
  vehicle: { plate: string | null; model: string | null; mileage: number | null } | null;
  lines: DocLine[];
  /** Sum of qty for the "รวม x ชิ้น" line. */
  totalQty: number;
  subtotal: number;
  discount: number;
  vatMode: VatMode;
  vatRate: number;
  vatAmount: number;
  /** total - VAT. */
  beforeVat: number;
  total: number;
  totalText: string;
  paymentMethod: string;
  unpaid: boolean;
  note: string | null;
  footer: string;
  void: { at: number | null; reason: string | null } | null;
  /** Signature captions (A4/A5). */
  signatures: [string, string];
  /** "ผู้ออกบิล": the user who created the bill (settings.print.showStaffName), else null. */
  staffName: string | null;
}

const nz = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

export function buildDocModel(tx: TransactionDetail, settings: AppSettings, kindParam: PrintKind | null | undefined, paper: PaperSize): DocModel {
  const kind = effectiveKind(tx.type, kindParam);
  const thermal = isThermal(paper);
  const hasVat = tx.vatMode !== "none";
  const isTaxInvoice = kind === "receipt" && settings.tax.vatRegistered && hasVat;
  const c = tx.customer;
  const party: DocParty = {
    label: kind === "purchase" ? tr("ผู้ขาย") : tr("ลูกค้า"),
    name: nz(c?.name) ?? nz(tx.contactName),
    shopName: nz(c?.shopName),
    address: nz(c?.address),
    taxId: nz(c?.taxId),
    phone: nz(c?.phone) ?? nz(tx.contactPhone),
  };
  const hasVehicle = !!(nz(tx.vehiclePlate) || nz(tx.vehicleModel) || tx.mileage);
  const logoSrc = settings.print.showLogo ? settings.shop.logoDataUrl || "/logo.png" : null;
  return {
    kind,
    paper,
    thermal,
    title: documentTitle(kind, { thermal, taxInvoice: isTaxInvoice }),
    isTaxInvoice,
    shop: settings.shop,
    logoSrc,
    docNo: tx.docNo,
    occurredAt: tx.occurredAt,
    party,
    vehicle: hasVehicle ? { plate: nz(tx.vehiclePlate), model: nz(tx.vehicleModel), mileage: tx.mileage || null } : null,
    lines: tx.items.map((it, i) => ({
      no: i + 1,
      name: it.name,
      note: nz(it.note),
      qty: it.qty,
      unit: nz(it.unit),
      unitPrice: it.unitPrice,
      discount: it.discount,
      total: it.total,
    })),
    totalQty: Math.round(tx.items.reduce((s, it) => s + it.qty, 0) * 100) / 100,
    subtotal: tx.subtotal,
    discount: tx.discount,
    vatMode: tx.vatMode,
    vatRate: tx.vatRate,
    vatAmount: tx.vatAmount,
    beforeVat: tx.total - tx.vatAmount,
    total: tx.total,
    totalText: amountInWords(tx.total, lang),
    paymentMethod: PAYMENT_METHOD_LABELS[tx.paymentMethod] ?? tx.paymentMethod,
    unpaid: tx.paymentStatus === "unpaid",
    note: nz(tx.note),
    // The default footer ("ขอบคุณที่ใช้บริการ") prints in the document's language; a typed one as it is.
    footer: kind === "purchase" ? "" : tr(settings.shop.receiptFooter.trim()),
    void: tx.status === "void" ? { at: tx.voidedAt, reason: nz(tx.voidReason) } : null,
    signatures: kind === "purchase" ? [tr("ผู้ส่งสินค้า"), tr("ผู้รับสินค้า / ผู้จ่ายเงิน")] : kind === "invoice" ? [tr("ผู้รับสินค้า"), tr("ผู้ส่งสินค้า")] : [tr("ผู้จ่ายเงิน"), tr("ผู้รับเงิน")],
    staffName: settings.print.showStaffName ? (tx.createdBy?.name ?? null) : null,
  };
}

/** VAT rate without trailing zeros: 7 -> "7", 7.5 -> "7.5". */
export const formatRate = (rate: number): string => String(Math.round(rate * 100) / 100);
