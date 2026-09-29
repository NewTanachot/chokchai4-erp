/** Small display helpers used by the dashboard and reports. */
import type { LineItemType, PaymentMethod } from "@shared/contract";
import { LOCALE, tr } from "@/lib/i18n";

const dayShortFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const monthShortFmt = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "2-digit" });
const monthLongFmt = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });
const intFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** 12 ก.ย. */
export const formatDayShort = (ms: number) => dayShortFmt.format(ms);
// Fixed abbreviations: Intl "short" weekdays differ between ICU builds (Chromium gives "อังคาร").
const WEEKDAY_SHORT = [tr("อา."), tr("จ."), tr("อ."), tr("พ."), tr("พฤ."), tr("ศ."), tr("ส.")];
/** ศ. */
export const formatWeekdayShort = (ms: number) => WEEKDAY_SHORT[new Date(ms).getDay()];
/** ก.ย. 69 */
export const formatMonthShort = (ms: number) => monthShortFmt.format(ms);
/** กันยายน 2569 */
export const formatMonthLong = (ms: number) => monthLongFmt.format(ms);
/** 1,234 */
export const formatInt = (n: number) => intFmt.format(n);
/** 12.5% (ratio 0.125) */
export const formatPercent = (ratio: number) => `${pctFmt.format(ratio * 100)}%`;

/** Axis ticks in whole baht: 12,000 / 1.2 ล้าน. */
export function formatAxisBaht(satang: number): string {
  const baht = satang / 100;
  if (Math.abs(baht) >= 1_000_000) return tr("{0} ล้าน", pctFmt.format(baht / 1_000_000));
  return intFmt.format(baht);
}

export const PAYMENT_ORDER: PaymentMethod[] = ["cash", "transfer", "card", "credit", "other"];

export const ITEM_TYPE_LABELS: Record<LineItemType, string> = {
  product: tr("สินค้า"),
  service: tr("ค่าบริการ / ค่าแรง"),
  custom: tr("รายการอื่น ๆ"),
};

/** "สวัสดีตอนเช้า" etc. */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return tr("สวัสดีตอนเช้า");
  if (h >= 12 && h < 17) return tr("สวัสดีตอนบ่าย");
  if (h >= 17 && h < 21) return tr("สวัสดีตอนเย็น");
  return tr("สวัสดี");
}
