import { eq, sql } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { products, stockMovements } from "../db/schema";
import { roundQty } from "@shared/money";

/**
 * Recalculate products.stock_qty from the stock ledger. Call inside the same
 * DB transaction after inserting/deleting stock_movements for a product.
 */
export function recomputeStock(db: DbLike, productId: string, at = Date.now()): number {
  const row = db
    .select({ qty: sql<number>`COALESCE(SUM(${stockMovements.qty}), 0)` })
    .from(stockMovements)
    .where(eq(stockMovements.productId, productId))
    .get();
  const qty = roundQty(row?.qty ?? 0);
  db.update(products).set({ stockQty: qty, updatedAt: at }).where(eq(products.id, productId)).run();
  return qty;
}
