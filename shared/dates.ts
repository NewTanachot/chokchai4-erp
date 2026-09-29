/**
 * Calendar dates without a time of day, as local "YYYY-MM-DD" strings (birth / start dates, attendance days,
 * leave days, payroll periods). They compare and sort as plain strings. Moments (clock-in times, bill dates)
 * stay epoch ms; these helpers convert between the two in LOCAL time.
 */
export type DateStr = string;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date of a moment. */
export function toDateStr(d: Date | number): DateStr {
  const x = typeof d === "number" ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for an existing calendar date written as YYYY-MM-DD. */
export function isDateStr(s: unknown): s is DateStr {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2600 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo - 1);
}

/** Local midnight of a date. */
export function parseDateStr(s: DateStr): Date {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Epoch ms of a local date at "HH:MM" (default midnight). */
export function dateTimeMs(s: DateStr, hhmm = "00:00"): number {
  const d = parseDateStr(s);
  const [h, min] = parseHhmm(hhmm);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

/** "08:30" -> [8, 30]; invalid input -> [0, 0]. */
export function parseHhmm(hhmm: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return [0, 0];
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))];
}

export const isHhmm = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Minutes since local midnight of `hhmm`. */
export const hhmmMinutes = (hhmm: string): number => {
  const [h, m] = parseHhmm(hhmm);
  return h * 60 + m;
};

export function addDays(s: DateStr, n: number): DateStr {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** Whole days from a to b (b - a); DST-safe. */
export function diffDays(a: DateStr, b: DateStr): number {
  const [da, db] = [parseDateStr(a), parseDateStr(b)];
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86_400_000);
}

/** @param month0 0 = January */
export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** Every date from `from` to `to` inclusive (empty when to < from). */
export function eachDate(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const n = diffDays(from, to);
  if (n < 0) return out;
  const d = parseDateStr(from);
  for (let i = 0; i <= n; i++) {
    out.push(toDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** 0 = Sunday ... 6 = Saturday */
export const dayOfWeek = (s: DateStr): number => parseDateStr(s).getDay();

export const startOfMonth = (s: DateStr): DateStr => `${s.slice(0, 8)}01`;

export function endOfMonth(s: DateStr): DateStr {
  const d = parseDateStr(s);
  return `${s.slice(0, 8)}${pad(daysInMonth(d.getFullYear(), d.getMonth()))}`;
}

export const minDate = (a: DateStr, b: DateStr): DateStr => (a <= b ? a : b);
export const maxDate = (a: DateStr, b: DateStr): DateStr => (a >= b ? a : b);

/** Minutes of local time of day of a moment (0..1439). */
export function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}
