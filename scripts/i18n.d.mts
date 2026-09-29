/** Types of scripts/i18n.mjs (used by tests/i18n.test.ts). */
export interface I18nAnalysis {
  keys: Map<string, string[]>;
  missing: string[];
  unused: string[];
  placeholderMismatch: string[];
  untranslated: string[];
}
export function analyze(root: string): I18nAnalysis;
export function collectKeys(root: string): Map<string, string[]>;
export function loadDictionary(root: string): Record<string, string>;
