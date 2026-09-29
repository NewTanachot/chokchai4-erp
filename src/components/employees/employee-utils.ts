/** Small display helpers for staff screens. */
import { PAY_RATE_UNIT, type PayType } from "@shared/contract";
import { parseDateStr, toDateStr } from "@shared/dates";
import { formatBaht } from "@/lib/format";
import { tr } from "@/lib/i18n";

/** "฿12,000.00 / เดือน" */
export const payRateText = (payType: PayType, payRate: number): string => `${formatBaht(payRate)} / ${PAY_RATE_UNIT[payType]}`;

/** Whole years and months from `from` to `to` (default today). */
export function yearsMonths(from: string, to = toDateStr(Date.now())): { years: number; months: number } {
  const a = parseDateStr(from);
  const b = parseDateStr(to);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months--;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/** "3 ปี 2 เดือน" / "5 เดือน" / "ไม่ถึงเดือน" */
export function durationText(from: string, to?: string): string {
  const { years, months } = yearsMonths(from, to);
  if (!years && !months) return tr("ไม่ถึงเดือน");
  return [years ? tr("{0} ปี", years) : "", months ? tr("{0} เดือน", months) : ""].filter(Boolean).join(" ");
}

/** "1-2345-67890-12-3" */
export function formatNationalId(id: string | null): string | null {
  if (!id || !/^\d{13}$/.test(id)) return id;
  return `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`;
}
