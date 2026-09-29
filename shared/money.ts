/**
 * Money is stored and transported as integer satang (1 baht = 100 satang)
 * to avoid floating-point rounding errors. Convert only at the UI edge.
 */
export type Satang = number;

export function bahtToSatang(baht: number | string): Satang {
  const n = typeof baht === "string" ? Number(baht.replace(/,/g, "")) : baht;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function satangToBaht(satang: Satang): number {
  return satang / 100;
}

const bahtFormatter = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 -> "1,234.56" */
export function formatMoney(satang: Satang): string {
  return bahtFormatter.format(satang / 100);
}

/** 123456 -> "฿1,234.56" */
export function formatBaht(satang: Satang): string {
  const sign = satang < 0 ? "-" : "";
  return `${sign}฿${bahtFormatter.format(Math.abs(satang) / 100)}`;
}

/** Quantities may have up to 2 decimals (e.g. litres of oil). */
export function roundQty(qty: number): number {
  return Math.round(qty * 100) / 100;
}

const qtyFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
export function formatQty(qty: number): string {
  return qtyFormatter.format(qty);
}
