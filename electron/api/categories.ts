import { and, asc, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  categoryInputSchema,
  categoryReorderSchema,
  categoryUpdateSchema,
  idSchema,
  type CategoriesApi,
  type Category,
  type Handlers,
} from "@shared/contract";
import { diffFields, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { AppError, notFound } from "./errors";
import { actorOf } from "./session";
import { newId, now } from "./util";
import { categories, products } from "../db/schema";
import type { DbLike } from "../db/client";

function selectCategories(db: DbLike, where: SQL | undefined): Category[] {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
      createdAt: categories.createdAt,
      updatedAt: categories.updatedAt,
      // Correlated subquery: use explicit table-qualified names (Drizzle omits the table prefix in single-table selects).
      productCount: sql<number>`(SELECT count(*) FROM products p WHERE p.category_id = categories.id AND p.deleted_at IS NULL)`,
    })
    .from(categories)
    .where(where)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();
}

export function listCategories(db: DbLike): Category[] {
  return selectCategories(db, isNull(categories.deletedAt));
}

export function getCategory(db: DbLike, id: string): Category | undefined {
  return selectCategories(db, and(eq(categories.id, id), isNull(categories.deletedAt)))[0];
}

function assertNameFree(db: DbLike, name: string, exceptId?: string): void {
  const conds: SQL[] = [isNull(categories.deletedAt), sql`lower(trim(${categories.name})) = lower(${name})`];
  if (exceptId) conds.push(ne(categories.id, exceptId));
  if (db.select({ id: categories.id }).from(categories).where(and(...conds)).get()) {
    throw new AppError("CONFLICT", "มีหมวดหมู่ชื่อนี้อยู่แล้ว", { field: "name" });
  }
}

const hasSortOrder = (input: unknown): boolean =>
  typeof input === "object" && input !== null && typeof (input as { sortOrder?: unknown }).sortOrder === "number";

export function createCategoriesApi(ctx: ApiContext): Handlers<CategoriesApi> {
  const { db } = ctx;

  const mustGet = (id: string): Category => {
    const c = getCategory(db, id);
    if (!c) throw notFound("หมวดหมู่");
    return c;
  };

  return {
    list: () => listCategories(db),

    create: (input) => {
      const v = categoryInputSchema.parse(input);
      const id = newId();
      const at = now();
      db.transaction((tx) => {
        assertNameFree(tx, v.name);
        // No explicit order -> append at the end.
        const sortOrder = hasSortOrder(input)
          ? v.sortOrder
          : (tx
              .select({ max: sql<number | null>`max(${categories.sortOrder})` })
              .from(categories)
              .where(isNull(categories.deletedAt))
              .get()?.max ?? -1) + 1;
        tx.insert(categories).values({ id, name: v.name, sortOrder, createdAt: at, updatedAt: at }).run();
        writeAudit(tx, actorOf(tx, ctx.session), { entityType: "category", entityId: id, entityLabel: v.name, action: "create", at });
      });
      return mustGet(id);
    },

    update: (input) => {
      const v = categoryUpdateSchema.parse(input);
      db.transaction((tx) => {
        const before = getCategory(tx, v.id);
        if (!before) throw notFound("หมวดหมู่");
        assertNameFree(tx, v.name, v.id);
        tx.update(categories)
          .set({ name: v.name, ...(hasSortOrder(input) ? { sortOrder: v.sortOrder } : {}), updatedAt: now() })
          .where(eq(categories.id, v.id))
          .run();
        const changes = diffFields(before, { name: v.name }, ["name"]);
        if (changes.length) writeAudit(tx, actorOf(tx, ctx.session), { entityType: "category", entityId: v.id, entityLabel: v.name, action: "update", changes });
      });
      return mustGet(v.id);
    },

    remove: (input) => {
      const id = idSchema.parse(input);
      db.transaction((tx) => {
        const c = getCategory(tx, id);
        if (!c) throw notFound("หมวดหมู่");
        const n =
          tx
            .select({ n: sql<number>`count(*)` })
            .from(products)
            .where(and(eq(products.categoryId, id), isNull(products.deletedAt)))
            .get()?.n ?? 0;
        if (n > 0) throw new AppError("CONFLICT", `หมวดหมู่นี้ยังมีสินค้าอยู่ ${n} รายการ`, { productCount: n });
        const at = now();
        tx.update(categories).set({ deletedAt: at, updatedAt: at }).where(eq(categories.id, id)).run();
        writeAudit(tx, actorOf(tx, ctx.session), { entityType: "category", entityId: id, entityLabel: c.name, action: "delete", at });
      });
    },

    reorder: (input) => {
      const ids = categoryReorderSchema.parse(input);
      db.transaction((tx) => {
        const current = listCategories(tx);
        const known = new Set(current.map((c) => c.id));
        const ordered = [...new Set(ids)].filter((id) => known.has(id));
        const rest = current.filter((c) => !ordered.includes(c.id)).map((c) => c.id);
        const at = now();
        [...ordered, ...rest].forEach((id, i) => {
          tx.update(categories).set({ sortOrder: i, updatedAt: at }).where(eq(categories.id, id)).run();
        });
      });
      return listCategories(db);
    },
  };
}
