import { LOCALE, tr } from "@/lib/i18n";
/** Small pure helpers for the customer screens (no React). */

/** Keep only digits, for phone comparison (same rule as the main process). */
export const phoneDigits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");

/** True when `candidate` holds the same phone number as `digits` (a field may hold several numbers). */
export function samePhone(candidate: string | null | undefined, digits: string): boolean {
  if (!candidate || !digits) return false;
  if (phoneDigits(candidate) === digits) return true;
  return candidate.split(/[,/;]|และ/).some((part) => phoneDigits(part) === digits);
}

/** Looks like a phone number (only digits and separators, at least 3 digits). */
export const isPhoneLike = (s: string): boolean => /^[\d\s\-().+]+$/.test(s.trim()) && phoneDigits(s).length >= 3;

const LEADING_VOWELS = /^[เแโใไ]/;
const HONORIFICS = /^(คุณ|นางสาว|นาย|นาง|น\.ส\.|ร้าน|บริษัท|บจก\.?|หจก\.?)\s*/;

/** Avatar letter: first consonant of the name, skipping honorifics and Thai leading vowels. */
export function customerInitial(name: string): string {
  let s = name.trim();
  const stripped = s.replace(HONORIFICS, "");
  if (stripped) s = stripped;
  s = s.replace(/^[("'\s]+/, "");
  if (LEADING_VOWELS.test(s) && s.length > 1) s = s.slice(1);
  const ch = Array.from(s)[0] ?? "?";
  return ch.toLocaleUpperCase(LOCALE);
}

const AVATAR_TONES = [
  "bg-chart-1/15 text-chart-1",
  "bg-chart-2/15 text-chart-2",
  "bg-chart-3/15 text-chart-3",
  "bg-chart-4/20 text-chart-4",
  "bg-chart-5/15 text-chart-5",
] as const;

/** Deterministic colour for a customer avatar (theme tokens only). */
export function avatarTone(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

/** Copy text to the clipboard; falls back to execCommand when the async API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const customerViewHref = (id: string): string => `/customers/view/?id=${encodeURIComponent(id)}`;
export const transactionViewHref = (id: string): string => `/transactions/view/?id=${encodeURIComponent(id)}`;
export const newSaleHref = (customerId: string): string =>
  `/transactions/new/?type=sale&customerId=${encodeURIComponent(customerId)}`;

const DAY_MS = 86_400_000;

/** Like formatRelative, but keeps going past 30 days ("2 เดือนที่แล้ว", "1 ปีที่แล้ว"); "เมื่อวาน" for 1 day. */
export function relativeTime(ms: number, nowMs = Date.now()): string {
  const diff = nowMs - ms;
  if (diff < 60_000) return tr("เมื่อสักครู่");
  if (diff < 3_600_000) return tr("{0} นาทีที่แล้ว", Math.floor(diff / 60_000));
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  if (ms >= today.getTime()) return tr("{0} ชั่วโมงที่แล้ว", Math.floor(diff / 3_600_000));
  const days = Math.ceil((today.getTime() - ms) / DAY_MS);
  if (days <= 1) return tr("เมื่อวาน");
  if (days < 30) return tr("{0} วันที่แล้ว", days);
  if (days < 365) return tr("{0} เดือนที่แล้ว", Math.floor(days / 30));
  return tr("{0} ปีที่แล้ว", Math.floor(days / 365));
}

const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });
/** "กันยายน 2569" */
export const formatMonthYear = (ms: number): string => monthFmt.format(ms);

/** Stable month key for grouping (local time). */
export const monthKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}`;
};
