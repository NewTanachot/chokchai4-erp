/**
 * The renderer's language (ภาษาไทย / English), fixed for the page's lifetime: changing it (setLanguage) saves it in
 * the main process and reloads the page. So `tr()` works anywhere, also in module-level constants.
 *
 *   tr("บันทึกแล้ว")                       -> "Saved" in English
 *   tr("ลบ “{0}” แล้ว", name)              -> parameters are positional
 *
 * Print routes (/print/…) use the `lang` URL parameter instead: documents follow the document-language setting.
 */
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_FIELDS,
  LEAVE_TYPE_LABELS,
  PAPER_LABELS,
  PAY_ITEM_LABELS,
  PAY_METHOD_LABELS,
  PAY_RATE_UNIT,
  PAY_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PERMISSION_GROUPS,
  PERMISSION_INFO,
  PRICE_SOURCE_LABELS,
  PRINT_KIND_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  USER_ROLE_LABELS,
} from "@shared/contract";
import { intlLocaleOf, isLang, missingTranslations, translate, type Lang } from "@shared/i18n";

function initialLanguage(): Lang {
  if (typeof window === "undefined") return "th";
  try {
    if (window.location.pathname.startsWith("/print/")) {
      const q = new URLSearchParams(window.location.search).get("lang");
      if (isLang(q)) return q;
    }
    // The print preview iframe borrows its parent's bridge.
    const bridge = window.erp ?? (window.parent !== window ? window.parent.erp : undefined);
    if (isLang(bridge?.language)) return bridge.language;
  } catch {
    /* no bridge / cross-origin parent */
  }
  return "th";
}

/** Language of this page. */
export const lang: Lang = initialLanguage();

/** Intl locale for dates and numbers ("th-TH" = Buddhist-era years, "en-GB"). */
export const LOCALE = intlLocaleOf(lang);

/** `text` (Thai, possibly with "{0}" parameters) in the page's language. */
export function tr(text: string, ...params: unknown[]): string {
  return translate(lang, text, params);
}

/** tr() with a context, for Thai whose English depends on where it is shown (key "<context>|<thai>"). */
export function trc(context: string, text: string, ...params: unknown[]): string {
  return translate(lang, text, params, context);
}

/** Saves the language (for this computer) and reloads the page in it. */
export async function setLanguage(next: Lang): Promise<void> {
  if (next === lang) return;
  const { api } = await import("./api");
  await api.system.setLanguage({ language: next });
  window.location.reload();
}

/**
 * Shared label tables (shared/contract) are Thai data used by both processes. In the renderer they are only
 * displayed, so their strings are translated in place once, before anything renders.
 */
function localizeDeep(value: unknown): unknown {
  if (typeof value === "string") return translate(lang, value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (typeof v === "string") value[i] = translate(lang, v);
      else localizeDeep(v);
    });
    return value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "string") obj[k] = translate(lang, obj[k] as string);
      else localizeDeep(obj[k]);
    }
  }
  return value;
}

if (lang !== "th") {
  for (const table of [
    AUDIT_ACTION_LABELS,
    AUDIT_ENTITY_LABELS,
    AUDIT_FIELDS,
    LEAVE_TYPE_LABELS,
    PAPER_LABELS,
    PAY_ITEM_LABELS,
    PAY_METHOD_LABELS,
    PAY_RATE_UNIT,
    PAY_TYPE_LABELS,
    PAYMENT_METHOD_LABELS,
    PAYMENT_STATUS_LABELS,
    PERMISSION_GROUPS,
    PERMISSION_INFO,
    PRICE_SOURCE_LABELS,
    PRINT_KIND_LABELS,
    STOCK_MOVEMENT_TYPE_LABELS,
    TRANSACTION_STATUS_LABELS,
    TRANSACTION_TYPE_LABELS,
    USER_ROLE_LABELS,
  ]) {
    localizeDeep(table);
  }
  // Labels whose English differs from the same Thai elsewhere.
  USER_ROLE_LABELS.owner = trc("role", "เจ้าของร้าน");
  USER_ROLE_LABELS.staff = trc("role", "พนักงาน");
  PAY_RATE_UNIT.monthly = trc("unit", "เดือน");
  PAY_RATE_UNIT.daily = trc("unit", "วัน");
  PERMISSION_INFO["transactions.void"].label = trc("perm", "ยกเลิกบิล");
  // Dev aid: English screens list the Thai text that still has no translation.
  if (typeof window !== "undefined") (window as unknown as { __i18nMissing: () => string[] }).__i18nMissing = () => [...missingTranslations];
}
