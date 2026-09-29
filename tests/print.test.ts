import { describe, expect, it, vi } from "vitest";

// electron/api/print.ts imports Electron (main-process only); its pure helpers are tested without it.
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  BrowserWindow: class {},
  dialog: {},
  shell: {},
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {},
  nativeTheme: { shouldUseDarkColors: false },
}));

import { bahtText, thaiNumberText } from "@shared/bahttext";
import { DEFAULT_SETTINGS, type AppSettings, type TransactionDetail } from "@shared/contract";
import { buildDocModel, documentTitle, effectiveKind, parseKind, parsePaper } from "@/components/print/doc-model";
import { PRINT_CSS, pageNumberRule, pageRule } from "@/components/print/print-styles";
import { printFailureMessage, resolvePrintJob, safeFileName } from "../electron/api/print";
import { createTestApi } from "./helpers/db";

const B = (baht: number) => Math.round(baht * 100);

describe("bahtText", () => {
  it.each([
    [0, "ศูนย์บาทถ้วน"],
    [100, "หนึ่งบาทถ้วน"],
    [200, "สองบาทถ้วน"],
    [1000, "สิบบาทถ้วน"],
    [1100, "สิบเอ็ดบาทถ้วน"],
    [1500, "สิบห้าบาทถ้วน"],
    [2000, "ยี่สิบบาทถ้วน"],
    [2100, "ยี่สิบเอ็ดบาทถ้วน"],
    [2150, "ยี่สิบเอ็ดบาทห้าสิบสตางค์"],
    [2500, "ยี่สิบห้าบาทถ้วน"],
    [3100, "สามสิบเอ็ดบาทถ้วน"],
    [9900, "เก้าสิบเก้าบาทถ้วน"],
    [B(100), "หนึ่งร้อยบาทถ้วน"],
    [B(101), "หนึ่งร้อยเอ็ดบาทถ้วน"],
    [B(110), "หนึ่งร้อยสิบบาทถ้วน"],
    [B(111), "หนึ่งร้อยสิบเอ็ดบาทถ้วน"],
    [B(120), "หนึ่งร้อยยี่สิบบาทถ้วน"],
    [B(121), "หนึ่งร้อยยี่สิบเอ็ดบาทถ้วน"],
    [B(201), "สองร้อยเอ็ดบาทถ้วน"],
    [B(1000), "หนึ่งพันบาทถ้วน"],
    [B(1001), "หนึ่งพันเอ็ดบาทถ้วน"],
    [B(1010), "หนึ่งพันสิบบาทถ้วน"],
    [B(3650), "สามพันหกร้อยห้าสิบบาทถ้วน"],
    [B(10000), "หนึ่งหมื่นบาทถ้วน"],
    [B(15999.99), "หนึ่งหมื่นห้าพันเก้าร้อยเก้าสิบเก้าบาทเก้าสิบเก้าสตางค์"],
    [B(21021), "สองหมื่นหนึ่งพันยี่สิบเอ็ดบาทถ้วน"],
    [B(100000), "หนึ่งแสนบาทถ้วน"],
    [B(200001), "สองแสนเอ็ดบาทถ้วน"],
    [B(999999), "เก้าแสนเก้าหมื่นเก้าพันเก้าร้อยเก้าสิบเก้าบาทถ้วน"],
    [1000000_00, "หนึ่งล้านบาทถ้วน"],
    [B(1000001), "หนึ่งล้านเอ็ดบาทถ้วน"],
    [B(1000010), "หนึ่งล้านสิบบาทถ้วน"],
    [B(1000021), "หนึ่งล้านยี่สิบเอ็ดบาทถ้วน"],
    [B(1010000), "หนึ่งล้านหนึ่งหมื่นบาทถ้วน"],
    [B(2500000), "สองล้านห้าแสนบาทถ้วน"],
    [B(10000000), "สิบล้านบาทถ้วน"],
    [B(11000000), "สิบเอ็ดล้านบาทถ้วน"],
    [B(21000000), "ยี่สิบเอ็ดล้านบาทถ้วน"],
    [B(101000000), "หนึ่งร้อยเอ็ดล้านบาทถ้วน"],
    [1234567890, "สิบสองล้านสามแสนสี่หมื่นห้าพันหกร้อยเจ็ดสิบแปดบาทเก้าสิบสตางค์"],
    [B(1_000_000_000_000), "หนึ่งล้านล้านบาทถ้วน"],
    [B(2_000_000_000_001), "สองล้านล้านเอ็ดบาทถ้วน"],
  ])("%i satang -> %s", (satang, words) => {
    expect(bahtText(satang)).toBe(words);
  });

  it("reads satang only / baht + satang", () => {
    expect(bahtText(1)).toBe("หนึ่งสตางค์");
    expect(bahtText(11)).toBe("สิบเอ็ดสตางค์");
    expect(bahtText(21)).toBe("ยี่สิบเอ็ดสตางค์");
    expect(bahtText(25)).toBe("ยี่สิบห้าสตางค์");
    expect(bahtText(50)).toBe("ห้าสิบสตางค์");
    expect(bahtText(99)).toBe("เก้าสิบเก้าสตางค์");
    expect(bahtText(101)).toBe("หนึ่งบาทหนึ่งสตางค์");
    expect(bahtText(1101)).toBe("สิบเอ็ดบาทหนึ่งสตางค์");
    expect(bahtText(10075)).toBe("หนึ่งร้อยบาทเจ็ดสิบห้าสตางค์");
  });

  it("negatives are prefixed with ลบ", () => {
    expect(bahtText(-2150)).toBe("ลบยี่สิบเอ็ดบาทห้าสิบสตางค์");
    expect(bahtText(-100000000)).toBe("ลบหนึ่งล้านบาทถ้วน");
    expect(bahtText(-5)).toBe("ลบห้าสตางค์");
  });

  it("rounds fractional satang and ignores non-numbers", () => {
    expect(bahtText(2150.4)).toBe("ยี่สิบเอ็ดบาทห้าสิบสตางค์");
    expect(bahtText(99.6)).toBe("หนึ่งบาทถ้วน");
    expect(bahtText(Number.NaN)).toBe("");
    expect(bahtText(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("never produces หนึ่งสิบ / สองสิบ / leading เอ็ด for every value up to 100,000 baht", () => {
    for (let baht = 1; baht <= 100_000; baht += 7) {
      const t = thaiNumberText(baht);
      expect(t).not.toMatch(/หนึ่งสิบ|สองสิบ|ศูนย์/);
      expect(t.startsWith("เอ็ด")).toBe(false);
      if (baht % 10 === 1 && baht > 1) expect(t.endsWith("เอ็ด")).toBe(true);
    }
    expect(thaiNumberText(0)).toBe("ศูนย์");
    expect(thaiNumberText(1)).toBe("หนึ่ง");
  });
});

// ---------------------------------------------------------------------------- document model

function makeTx(over: Partial<TransactionDetail> = {}): TransactionDetail {
  return {
    id: "tx1",
    type: "sale",
    docNo: "S6909-0001",
    status: "completed",
    occurredAt: new Date(2026, 8, 25, 14, 5).getTime(),
    customerId: "c1",
    customer: { id: "c1", name: "สมชาย ใจดี", phone: "081-234-5678", shopName: null, taxId: "0105561234567", address: null, lineId: null, email: null },
    contactName: "สมชาย ใจดี",
    contactPhone: "081-234-5678",
    vehiclePlate: "กข 1234 กรุงเทพมหานคร",
    vehicleModel: "Toyota Vios",
    mileage: 45000,
    items: [
      { id: "i1", lineNo: 1, itemType: "product", productId: "p1", serviceItemId: null, name: "Michelin Primacy 4", unit: "เส้น", qty: 4, unitPrice: B(3650), discount: B(200), total: B(14400), unitCost: B(2900), note: null },
      { id: "i2", lineNo: 2, itemType: "service", productId: null, serviceItemId: "s1", name: "ถ่วงล้อ", unit: "ล้อ", qty: 4, unitPrice: B(100), discount: 0, total: B(400), unitCost: 0, note: "  " },
    ],
    subtotal: B(14800),
    discount: B(100),
    vatMode: "none",
    vatRate: 0,
    vatAmount: 0,
    total: B(14700),
    costTotal: B(11600),
    paymentMethod: "cash",
    paymentStatus: "paid",
    paidAt: new Date(2026, 8, 25, 14, 5).getTime(),
    note: null,
    voidedAt: null,
    voidReason: null,
    createdBy: null,
    updatedBy: null,
    voidedBy: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const settingsWith = (over: { tax?: Partial<AppSettings["tax"]>; print?: Partial<AppSettings["print"]>; shop?: Partial<AppSettings["shop"]> } = {}): AppSettings => ({
  ...DEFAULT_SETTINGS,
  tax: { ...DEFAULT_SETTINGS.tax, ...over.tax },
  print: { ...DEFAULT_SETTINGS.print, ...over.print },
  shop: { ...DEFAULT_SETTINGS.shop, ...over.shop },
});

describe("print document model", () => {
  it("parses query params strictly", () => {
    expect(parsePaper("a4")).toBe("a4");
    expect(parsePaper("A4")).toBeNull();
    expect(parsePaper(null)).toBeNull();
    expect(parseKind("invoice")).toBe("invoice");
    expect(parseKind("x")).toBeNull();
  });

  it("forces purchase kind for purchases and never for sales", () => {
    expect(effectiveKind("purchase", "receipt")).toBe("purchase");
    expect(effectiveKind("sale", "purchase")).toBe("receipt");
    expect(effectiveKind("sale", "invoice")).toBe("invoice");
    expect(effectiveKind("sale", null)).toBe("receipt");
  });

  it("titles", () => {
    expect(documentTitle("receipt", { thermal: true, taxInvoice: false })).toBe("ใบเสร็จรับเงิน");
    expect(documentTitle("receipt", { thermal: true, taxInvoice: true })).toBe("ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ");
    expect(documentTitle("receipt", { thermal: false, taxInvoice: true })).toBe("ใบเสร็จรับเงิน/ใบกำกับภาษี");
    expect(documentTitle("invoice", { thermal: true, taxInvoice: true })).toBe("ใบแจ้งหนี้ / ใบส่งของ");
    expect(documentTitle("purchase", { thermal: false, taxInvoice: false })).toBe("ใบบันทึกการซื้อสินค้า");
  });

  it("builds a sale receipt", () => {
    const m = buildDocModel(makeTx(), settingsWith(), "receipt", "80mm");
    expect(m.title).toBe("ใบเสร็จรับเงิน");
    expect(m.thermal).toBe(true);
    expect(m.logoSrc).toBe("/logo.png");
    expect(m.party).toMatchObject({ label: "ลูกค้า", name: "สมชาย ใจดี", phone: "081-234-5678" });
    expect(m.vehicle).toEqual({ plate: "กข 1234 กรุงเทพมหานคร", model: "Toyota Vios", mileage: 45000 });
    expect(m.lines).toHaveLength(2);
    expect(m.lines[1].note).toBeNull();
    expect(m.totalQty).toBe(8);
    expect(m.totalText).toBe("หนึ่งหมื่นสี่พันเจ็ดร้อยบาทถ้วน");
    expect(m.paymentMethod).toBe("เงินสด");
    expect(m.unpaid).toBe(false);
    expect(m.void).toBeNull();
    expect(m.footer).toBe(DEFAULT_SETTINGS.shop.receiptFooter);
    expect(m.signatures).toEqual(["ผู้จ่ายเงิน", "ผู้รับเงิน"]);
  });

  it("uses the tax-invoice title only for VAT-registered shops on VAT bills", () => {
    const vatTx = makeTx({ vatMode: "inclusive", vatRate: 7, vatAmount: 962, total: B(14700) });
    expect(buildDocModel(vatTx, settingsWith(), "receipt", "80mm").title).toBe("ใบเสร็จรับเงิน");
    const reg = settingsWith({ tax: { vatRegistered: true } });
    expect(buildDocModel(vatTx, reg, "receipt", "80mm").title).toBe("ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ");
    expect(buildDocModel(vatTx, reg, "receipt", "a4").title).toBe("ใบเสร็จรับเงิน/ใบกำกับภาษี");
    expect(buildDocModel(makeTx(), reg, "receipt", "80mm").title).toBe("ใบเสร็จรับเงิน");
    const m = buildDocModel(vatTx, reg, "receipt", "80mm");
    expect(m.beforeVat).toBe(B(14700) - 962);
  });

  it("logo: settings data URL, fallback /logo.png, hidden when showLogo=false", () => {
    const tx = makeTx();
    expect(buildDocModel(tx, settingsWith({ shop: { logoDataUrl: "data:image/png;base64,AAA" } }), "receipt", "a4").logoSrc).toBe("data:image/png;base64,AAA");
    expect(buildDocModel(tx, settingsWith({ print: { showLogo: false } }), "receipt", "a4").logoSrc).toBeNull();
  });

  it("purchase record uses the supplier (contactName) and no footer", () => {
    const tx = makeTx({ type: "purchase", customerId: null, customer: null, contactName: "บจก. ไทยไทร์ ดิสทริบิวชั่น", contactPhone: null, vehiclePlate: null, vehicleModel: null, mileage: null, paymentStatus: "unpaid", paymentMethod: "credit" });
    const m = buildDocModel(tx, settingsWith(), "receipt", "a4");
    expect(m.kind).toBe("purchase");
    expect(m.title).toBe("ใบบันทึกการซื้อสินค้า");
    expect(m.party).toMatchObject({ label: "ผู้ขาย", name: "บจก. ไทยไทร์ ดิสทริบิวชั่น" });
    expect(m.vehicle).toBeNull();
    expect(m.footer).toBe("");
    expect(m.unpaid).toBe(true);
    expect(m.paymentMethod).toBe("เครดิต");
  });

  it("marks void bills", () => {
    const m = buildDocModel(makeTx({ status: "void", voidedAt: 123, voidReason: "ลูกค้ายกเลิก" }), settingsWith(), "invoice", "58mm");
    expect(m.void).toEqual({ at: 123, reason: "ลูกค้ายกเลิก" });
    expect(m.title).toBe("ใบแจ้งหนี้ / ใบส่งของ");
    expect(m.signatures).toEqual(["ผู้รับสินค้า", "ผู้ส่งสินค้า"]);
  });

  it("walk-in bill without a name, contact-only party, zero total", () => {
    const tx = makeTx({
      customerId: null,
      customer: null,
      contactName: "  ",
      contactPhone: "0899999999",
      vehiclePlate: null,
      vehicleModel: "",
      mileage: 0,
      items: [{ id: "i1", lineNo: 1, itemType: "service", productId: null, serviceItemId: "s1", name: "ตรวจเช็คแบตเตอรี่", unit: null, qty: 1, unitPrice: 0, discount: 0, total: 0, unitCost: 0, note: null }],
      subtotal: 0,
      discount: 0,
      total: 0,
    });
    const m = buildDocModel(tx, settingsWith(), null, "58mm");
    expect(m.party).toEqual({ label: "ลูกค้า", name: null, shopName: null, address: null, taxId: null, phone: "0899999999" });
    expect(m.vehicle).toBeNull();
    expect(m.lines[0]).toMatchObject({ unit: null, total: 0 });
    expect(m.totalText).toBe("ศูนย์บาทถ้วน");
    expect(m.kind).toBe("receipt");
  });

  it("exclusive VAT: before-VAT amount is net of the bill discount", () => {
    const tx = makeTx({ subtotal: B(1000), discount: B(100), vatMode: "exclusive", vatRate: 7, vatAmount: B(63), total: B(963) });
    const m = buildDocModel(tx, settingsWith({ tax: { vatRegistered: true } }), "receipt", "a4");
    expect(m.beforeVat).toBe(B(900));
    expect(m.isTaxInvoice).toBe(true);
    expect(m.totalText).toBe("เก้าร้อยหกสิบสามบาทถ้วน");
  });

  it("customer record wins over the free-text contact; footer is trimmed", () => {
    const tx = makeTx({ contactName: "ชื่อเก่า", customer: { id: "c1", name: "บจก. สยามขนส่ง", phone: null, shopName: "สยามขนส่ง", taxId: "0105561234567", address: "99/9 ถ.พหลโยธิน", lineId: null, email: null } });
    const m = buildDocModel(tx, settingsWith({ shop: { receiptFooter: "  ขอบคุณครับ \n" } }), "invoice", "a5");
    expect(m.party).toMatchObject({ name: "บจก. สยามขนส่ง", shopName: "สยามขนส่ง", address: "99/9 ถ.พหลโยธิน", phone: "081-234-5678" });
    expect(m.footer).toBe("ขอบคุณครับ");
    expect(m.isTaxInvoice).toBe(false);
  });

  it("@page rules", () => {
    expect(pageRule("a4")).toBe("@page { size: A4 portrait; margin: 12mm 14mm; }");
    expect(pageRule("a5")).toBe("@page { size: A5 portrait; margin: 8mm 9mm; }");
    expect(pageRule("80mm")).toBe("@page { margin: 0; }");
    expect(pageRule("58mm", 143)).toBe("@page { size: 58mm 143mm; margin: 0; }");
  });

  it("page numbers only on sheets, doc number sanitised for CSS", () => {
    expect(pageNumberRule("80mm", "S6909-0001")).toBe("");
    expect(pageNumberRule("58mm", "S6909-0001")).toBe("");
    const r = pageNumberRule("a4", 'S69"09\\-0001');
    expect(r).toContain('content: "S6909-0001  ·  หน้า " counter(page) "/" counter(pages)');
    expect(pageNumberRule("a5", "P1")).toContain("@bottom-right");
  });

  it("print media rules out-rank the on-screen A5 sheet size (else Chromium shrinks A5 to fit)", () => {
    expect(PRINT_CSS).toMatch(/@media print \{\s*\.pd-sheet, \.pd-sheet\.pd-a4, \.pd-sheet\.pd-a5 \{ width: auto; padding: 0; \}/);
    expect(PRINT_CSS).toContain(".pd-s-items th.pd-r { text-align: right; }");
  });
});

// ---------------------------------------------------------------------------- main-process job resolution

describe("print job resolution", () => {
  function setup() {
    const t = createTestApi();
    const ins = t.sqlite.prepare(
      "insert into transactions (id, type, doc_no, status, occurred_at, created_at, updated_at, deleted_at) values (?, ?, ?, 'completed', 0, 0, 0, ?)",
    );
    ins.run("sale1", "sale", "S6909-0001", null);
    ins.run("pur1", "purchase", "P6909/0001", null);
    ins.run("gone", "sale", "S6909-0002", 5);
    return t;
  }

  it("fills defaults from settings.print and builds the route", async () => {
    const t = setup();
    const job = resolvePrintJob(t.ctx, { transactionId: "sale1", kind: "invoice" });
    expect(job).toMatchObject({ docNo: "S6909-0001", kind: "invoice", paper: "80mm", printerName: "", silent: false, copies: 1 });
    expect(job.route).toBe("/print/?id=sale1&kind=invoice&paper=80mm&lang=th");
    await t.api.settings.update({ print: { defaultPaper: "a4", printerName: "EPSON_TM_T82", silent: true, copies: 2 } });
    expect(resolvePrintJob(t.ctx, { transactionId: "sale1", kind: "receipt" })).toMatchObject({ paper: "a4", printerName: "EPSON_TM_T82", silent: true, copies: 2 });
    expect(resolvePrintJob(t.ctx, { transactionId: "sale1", kind: "receipt", paper: "58mm", printerName: "", silent: false, copies: 3 })).toMatchObject({
      paper: "58mm",
      printerName: "",
      silent: false,
      copies: 3,
    });
    t.close();
  });

  it("trims the printer name and URL-encodes the id in the route", async () => {
    const t = setup();
    t.sqlite.prepare("insert into transactions (id, type, doc_no, status, occurred_at, created_at, updated_at) values (?, 'sale', 'S1', 'completed', 0, 0, 0)").run("a&b=c");
    const job = resolvePrintJob(t.ctx, { transactionId: "a&b=c", kind: "receipt", paper: "a5", printerName: "  EPSON  " });
    expect(job.printerName).toBe("EPSON");
    expect(job.route).toBe("/print/?id=a%26b%3Dc&kind=receipt&paper=a5&lang=th");
    t.close();
  });

  it("normalises the kind to the transaction type", () => {
    const t = setup();
    expect(resolvePrintJob(t.ctx, { transactionId: "pur1", kind: "receipt" }).kind).toBe("purchase");
    expect(resolvePrintJob(t.ctx, { transactionId: "sale1", kind: "purchase" }).kind).toBe("receipt");
    t.close();
  });

  it("validates input and rejects missing / deleted transactions", () => {
    const t = setup();
    expect(() => resolvePrintJob(t.ctx, { transactionId: "sale1", kind: "letter" })).toThrow();
    expect(() => resolvePrintJob(t.ctx, { transactionId: "sale1", kind: "receipt", paper: "a3" })).toThrow();
    expect(() => resolvePrintJob(t.ctx, { transactionId: "sale1", kind: "receipt", copies: 11 })).toThrow();
    expect(() => resolvePrintJob(t.ctx, { transactionId: "", kind: "receipt" })).toThrow();
    expect(() => resolvePrintJob(t.ctx, { transactionId: "nope", kind: "receipt" })).toThrow(/ไม่พบ/);
    expect(() => resolvePrintJob(t.ctx, { transactionId: "gone", kind: "receipt" })).toThrow(/ไม่พบ/);
    expect(() => resolvePrintJob(t.ctx, null)).toThrow();
    t.close();
  });

  it("file names and failure messages", () => {
    expect(safeFileName("P6909/0001")).toBe("P6909-0001");
    expect(safeFileName("S 69:09*01")).toBe("S-69-09-01");
    expect(safeFileName("///")).toBe("document");
    expect(printFailureMessage("cancelled")).toBe("ยกเลิกการพิมพ์");
    expect(printFailureMessage("Invalid deviceName provided")).toMatch(/ไม่พบเครื่องพิมพ์/);
    expect(printFailureMessage("failed")).toMatch(/^พิมพ์ไม่สำเร็จ/);
    expect(printFailureMessage(undefined)).toBe("พิมพ์ไม่สำเร็จ กรุณาตรวจสอบเครื่องพิมพ์แล้วลองใหม่อีกครั้ง");
    expect(safeFileName("ใบเสร็จ 01")).toBe("ใบเสร็จ-01");
  });
});
