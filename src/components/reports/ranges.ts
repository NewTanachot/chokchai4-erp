/** Date-range presets and bucketing helpers for reports (all in local time). */
import type { DailyRow } from "@shared/contract";
import { dayRange, fromDateInput, lastDaysRange, monthRange, startOfDay, toDateInput, type Range } from "@/lib/format";
import { tr } from "@/lib/i18n";

export type PresetKey = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "year" | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: tr("วันนี้") },
  { key: "yesterday", label: tr("เมื่อวาน") },
  { key: "7d", label: tr("7 วันล่าสุด") },
  { key: "30d", label: tr("30 วันล่าสุด") },
  { key: "month", label: tr("เดือนนี้") },
  { key: "lastMonth", label: tr("เดือนก่อน") },
  { key: "year", label: tr("ปีนี้") },
  { key: "custom", label: tr("กำหนดเอง") },
];

export const isPresetKey = (v: string | null | undefined): v is PresetKey => PRESETS.some((p) => p.key === v);

export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Range for a preset (custom is handled by the caller). */
export function presetRange(key: Exclude<PresetKey, "custom">, now = Date.now()): Range {
  switch (key) {
    case "today":
      return dayRange(now);
    case "yesterday":
      return dayRange(addDays(startOfDay(now).getTime(), -1));
    case "7d":
      return lastDaysRange(7, now);
    case "30d":
      return lastDaysRange(30, now);
    case "month":
      return monthRange(now);
    case "lastMonth": {
      const d = new Date(now);
      return monthRange(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    }
    case "year": {
      const y = new Date(now).getFullYear();
      return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() };
    }
  }
}

/** Inclusive "YYYY-MM-DD" inputs -> [from, to) range. Swaps if reversed. */
export function customRange(fromInput: string, toInput: string): Range | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromInput) || !/^\d{4}-\d{2}-\d{2}$/.test(toInput)) return null;
  let a = fromDateInput(fromInput);
  let b = fromDateInput(toInput);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b < a) [a, b] = [b, a];
  return { from: a, to: addDays(b, 1) };
}

/** The last day inside a [from, to) range, as a date input value. */
export const lastDayInput = (r: Range): string => toDateInput(r.to - 1);
export const firstDayInput = (r: Range): string => toDateInput(r.from);

/** Number of local days touched by the range. */
export function dayCount(r: Range): number {
  let n = 0;
  let d = startOfDay(r.from).getTime();
  while (d < r.to && n < 5000) {
    n++;
    d = addDays(d, 1);
  }
  return n;
}

/** Parses a DailyRow date key "YYYY-MM-DD" as local midnight. */
export const dateKeyToMs = (key: string): number => fromDateInput(key);

export interface Bucket {
  key: string;
  /** Local midnight of the first day of the bucket. */
  start: number;
  salesTotal: number;
  salesCount: number;
  purchasesTotal: number;
  purchasesCount: number;
  net: number;
}

/** Daily rows as-is, or rolled up into calendar months. */
export function bucketize(rows: DailyRow[], by: "day" | "month"): Bucket[] {
  if (by === "day") return rows.map((r) => ({ ...r, key: r.date, start: dateKeyToMs(r.date) }));
  const out = new Map<string, Bucket>();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    let b = out.get(key);
    if (!b) {
      b = { key, start: fromDateInput(`${key}-01`), salesTotal: 0, salesCount: 0, purchasesTotal: 0, purchasesCount: 0, net: 0 };
      out.set(key, b);
    }
    b.salesTotal += r.salesTotal;
    b.salesCount += r.salesCount;
    b.purchasesTotal += r.purchasesTotal;
    b.purchasesCount += r.purchasesCount;
    b.net += r.net;
  }
  return [...out.values()];
}

/** The comparable period just before `r`, with a Thai label for it. */
export function previousRange(preset: PresetKey, r: Range): { range: Range; label: string } {
  switch (preset) {
    case "today":
      return { range: dayRange(addDays(r.from, -1)), label: tr("เมื่อวาน") };
    case "yesterday":
      return { range: dayRange(addDays(r.from, -1)), label: tr("วันก่อนหน้า") };
    case "month":
    case "lastMonth": {
      const d = new Date(r.from);
      return { range: monthRange(new Date(d.getFullYear(), d.getMonth() - 1, 1)), label: tr("เดือนก่อนหน้า") };
    }
    case "year": {
      const y = new Date(r.from).getFullYear() - 1;
      return { range: { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() }, label: tr("ปีก่อน") };
    }
    default: {
      const n = dayCount(r);
      return { range: { from: addDays(r.from, -n), to: r.from }, label: n === 1 ? tr("วันก่อนหน้า") : tr("{0} วันก่อนหน้า", n) };
    }
  }
}
