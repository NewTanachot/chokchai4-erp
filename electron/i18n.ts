/**
 * The main process's language (menus, dialogs, error boxes). The renderer asks for it synchronously at startup
 * (preload, IPC_LANGUAGE_CHANNEL) and changes it with system.setLanguage, which saves it (meta "language").
 */
import { translate, type Lang } from "@shared/i18n";

let current: Lang = "th";
const listeners = new Set<(lang: Lang) => void>();

export const mainLanguage = (): Lang => current;

export function setMainLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const f of listeners) f(lang);
}

export function onLanguageChange(f: (lang: Lang) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** `text` (Thai, possibly with "{0}" parameters) in the current language. */
export const tr = (text: string, ...params: unknown[]): string => translate(current, text, params);
