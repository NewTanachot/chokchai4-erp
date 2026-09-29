import { MAX_PAGE_LIMIT } from "@shared/contract";

/**
 * The first `limit` rows of a paged list, fetched in requests of at most MAX_PAGE_LIMIT rows (the API's cap), so a
 * "แสดงเพิ่ม" button may grow `limit` past the cap. Other fields (total, sums, ...) come from the first request.
 * Rows that shift between requests (a bill saved meanwhile) are de-duplicated by id.
 */
export async function fetchFirst<R extends { items: unknown[]; total: number }>(
  limit: number,
  page: (limit: number, offset: number) => Promise<R>,
): Promise<R> {
  const first = await page(Math.min(limit, MAX_PAGE_LIMIT), 0);
  if (limit <= MAX_PAGE_LIMIT) return first;
  const items = [...first.items];
  const seen = new Set(items.map(idOf));
  let offset = items.length;
  while (items.length < limit && offset < first.total) {
    const next = await page(Math.min(MAX_PAGE_LIMIT, limit - items.length), offset);
    if (next.items.length === 0) break;
    offset += next.items.length;
    for (const row of next.items) {
      const id = idOf(row);
      if (id !== undefined && seen.has(id)) continue;
      seen.add(id);
      items.push(row);
    }
  }
  return { ...first, items };
}

function idOf(row: unknown): unknown {
  return row && typeof row === "object" && "id" in row ? (row as { id: unknown }).id : undefined;
}
