import type { Satang } from "./money";

export type VatMode = "none" | "inclusive" | "exclusive";

export interface CalcLine {
  qty: number;
  unitPrice: Satang;
  /** Line discount amount in satang (not percent). */
  discount?: Satang;
}

/**
 * qty × amount in whole satang, rounded half up. Exact for quantities with at most 2 decimals (the app's limit),
 * unlike Math.round(qty * amount), which rounds some exact halves down because the float product lands just
 * below .5 (0.35 × 1350 = 472.49999999999994 -> 472 instead of 473).
 */
export function mulQty(qty: number, amount: Satang): Satang {
  const hundredths = Math.round(qty * 100) * amount;
  if (!Number.isSafeInteger(hundredths)) return Math.round(qty * amount);
  return hundredths >= 0 ? Math.floor((hundredths + 50) / 100) : -Math.floor((50 - hundredths) / 100);
}

/** qty × unitPrice (rounded half up) - discount, never below zero. */
export function lineTotal(line: CalcLine): Satang {
  return Math.max(0, mulQty(line.qty, line.unitPrice) - (line.discount ?? 0));
}

/**
 * Purchase line: what one unit really cost = unit price minus its share of the LINE discount, without VAT. On a
 * VAT-inclusive bill the line prices contain the VAT, so it is taken out; on an exclusive bill they are already
 * before VAT. The bill-level discount is not allocated to the lines. Computed from the exact price (not from the
 * rounded line total), so a fractional qty without discount keeps the typed price.
 * @param line.discount the line discount as stored (already clamped to qty × unitPrice)
 * @param vatRate percent, e.g. 7 (ignored unless vatMode is "inclusive")
 */
export function purchaseUnitCost(line: CalcLine, vatMode: VatMode, vatRate: number): Satang {
  const rate = vatMode === "inclusive" ? Math.max(0, vatRate) : 0;
  const perUnit = line.qty > 0 ? Math.max(0, line.unitPrice - (line.discount ?? 0) / line.qty) : line.unitPrice;
  return Math.round(rate > 0 ? (perUnit * 100) / (100 + rate) : perUnit);
}

export interface BillTotals {
  /** Sum of line totals. */
  subtotal: Satang;
  /** Bill-level discount (clamped to subtotal). */
  discount: Satang;
  /** subtotal - discount. For inclusive VAT this still contains VAT. */
  net: Satang;
  vatAmount: Satang;
  /** Amount the customer pays / we pay. */
  total: Satang;
  /** total - vatAmount. */
  beforeVat: Satang;
}

/**
 * Single source of truth for bill math, used by the renderer (live preview)
 * and the main process (authoritative values stored in the DB).
 * @param vatRate percent, e.g. 7 for 7%
 */
export function computeTotals(input: {
  lines: CalcLine[];
  discount?: Satang;
  vatMode: VatMode;
  vatRate: number;
}): BillTotals {
  const subtotal = input.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const discount = Math.min(Math.max(0, input.discount ?? 0), subtotal);
  const net = subtotal - discount;
  const rate = input.vatMode === "none" ? 0 : Math.max(0, input.vatRate);
  let vatAmount = 0;
  let total = net;
  if (input.vatMode === "inclusive" && rate > 0) {
    vatAmount = Math.round((net * rate) / (100 + rate));
    total = net;
  } else if (input.vatMode === "exclusive" && rate > 0) {
    vatAmount = Math.round((net * rate) / 100);
    total = net + vatAmount;
  }
  return { subtotal, discount, net, vatAmount, total, beforeVat: total - vatAmount };
}
