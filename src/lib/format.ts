/** Display formatting (Thai locale, Buddhist-era years) and local-date helpers. */
import { parseDateStr } from "@shared/dates";
import { LOCALE, tr } from "@/lib/i18n";
export { formatBaht, formatMoney, formatQty, bahtToSatang, satangToBaht } from "@shared/money";

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const dateLongFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });

/** 25 ก.ย. 2569 */
export const formatDate = (ms: number): string => dateFmt.format(ms);
/** วันพฤหัสบดีที่ 25 กันยายน 2569 */
export const formatDateLong = (ms: number): string => dateLongFmt.format(ms);
/** 14:05 */
export const formatTime = (ms: number): string => timeFmt.format(ms);
/** 25 ก.ย. 2569 14:05 */
export const formatDateTime = (ms: number): string => `${dateFmt.format(ms)} ${timeFmt.format(ms)}`;
/** A calendar date "YYYY-MM-DD" as 25 ก.ย. 2569 ("—" for null). */
export const formatDateStr = (s: string | null | undefined): string => (s ? dateFmt.format(parseDateStr(s)) : "—");
const dateStrLongFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short" });
/** "YYYY-MM-DD" as ศ. 25 ก.ย. */
export const formatDateStrShort = (s: string): string => dateStrLongFmt.format(parseDateStr(s));
/** Minutes as "8 ชม. 5 นาที" / "45 นาที". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return tr("{0} นาที", m);
  return m ? tr("{0} ชม. {1} นาที", h, m) : tr("{0} ชม.", h);
}

/** "เมื่อสักครู่", "3 ชั่วโมงที่แล้ว", "5 วันที่แล้ว", else the date. */
export function formatRelative(ms: number, now = Date.now()): string {
  const diff = now - ms;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return tr("เมื่อสักครู่");
  if (diff < hour) return tr("{0} นาทีที่แล้ว", Math.floor(diff / min));
  if (diff < day) return tr("{0} ชั่วโมงที่แล้ว", Math.floor(diff / hour));
  if (diff < 30 * day) return tr("{0} วันที่แล้ว", Math.floor(diff / day));
  return formatDate(ms);
}

export interface Range {
  from: number;
  to: number;
}

export function startOfDay(d: Date | number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** [00:00 of the day, 00:00 of the next day) in local time. */
export function dayRange(d: Date | number = Date.now()): Range {
  const from = startOfDay(d);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.getTime(), to: to.getTime() };
}

export const todayRange = (): Range => dayRange(Date.now());

/** Last `days` days including today. */
export function lastDaysRange(days: number, now = Date.now()): Range {
  const { to } = dayRange(now);
  const from = startOfDay(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: from.getTime(), to };
}

export function monthRange(d: Date | number = Date.now()): Range {
  const x = new Date(d);
  const from = new Date(x.getFullYear(), x.getMonth(), 1);
  const to = new Date(x.getFullYear(), x.getMonth() + 1, 1);
  return { from: from.getTime(), to: to.getTime() };
}

/** "YYYY-MM-DD" (local) for <input type="date">. */
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parses "YYYY-MM-DD" as local midnight. */
export function fromDateInput(v: string): number {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

/** "YYYY-MM-DDTHH:mm" (local) for <input type="datetime-local">. */
export function toDateTimeInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${toDateInput(ms)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromDateTimeInput(v: string): number {
  return new Date(v).getTime();
}
