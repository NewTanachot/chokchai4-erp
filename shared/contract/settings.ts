/** App settings (ตั้งค่า). Stored as JSON rows in the settings table. */
import { z } from "zod";
import type { VatMode } from "../calc";
import { isDateStr, isHhmm } from "../dates";

export type PaperSize = "80mm" | "58mm" | "a4" | "a5";

export const PAPER_LABELS: Record<PaperSize, string> = {
  "80mm": "ใบเสร็จความร้อน 80 มม.",
  "58mm": "ใบเสร็จความร้อน 58 มม.",
  a4: "A4",
  a5: "A5",
};

export interface AppSettings {
  shop: {
    name: string;
    branch: string;
    address: string;
    phone: string;
    taxId: string;
    lineId: string;
    /** data: URL (PNG/JPEG, <= ~300KB) printed on receipts; "" = none. */
    logoDataUrl: string;
    /** Printed at the bottom of receipts. */
    receiptFooter: string;
  };
  tax: {
    vatRegistered: boolean;
    /** Percent, e.g. 7. */
    vatRate: number;
    /** Default VAT mode for new sales. */
    defaultVatMode: VatMode;
    /** Default VAT mode for new purchases (separate: it follows how most suppliers write their invoices). */
    defaultPurchaseVatMode: VatMode;
  };
  docs: {
    salePrefix: string;
    purchasePrefix: string;
    /** Use Buddhist-era year (2569 -> "69") in document numbers. */
    useBuddhistYear: boolean;
  };
  print: {
    defaultPaper: PaperSize;
    /** OS printer name; "" = system default. */
    printerName: string;
    /** Print without showing the OS print dialog. */
    silent: boolean;
    copies: number;
    showLogo: boolean;
    /** Open print preview automatically after saving a sale. */
    autoPrintAfterSale: boolean;
    /** Print "ผู้ออกบิล: <user>" on receipts and invoices. */
    showStaffName: boolean;
    /** Language of printed documents (receipts, invoices, payslips), independent of the program language. */
    documentLanguage: "th" | "en";
  };
  inventory: {
    /** Allow selling more than in stock (stock goes negative, a warning is shown). */
    allowNegativeStock: boolean;
    /** Set product cost price to the unit price of each purchase. */
    updateCostOnPurchase: boolean;
  };
  backup: {
    /** Automatic daily backup to <userData>/backups on start-up. */
    autoBackup: boolean;
    keepDays: number;
  };
  security: {
    /** Log out after this many idle minutes (0 = never). */
    autoLockMinutes: number;
  };
  /** Work schedule and pay rules (time clock, payslips). */
  payroll: PayrollSettings;
}

export type LateDeduction = "none" | "per_minute" | "per_time";

export interface PayrollSettings {
  /** "HH:MM" local time. */
  workStart: string;
  workEnd: string;
  /** A clock-in later than workStart + this many minutes counts as late (lateness is counted from workStart). */
  lateGraceMinutes: number;
  /** Working weekdays, 0 = Sunday ... 6 = Saturday. */
  workDays: number[];
  /** Shop holidays "YYYY-MM-DD" (not work days: nobody is absent). */
  holidays: string[];
  /** Hours of a work day (hourly rate = daily rate / hoursPerDay). */
  hoursPerDay: number;
  /** Daily rate of monthly staff = salary / daysPerMonth (absence and unpaid leave deductions). */
  daysPerMonth: number;
  /** none, per_minute (hourly rate / 60 per late minute) or per_time (lateDeductionAmount per late day). */
  lateDeduction: LateDeduction;
  /** Satang per late day (per_time). */
  lateDeductionAmount: number;
  /** Deduct unexcused absences from monthly salaries. */
  deductAbsence: boolean;
  /** Pay overtime (minutes after workEnd) automatically on payslips. */
  otEnabled: boolean;
  /** OT pay = hours × hourly rate × this. */
  otMultiplier: number;
  /** Minutes after workEnd below this do not count as OT (per day). */
  otMinMinutes: number;
  /** Social security (ประกันสังคม) employee rate, percent. */
  socialSecurityRate: number;
  /** Wage floor / ceiling of the contribution (satang). */
  socialSecurityMinBase: number;
  socialSecurityMaxBase: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  shop: {
    name: "โชคชัย 4 ยางยนต์ 2002",
    branch: "",
    address: "",
    phone: "",
    taxId: "",
    lineId: "",
    logoDataUrl: "",
    receiptFooter: "ขอบคุณที่ใช้บริการ",
  },
  tax: { vatRegistered: false, vatRate: 7, defaultVatMode: "none", defaultPurchaseVatMode: "none" },
  docs: { salePrefix: "S", purchasePrefix: "P", useBuddhistYear: true },
  print: {
    defaultPaper: "80mm",
    printerName: "",
    silent: false,
    copies: 1,
    showLogo: true,
    autoPrintAfterSale: false,
    showStaffName: true,
    documentLanguage: "th",
  },
  inventory: { allowNegativeStock: true, updateCostOnPurchase: true },
  backup: { autoBackup: true, keepDays: 30 },
  security: { autoLockMinutes: 0 },
  payroll: {
    workStart: "08:00",
    workEnd: "17:00",
    lateGraceMinutes: 15,
    workDays: [1, 2, 3, 4, 5, 6],
    holidays: [],
    hoursPerDay: 8,
    daysPerMonth: 30,
    lateDeduction: "none",
    lateDeductionAmount: 0,
    deductAbsence: true,
    otEnabled: false,
    otMultiplier: 1.5,
    otMinMinutes: 30,
    // Employee rate 5%, wage base 1,650-17,500 baht (ceiling in force from 2026; check the latest SSO rules).
    socialSecurityRate: 5,
    socialSecurityMinBase: 165_000,
    socialSecurityMaxBase: 1_750_000,
  },
};

const s = (max = 500) => z.string().max(max);

export const settingsPatchSchema = z.object({
  shop: z
    .object({
      name: s(200),
      branch: s(200),
      address: s(1000),
      phone: s(100),
      taxId: s(50),
      lineId: s(100),
      logoDataUrl: z.string().max(2_000_000).refine((v) => v === "" || v.startsWith("data:image/"), "รูปโลโก้ไม่ถูกต้อง"),
      receiptFooter: s(1000),
    })
    .partial()
    .optional(),
  tax: z
    .object({
      vatRegistered: z.boolean(),
      vatRate: z.number().min(0).max(100),
      defaultVatMode: z.enum(["none", "inclusive", "exclusive"]),
      defaultPurchaseVatMode: z.enum(["none", "inclusive", "exclusive"]),
    })
    .partial()
    .optional(),
  docs: z
    .object({
      salePrefix: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/, "ใช้ได้เฉพาะ A-Z, 0-9 และ -"),
      purchasePrefix: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/, "ใช้ได้เฉพาะ A-Z, 0-9 และ -"),
      useBuddhistYear: z.boolean(),
    })
    .partial()
    .optional(),
  print: z
    .object({
      defaultPaper: z.enum(["80mm", "58mm", "a4", "a5"]),
      printerName: s(300),
      silent: z.boolean(),
      copies: z.number().int().min(1).max(10),
      showLogo: z.boolean(),
      autoPrintAfterSale: z.boolean(),
      showStaffName: z.boolean(),
      documentLanguage: z.enum(["th", "en"]),
    })
    .partial()
    .optional(),
  inventory: z.object({ allowNegativeStock: z.boolean(), updateCostOnPurchase: z.boolean() }).partial().optional(),
  backup: z.object({ autoBackup: z.boolean(), keepDays: z.number().int().min(1).max(365) }).partial().optional(),
  security: z.object({ autoLockMinutes: z.number().int().min(0).max(24 * 60) }).partial().optional(),
  payroll: z
    .object({
      workStart: z.string().refine(isHhmm, "เวลาไม่ถูกต้อง (ชช:นน)"),
      workEnd: z.string().refine(isHhmm, "เวลาไม่ถูกต้อง (ชช:นน)"),
      lateGraceMinutes: z.number().int().min(0).max(240),
      workDays: z
        .array(z.number().int().min(0).max(6))
        .max(7)
        .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
      holidays: z
        .array(z.string().refine(isDateStr, "วันที่ไม่ถูกต้อง"))
        .max(1000)
        .transform((d) => [...new Set(d)].sort()),
      hoursPerDay: z.number().min(1).max(24),
      daysPerMonth: z.number().int().min(20).max(31),
      lateDeduction: z.enum(["none", "per_minute", "per_time"]),
      lateDeductionAmount: z.number().int().min(0).max(100_000_00),
      deductAbsence: z.boolean(),
      otEnabled: z.boolean(),
      otMultiplier: z.number().min(1).max(5),
      otMinMinutes: z.number().int().min(0).max(240),
      socialSecurityRate: z.number().min(0).max(20),
      socialSecurityMinBase: z.number().int().min(0),
      socialSecurityMaxBase: z.number().int().min(0),
    })
    .partial()
    .optional(),
});
export type SettingsPatch = z.input<typeof settingsPatchSchema>;

export interface SettingsApi {
  get(): Promise<AppSettings>;
  /** Deep-merges the patch (section by section) and returns the full settings. */
  update(patch: SettingsPatch): Promise<AppSettings>;
}
