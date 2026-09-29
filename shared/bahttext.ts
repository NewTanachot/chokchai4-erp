/**
 * Thai amount in words for documents ("ตัวอักษร" line on invoices / receipts), like Excel's BAHTTEXT.
 *
 *   bahtText(0)         -> "ศูนย์บาทถ้วน"
 *   bahtText(2150)      -> "ยี่สิบเอ็ดบาทห้าสิบสตางค์"
 *   bahtText(100000000) -> "หนึ่งล้านบาทถ้วน"
 *
 * Rules: 1 in the tens place is "สิบ" (not "หนึ่งสิบ"), 2 in the tens place is "ยี่สิบ", 1 in the units place
 * is "เอ็ด" whenever the number has other digits in front of it (11 สิบเอ็ด, 101 หนึ่งร้อยเอ็ด,
 * 1,000,001 หนึ่งล้านเอ็ด), and the pattern repeats per group of six digits with "ล้าน".
 */
import type { Satang } from "./money";

const DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** Reads 0 < n < 1,000,000. `hasHigher`: digits exist in front of this group (so a lone 1 becomes "เอ็ด"). */
function readGroup(n: number, hasHigher: boolean): string {
  let out = "";
  const s = String(n);
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const d = s.charCodeAt(i) - 48;
    const place = len - 1 - i;
    if (d === 0) continue;
    if (place === 0) {
      out += d === 1 && (len > 1 || hasHigher) ? "เอ็ด" : DIGITS[d];
    } else if (place === 1) {
      out += (d === 1 ? "" : d === 2 ? "ยี่" : DIGITS[d]) + "สิบ";
    } else {
      out += DIGITS[d] + PLACES[place];
    }
  }
  return out;
}

/** Thai words for a non-negative integer (no unit). 0 -> "ศูนย์". */
export function thaiNumberText(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return DIGITS[0];
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1_000_000);
    n = Math.floor(n / 1_000_000);
  }
  let out = "";
  for (let g = groups.length - 1; g >= 0; g--) {
    const v = groups[g];
    if (v > 0) out += readGroup(v, g < groups.length - 1 && out !== "");
    if (g > 0) out += "ล้าน";
  }
  return out;
}

/** Amount in satang -> Thai words: "หนึ่งร้อยยี่สิบบาทห้าสิบสตางค์", "สองพันบาทถ้วน". Negative -> "ลบ...". */
export function bahtText(satang: Satang): string {
  if (!Number.isFinite(satang)) return "";
  const rounded = Math.round(satang);
  if (rounded < 0) return "ลบ" + bahtText(-rounded);
  const baht = Math.floor(rounded / 100);
  const st = rounded % 100;
  if (st === 0) return `${thaiNumberText(baht)}บาทถ้วน`;
  const stText = `${thaiNumberText(st)}สตางค์`;
  return baht === 0 ? stText : `${thaiNumberText(baht)}บาท${stText}`;
}

// ---------- English (documents printed in English) ----------

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", " thousand", " million", " billion", " trillion"];

function englishUnder1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ""));
  return parts.join(" ");
}

/** English words for a non-negative integer: 1234 -> "one thousand two hundred thirty-four". */
export function englishNumberText(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return ONES[0];
  const parts: string[] = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(englishUnder1000(chunk) + (SCALES[i] ?? ""));
  }
  return parts.join(" ");
}

/** Amount in satang -> "One hundred twenty baht and fifty satang", "Two thousand baht only". */
export function bahtTextEn(satang: Satang): string {
  if (!Number.isFinite(satang)) return "";
  const rounded = Math.round(satang);
  if (rounded < 0) return `Minus ${bahtTextEn(-rounded).toLowerCase()}`;
  const baht = Math.floor(rounded / 100);
  const st = rounded % 100;
  const text = st === 0 ? `${englishNumberText(baht)} baht only` : baht === 0 ? `${englishNumberText(st)} satang` : `${englishNumberText(baht)} baht and ${englishNumberText(st)} satang`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Amount in words in the document's language. */
export const amountInWords = (satang: Satang, lang: "th" | "en"): string => (lang === "en" ? bahtTextEn(satang) : bahtText(satang));
