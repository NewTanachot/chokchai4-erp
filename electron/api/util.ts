import { uuidv7 } from "uuidv7";

/** Time-sortable globally-unique id (UUIDv7). */
export const newId = (): string => uuidv7();

export const now = (): number => Date.now();

/**
 * Build a LIKE pattern for a user search string. Use with `ESCAPE '\\'`
 * e.g. sql`${t.name} LIKE ${likePattern(q)} ESCAPE '\\'`.
 */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}

/** Keep only digits, for phone-number matching. */
export const digitsOnly = (s: string): string => s.replace(/\D/g, "");
