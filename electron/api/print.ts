/**
 * Printing (main process): renders the /print route in a hidden window sized to the paper,
 * then sends it to a printer (webContents.print) or exports a PDF (webContents.printToPDF).
 *
 * Handshake with src/app/print/page.tsx: the page sets body[data-print-ready="1"] once data, images
 * and fonts are ready (body[data-print-error] on failure) and body[data-print-height-mm] with the
 * measured height, used as the page length for thermal rolls.
 *
 * Dev/test hook: when ERP_PRINT_PDF_DIR is set, savePdf writes "<docNo>-<kind>-<paper>.pdf" there
 * without showing a dialog (headless verification of the real print output).
 */
import { app, BrowserWindow, dialog, shell } from "electron";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import {
  payslipPrintRequestSchema,
  printRequestSchema,
  type Handlers,
  type PaperSize,
  type PrinterInfo,
  type PrintApi,
  type PrintKind,
} from "@shared/contract";
import type { ApiContext } from "./context";
import { payrollRuns, payslips, transactions } from "../db/schema";
import { AppError, notFound } from "./errors";
import { readSettings } from "./settings";
import { createHiddenRendererWindow, getAppUrl } from "../window";
import { translate } from "@shared/i18n";
import { tr } from "../i18n";

/** Paper width in CSS px at 96 dpi (80mm ≈ 302px, 58mm ≈ 219px, A4 ≈ 794px, A5 ≈ 559px). */
const PAPER_WIDTH_PX: Record<PaperSize, number> = { "80mm": 302, "58mm": 219, a4: 794, a5: 559 };
/** Must match @page margins in src/components/print/print-styles.ts (SHEET_MARGIN_MM). */
const SHEET_MARGIN_MM = { a4: { v: 12, h: 14 }, a5: { v: 8, h: 9 } } as const;
const THERMAL_WIDTH_MM = { "80mm": 80, "58mm": 58 } as const;
const RENDER_TIMEOUT_MS = 15_000;
/** Longest thermal roll we ask for (mm); PDF pages cannot exceed 200 in (5080 mm). Longer bills continue on a 2nd page. */
const MAX_ROLL_MM = 5000;

const isThermal = (paper: PaperSize): paper is "80mm" | "58mm" => paper === "80mm" || paper === "58mm";

export interface PrintJob {
  /** Document number / name (PDF file name). */
  docNo: string;
  kind: PrintKind | "payslip";
  paper: PaperSize;
  printerName: string;
  silent: boolean;
  copies: number;
  /** Renderer route that draws the document. */
  route: string;
}

/** Validates the request, fills defaults from settings.print and checks the transaction exists. Pure (no Electron). */
export function resolvePrintJob(ctx: ApiContext, input: unknown): PrintJob {
  const req = printRequestSchema.parse(input);
  const defaults = readSettings(ctx.db).print;
  const tx = ctx.db
    .select({ id: transactions.id, type: transactions.type, docNo: transactions.docNo, deletedAt: transactions.deletedAt })
    .from(transactions)
    .where(eq(transactions.id, req.transactionId))
    .get();
  if (!tx || tx.deletedAt !== null) throw notFound("รายการที่จะพิมพ์");
  // A purchase always prints as a purchase record; a sale never does.
  const kind: PrintKind = tx.type === "purchase" ? "purchase" : req.kind === "invoice" ? "invoice" : "receipt";
  const paper = req.paper ?? defaults.defaultPaper;
  const copies = Math.min(10, Math.max(1, Math.round(req.copies ?? defaults.copies ?? 1)));
  const route = `/print/?id=${encodeURIComponent(tx.id)}&kind=${kind}&paper=${paper}&lang=${defaults.documentLanguage}`;
  return {
    docNo: tx.docNo,
    kind,
    paper,
    printerName: (req.printerName ?? defaults.printerName ?? "").trim(),
    silent: req.silent ?? defaults.silent,
    copies,
    route,
  };
}

/** Payslip print job (route /print/payslip/); defaults from settings.print like bills. Pure (no Electron). */
export function resolvePayslipJob(ctx: ApiContext, input: unknown): PrintJob {
  const req = payslipPrintRequestSchema.parse(input);
  const defaults = readSettings(ctx.db).print;
  const slip = ctx.db
    .select({ id: payslips.id, name: payslips.employeeName, periodStart: payrollRuns.periodStart, deletedAt: payrollRuns.deletedAt })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(eq(payslips.id, req.payslipId))
    .get();
  if (!slip || slip.deletedAt !== null) throw notFound("สลิปเงินเดือน");
  const paper = req.paper ?? defaults.defaultPaper;
  return {
    docNo: `${translate(defaults.documentLanguage, "สลิปเงินเดือน")}-${slip.name}-${slip.periodStart.slice(0, 7)}`,
    kind: "payslip",
    paper,
    printerName: (req.printerName ?? defaults.printerName ?? "").trim(),
    silent: req.silent ?? defaults.silent,
    copies: Math.min(10, Math.max(1, Math.round(req.copies ?? 1))),
    route: `/print/payslip/?id=${encodeURIComponent(slip.id)}&paper=${paper}&lang=${defaults.documentLanguage}`,
  };
}

/** File-system safe document number. */
export const safeFileName = (s: string): string => s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "document";

/** Thai message for webContents.print() failure reasons. */
export function printFailureMessage(reason: string | undefined): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("cancel")) return "ยกเลิกการพิมพ์";
  if (r.includes("devicename") || r.includes("printer")) return "ไม่พบเครื่องพิมพ์ที่เลือก กรุณาตรวจสอบว่าเปิดเครื่องและเชื่อมต่ออยู่ หรือเลือกเครื่องพิมพ์อื่น";
  return `พิมพ์ไม่สำเร็จ${reason ? ` (${reason})` : ""} กรุณาตรวจสอบเครื่องพิมพ์แล้วลองใหม่อีกครั้ง`;
}

// ---------------------------------------------------------------------------- Electron side

/** Hidden windows we created (excluded when picking a parent for dialogs / a host for getPrintersAsync). */
const printWindows = new Set<BrowserWindow>();

function appWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && !printWindows.has(focused)) return focused;
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !printWindows.has(w)) ?? null;
}

function isDefaultPrinter(p: Electron.PrinterInfo): boolean {
  const legacy = (p as { isDefault?: unknown }).isDefault;
  if (typeof legacy === "boolean") return legacy;
  const o = (p.options ?? {}) as Record<string, unknown>;
  return o["is-default"] === "true" || o["printer-is-default"] === "true" || o.isDefault === "true" || o.isDefault === true;
}

async function listPrinters(): Promise<PrinterInfo[]> {
  const host = appWindow();
  const temp = host ? null : new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    const list = await (host ?? temp!).webContents.getPrintersAsync();
    return list
      .map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: isDefaultPrinter(p) }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.displayName.localeCompare(b.displayName, "th"));
  } finally {
    temp?.destroy();
  }
}

function destroy(win: BrowserWindow): void {
  printWindows.delete(win);
  if (!win.isDestroyed()) win.destroy();
}

interface RenderedDoc {
  win: BrowserWindow;
  /** Measured document height (thermal page length). */
  heightMm: number;
}

interface PageState {
  ready: boolean;
  error: string | null;
  heightMm: number;
}

const STATE_JS = `(() => {
  const d = document.body ? document.body.dataset : null;
  return d ? { ready: d.printReady === "1", error: d.printError || null, heightMm: Number(d.printHeightMm) || 0 } : null;
})()`;

/** Loads the print route in a hidden window and waits for the page's ready flag. Caller destroys the window. */
async function renderDocument(job: PrintJob): Promise<RenderedDoc> {
  const width = PAPER_WIDTH_PX[job.paper];
  const height = isThermal(job.paper) ? 1600 : Math.round((width * 297) / 210);
  const win = createHiddenRendererWindow(width, height);
  printWindows.add(win);
  win.setContentSize(width, height);
  try {
    const deadline = Date.now() + RENDER_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AppError("INTERNAL", "เตรียมเอกสารสำหรับพิมพ์ไม่ทันเวลา กรุณาลองใหม่อีกครั้ง")), RENDER_TIMEOUT_MS);
    });
    const load = win.loadURL(getAppUrl(job.route));
    load.catch(() => undefined); // may reject later (window destroyed after a timeout): never unhandled
    try {
      await Promise.race([load, timeout]);
    } finally {
      clearTimeout(timer);
    }
    for (;;) {
      if (win.isDestroyed()) throw new AppError("INTERNAL", "หน้าต่างพิมพ์ถูกปิดก่อนพิมพ์เสร็จ");
      const state = (await win.webContents.executeJavaScript(STATE_JS, true)) as PageState | null;
      if (state?.error) throw new AppError("INTERNAL", `เตรียมเอกสารไม่สำเร็จ: ${state.error}`);
      if (state?.ready) return { win, heightMm: Math.min(MAX_ROLL_MM, Math.max(20, state.heightMm)) };
      if (Date.now() > deadline) throw new AppError("INTERNAL", "เตรียมเอกสารสำหรับพิมพ์ไม่ทันเวลา กรุณาลองใหม่อีกครั้ง");
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (e) {
    destroy(win);
    if (e instanceof AppError) throw e;
    throw new AppError("INTERNAL", `เปิดเอกสารสำหรับพิมพ์ไม่สำเร็จ: ${(e as Error)?.message ?? String(e)}`);
  }
}

function printOptions(job: PrintJob, heightMm: number): Electron.WebContentsPrintOptions {
  const base: Electron.WebContentsPrintOptions = {
    silent: job.silent,
    printBackground: true,
    deviceName: job.printerName || undefined,
    copies: job.copies,
  };
  if (isThermal(job.paper)) {
    return {
      ...base,
      margins: { marginType: "none" },
      pageSize: { width: THERMAL_WIDTH_MM[job.paper] * 1000, height: Math.ceil(heightMm) * 1000 },
    };
  }
  // "default" margins = the page's CSS @page margins.
  return { ...base, margins: { marginType: "default" }, pageSize: job.paper === "a4" ? "A4" : "A5" };
}

function pdfOptions(job: PrintJob, heightMm: number): Electron.PrintToPDFOptions {
  const inch = (mm: number) => mm / 25.4;
  if (isThermal(job.paper)) {
    return {
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: { width: inch(THERMAL_WIDTH_MM[job.paper]), height: inch(Math.ceil(heightMm)) },
    };
  }
  const m = SHEET_MARGIN_MM[job.paper];
  return {
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: inch(m.v), bottom: inch(m.v), left: inch(m.h), right: inch(m.h) },
    pageSize: job.paper === "a4" ? "A4" : "A5",
  };
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function printJob(job: PrintJob): Promise<{ printed: boolean; error?: string }> {
  if (job.printerName || job.silent) {
    const printers = await listPrinters().catch(() => null);
    if (printers && job.printerName && !printers.some((p) => p.name === job.printerName)) {
      return { printed: false, error: `ไม่พบเครื่องพิมพ์ "${job.printerName}" กรุณาตรวจสอบว่าเปิดเครื่องและเชื่อมต่ออยู่ หรือเลือกเครื่องพิมพ์อื่น` };
    }
    if (printers && printers.length === 0) {
      return { printed: false, error: "ไม่พบเครื่องพิมพ์ในเครื่องนี้ กรุณาติดตั้งหรือเชื่อมต่อเครื่องพิมพ์ก่อน (หรือเลือก บันทึกเป็น PDF)" };
    }
  }
  let doc: RenderedDoc;
  try {
    doc = await renderDocument(job);
  } catch (e) {
    return { printed: false, error: errorText(e) };
  }
  try {
    const result = await new Promise<{ success: boolean; reason: string }>((resolve) => {
      doc.win.webContents.print(printOptions(job, doc.heightMm), (success, reason) => resolve({ success, reason }));
    });
    return result.success ? { printed: true } : { printed: false, error: printFailureMessage(result.reason) };
  } catch (e) {
    return { printed: false, error: printFailureMessage(errorText(e)) };
  } finally {
    destroy(doc.win);
  }
}

async function savePdfJob(job: PrintJob): Promise<{ path: string } | null> {
  const devDir = process.env.ERP_PRINT_PDF_DIR;
  let target: string;
  if (devDir) {
    fs.mkdirSync(devDir, { recursive: true });
    target = path.join(devDir, `${safeFileName(job.docNo)}-${job.kind}-${job.paper}.pdf`);
  } else {
    const options: Electron.SaveDialogOptions = {
      title: tr("บันทึกเป็นไฟล์ PDF"),
      buttonLabel: tr("บันทึก"),
      defaultPath: path.join(app.getPath("documents"), `${safeFileName(job.docNo)}.pdf`),
      filters: [{ name: tr("เอกสาร PDF"), extensions: ["pdf"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const parent = appWindow();
    const res = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return null;
    target = /\.pdf$/i.test(res.filePath) ? res.filePath : `${res.filePath}.pdf`;
  }
  const doc = await renderDocument(job);
  try {
    const data = await doc.win.webContents.printToPDF(pdfOptions(job, doc.heightMm));
    fs.writeFileSync(target, data);
  } catch (e) {
    throw new AppError("INTERNAL", `บันทึกไฟล์ PDF ไม่สำเร็จ: ${errorText(e)}`);
  } finally {
    destroy(doc.win);
  }
  if (!devDir) shell.showItemInFolder(target);
  return { path: target };
}

export function createPrintApi(ctx: ApiContext): Handlers<PrintApi> {
  return {
    printers: () => listPrinters(),
    print: (input) => printJob(resolvePrintJob(ctx, input)),
    savePdf: (input) => savePdfJob(resolvePrintJob(ctx, input)),
    printPayslip: (input) => printJob(resolvePayslipJob(ctx, input)),
    savePayslipPdf: (input) => savePdfJob(resolvePayslipJob(ctx, input)),
  };
}
