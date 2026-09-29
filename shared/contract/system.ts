/** Desktop-only capabilities: printing, backup/restore, app info. */
import { z } from "zod";
import { idSchema, type Millis } from "./common";
import type { PaperSize } from "./settings";

/** What to print for a transaction. */
export type PrintKind = "receipt" | "invoice" | "purchase";

export const PRINT_KIND_LABELS: Record<PrintKind, string> = {
  receipt: "ใบเสร็จรับเงิน",
  invoice: "ใบแจ้งหนี้ / ใบส่งของ",
  purchase: "ใบบันทึกการซื้อ",
};

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export const printRequestSchema = z.object({
  transactionId: idSchema,
  kind: z.enum(["receipt", "invoice", "purchase"]),
  /** Defaults to settings.print.defaultPaper. */
  paper: z.enum(["80mm", "58mm", "a4", "a5"]).optional(),
  /** Defaults to settings.print.printerName ("" = OS default). */
  printerName: z.string().optional(),
  /** Defaults to settings.print.silent. */
  silent: z.boolean().optional(),
  copies: z.number().int().min(1).max(10).optional(),
});
export type PrintRequest = z.input<typeof printRequestSchema>;

/** A payslip (สลิปเงินเดือน), printed through the same pipeline as bills (route /print/payslip/). */
export const payslipPrintRequestSchema = z.object({
  payslipId: idSchema,
  paper: z.enum(["80mm", "58mm", "a4", "a5"]).optional(),
  printerName: z.string().optional(),
  silent: z.boolean().optional(),
  copies: z.number().int().min(1).max(10).optional(),
});
export type PayslipPrintRequest = z.input<typeof payslipPrintRequestSchema>;

export interface PrintApi {
  printers(): Promise<PrinterInfo[]>;
  /** Renders /print in a hidden window and sends it to the printer. */
  print(req: PrintRequest): Promise<{ printed: boolean; error?: string }>;
  /** Asks where to save, writes a PDF. null when the user cancels. */
  savePdf(req: PrintRequest): Promise<{ path: string } | null>;
  printPayslip(req: PayslipPrintRequest): Promise<{ printed: boolean; error?: string }>;
  savePayslipPdf(req: PayslipPrintRequest): Promise<{ path: string } | null>;
}

export interface SystemInfo {
  appName: string;
  version: string;
  platform: string;
  dbPath: string;
  userDataPath: string;
  backupsPath: string;
  lastAutoBackupAt: Millis | null;
}

export interface BackupFile {
  path: string;
  name: string;
  size: number;
  createdAt: Millis;
}

export interface SystemApi {
  info(): Promise<SystemInfo>;
  /** Save-dialog then online backup of the SQLite DB. null if cancelled. */
  backup(): Promise<{ path: string } | null>;
  /** Automatic backups in <userData>/backups, newest first. */
  listBackups(): Promise<BackupFile[]>;
  /**
   * Open-dialog (or given path from listBackups), validate it is a database of this program,
   * keep a safety copy of the current DB, replace it and relaunch the app.
   */
  restore(input?: { path?: string }): Promise<{ restored: boolean }>;
  openDataFolder(): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Public (also on the login screen). Saves the program language of this computer; the renderer then reloads. */
  setLanguage(input: SetLanguageInput): Promise<void>;
}

export const restoreInputSchema = z.object({ path: z.string().optional() }).optional();
export const setLanguageSchema = z.object({ language: z.enum(["th", "en"]) });
export type SetLanguageInput = z.input<typeof setLanguageSchema>;
