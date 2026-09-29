/** Reports & dashboard queries. All ranges are [from, to) epoch ms, computed in local time by the caller. */
import { z } from "zod";
import { rangeSchema, type DateRange } from "./common";
import type { Product } from "./catalog";
import type { PaymentMethod, TransactionSummary } from "./transactions";

export interface TypeTotals {
  /** Number of completed bills. */
  count: number;
  /** Sum of bill totals (including VAT). */
  total: number;
  vatAmount: number;
  /** Sum of totals of bills with paymentStatus "unpaid". */
  unpaidTotal: number;
  /** Number of bills with paymentStatus "unpaid". */
  unpaidCount: number;
}

export interface PaymentMethodTotal {
  method: PaymentMethod;
  count: number;
  total: number;
}

export interface Summary {
  range: DateRange;
  /** รายรับ: completed sales. */
  sales: TypeTotals;
  /** รายจ่าย: completed purchases. */
  purchases: TypeTotals;
  /** sales.total - purchases.total */
  net: number;
  /**
   * กำไรขั้นต้น = Σ over completed sales of (total − vatAmount)
   *              − Σ round(qty × unitCost) of their product lines.
   * VAT is not revenue; the bill-level discount is already inside `total`.
   */
  grossProfit: number;
  /**
   * Completed sales dated in the range, by payment method (paid AND unpaid; only methods present in the data),
   * largest total first. This is sales by bill date, NOT money received: see salesReceivedByPaymentMethod.
   */
  salesByPaymentMethod: PaymentMethodTotal[];
  /** Completed purchases dated in the range, by payment method (paid and unpaid), largest total first. */
  purchasesByPaymentMethod: PaymentMethodTotal[];
  /**
   * Money actually received in the range: completed sales with paymentStatus "paid" whose paidAt is in the range
   * (whatever their bill date, so credit collected in the range counts), by payment method, largest total first.
   */
  salesReceivedByPaymentMethod: PaymentMethodTotal[];
  /** Money actually paid out in the range: completed paid purchases whose paidAt is in the range, by payment method. */
  purchasesPaidByPaymentMethod: PaymentMethodTotal[];
  /** The part of salesReceivedByPaymentMethod that settles sales dated before the range (collected credit). */
  salesCollectedEarlier: { count: number; total: number };
  /** Completed sales: Σ line totals by line type (before bill-level discount), largest first. */
  salesByItemType: { itemType: "product" | "service" | "custom"; total: number }[];
  /** Voided bills (sales + purchases) whose occurredAt is in the range. */
  voidCount: number;
  /** Completed sales dated in the range by the user who created them, largest total first (userId null: unknown). */
  salesByUser: { userId: string | null; name: string | null; count: number; total: number }[];
}

export interface DailyRow {
  /** Local date "YYYY-MM-DD". */
  date: string;
  salesTotal: number;
  salesCount: number;
  purchasesTotal: number;
  purchasesCount: number;
  net: number;
}

export interface TopItemRow {
  itemType: "product" | "service" | "custom";
  /** productId / serviceItemId; null for custom lines (grouped by name). */
  refId: string | null;
  /** Name snapshot from the most recent line. */
  name: string;
  /** Unit snapshot from the most recent line. */
  unit: string | null;
  qty: number;
  total: number;
  /** Number of distinct bills containing the item. */
  billCount: number;
}

export const summaryQuerySchema = rangeSchema;
export const dailyQuerySchema = rangeSchema;
export const topItemsQuerySchema = rangeSchema.extend({
  type: z.enum(["sale", "purchase"]).default("sale"),
  /** Only lines of this type (e.g. "service" for top services). */
  itemType: z.enum(["product", "service", "custom"]).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});
export type TopItemsQuery = z.input<typeof topItemsQuerySchema>;
export const lowStockQuerySchema = z.object({ limit: z.number().int().min(1).max(500).default(20) });
export type LowStockQuery = z.input<typeof lowStockQuerySchema>;
export const recentQuerySchema = z.object({
  limit: z.number().int().min(1).max(500).default(10),
  /** Optional window: occurredAt >= from */
  from: z.number().int().optional(),
  /** Optional window: occurredAt < to */
  to: z.number().int().optional(),
});
export type RecentQuery = z.input<typeof recentQuerySchema>;

export interface ReportsApi {
  summary(range: DateRange): Promise<Summary>;
  /** One row per local day in the range (days with no activity included as zeros). */
  daily(range: DateRange): Promise<DailyRow[]>;
  /** Best sellers (or most purchased) by line total, completed bills only. */
  topItems(query: TopItemsQuery): Promise<TopItemRow[]>;
  /** Active stock-tracked products with stockQty <= minStock, most urgent first. */
  lowStock(query: LowStockQuery): Promise<Product[]>;
  /** Latest transactions (any type, completed + void), newest first; optionally within [from, to). */
  recent(query: RecentQuery): Promise<TransactionSummary[]>;
}
