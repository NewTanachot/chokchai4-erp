/**
 * Thai / English. Thai is the source language: every user-facing string in the code is Thai and is also the key
 * of its English translation in ./en.json (gettext style). `translate("th", …)` returns the Thai text as is.
 *
 * Templates: "{0}", "{1}" are positional parameters; an English value may choose a plural with "{0|one|many}"
 * ("#" in a form is the number), e.g. "{0} {0|bill|bills}". Keys stay free of that syntax.
 *
 * Text that was built in Thai elsewhere (e.g. an error message from the main process: "กรุณากรอกชื่อสินค้า") is
 * matched against the keys that have parameters ("กรุณากรอก{0}"); the matched parameters are translated too when
 * they are keys themselves ("ชื่อสินค้า"). Only templates with enough fixed text take part, so a short one such as
 * "ลบ{0}" never rewrites stored text that merely starts with "ลบ".
 *
 * Context: the same Thai can need different English ("ยกเลิก" is "Cancel" on a button but "Voided" in the change
 * history). A key "<context>|<thai>" (see trc in src/lib/i18n.ts) wins over the plain key.
 */
import EN from "./en.json";

export type Lang = "th" | "en";

export const LANGUAGES: readonly { value: Lang; label: string; short: string }[] = [
  { value: "th", label: "ไทย", short: "TH" },
  { value: "en", label: "English", short: "EN" },
];

export const isLang = (v: unknown): v is Lang => v === "th" || v === "en";

/** Intl locale of a language (English uses day-month-year and the Gregorian calendar). */
export const intlLocaleOf = (lang: Lang): string => (lang === "en" ? "en-GB" : "th-TH");

const DICT: Record<string, string> = EN;

/** Thai letters (not the Baht sign ฿, which also sits in the Thai block). */
const THAI = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;

const PARAM_RE = /\{(\d+)(?:\|([^|{}]*)\|([^{}]*))?\}/g;

/** Fills "{0}" / "{0|one|many}" from `params`. */
export function fillTemplate(template: string, params: readonly unknown[]): string {
  return template.replace(PARAM_RE, (whole, index: string, one?: string, many?: string) => {
    const i = Number(index);
    if (i >= params.length) return whole;
    const value = params[i];
    if (one === undefined || many === undefined) return String(value ?? "");
    return (Number(value) === 1 ? one : many).replace(/#/g, String(value));
  });
}

interface ReverseTemplate {
  re: RegExp;
  /** Parameter index of each capture group, in order of appearance in the key. */
  order: number[];
  value: string;
}

let reverse: ReverseTemplate[] | null = null;

function reverseTemplates(): ReverseTemplate[] {
  if (reverse) return reverse;
  reverse = [];
  for (const [key, value] of Object.entries(DICT)) {
    if (!/\{\d+\}/.test(key) || key.includes("|")) continue;
    const fixed = key.replace(/\{\d+\}/g, "").match(new RegExp(THAI.source, "g"))?.length ?? 0;
    if (fixed < MIN_REVERSE_THAI) continue;
    const order: number[] = [];
    const pattern = key
      .split(/(\{\d+\})/)
      .map((part) => {
        const m = /^\{(\d+)\}$/.exec(part);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        order.push(Number(m[1]));
        return "(.+?)";
      })
      .join("");
    reverse.push({ re: new RegExp(`^${pattern}$`, "s"), order, value });
  }
  // Longer (more specific) keys first.
  reverse.sort((a, b) => b.re.source.length - a.re.source.length);
  return reverse;
}

/** English of text that was built from a Thai template elsewhere, or null. */
function translateBuilt(text: string): string | null {
  for (const tpl of reverseTemplates()) {
    const m = tpl.re.exec(text);
    if (!m) continue;
    const params: unknown[] = [];
    tpl.order.forEach((index, g) => {
      const raw = m[g + 1];
      params[index] = DICT[raw] ?? raw;
    });
    return fillTemplate(tpl.value, params);
  }
  return null;
}

/** Thai letters a template needs outside its parameters to be used for matching built text. */
const MIN_REVERSE_THAI = 7;

/** Keys asked for in English that have no translation yet (dev aid, see src/lib/i18n.ts). */
export const missingTranslations = new Set<string>();

/**
 * `text` (a Thai string, possibly a template) in `lang`, with `params` filled in. Unknown text stays Thai.
 * `context` picks a "<context>|<text>" translation when there is one.
 */
export function translate(lang: Lang, text: string, params: readonly unknown[] = [], context?: string): string {
  if (lang === "th" || !text) return params.length ? fillTemplate(text, params) : text;
  const hit = (context ? DICT[`${context}|${text}`] : undefined) ?? DICT[text];
  if (hit !== undefined) return params.length ? fillTemplate(hit, params) : hit;
  if (!params.length && THAI.test(text)) {
    const built = translateBuilt(text);
    if (built !== null) return built;
  }
  if (THAI.test(text)) missingTranslations.add(text);
  return params.length ? fillTemplate(text, params) : text;
}

/** True when `text` has an English translation (exact key). */
export const hasTranslation = (text: string): boolean => DICT[text] !== undefined;
