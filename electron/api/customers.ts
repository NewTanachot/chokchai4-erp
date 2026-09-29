import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  customerHistoryQuerySchema,
  customerInputSchema,
  customerListQuerySchema,
  customerUpdateSchema,
  idSchema,
  type Customer,
  type CustomerDetail,
  type CustomersApi,
  type CustomerVehicle,
  type CustomerWithStats,
  type Handlers,
} from "@shared/contract";
import { diffFields, initialFields, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import { notFound } from "./errors";
import { actorOf } from "./session";
import { loadTransactionDetails } from "./transaction-read";
import { digitsOnly, likePattern, newId, now } from "./util";
import { customers, transactions } from "../db/schema";
import type { DbLike } from "../db/client";

type CustomerRow = typeof customers.$inferSelect;

const AUDIT_FIELDS = ["name", "phone", "lineId", "email", "shopName", "taxId", "address", "note"] as const;

/*
 * Stats cover completed SALES only (purchases and void bills are ignored).
 * Correlated subqueries use explicit table-qualified raw SQL: Drizzle renders unqualified column
 * names in single-table selects, which would silently bind to the inner `transactions t`.
 */
const SALE_OF_CUSTOMER = sql.raw(`t.customer_id = customers.id AND t.type = 'sale' AND t.status = 'completed'`);

/** SQL expression normalising a plate for comparison: no spaces / dashes, upper-case latin letters. */
const plateKey = (col: string) => `upper(replace(replace(${col}, ' ', ''), '-', ''))`;

/** SQL expression keeping only the digits of a phone column (common separators removed). */
const phoneDigitsExpr = (col: string) =>
  ["-", " ", "(", ")", ".", "+", "/"].reduce((acc, ch) => `replace(${acc}, '${ch}', '')`, col);

const statsColumns = {
  saleCount: sql<number>`(SELECT count(*) FROM transactions t WHERE ${SALE_OF_CUSTOMER})`,
  totalSpent: sql<number>`(SELECT COALESCE(SUM(t.total), 0) FROM transactions t WHERE ${SALE_OF_CUSTOMER})`,
  unpaidTotal: sql<number>`(SELECT COALESCE(SUM(t.total), 0) FROM transactions t WHERE ${SALE_OF_CUSTOMER} AND t.payment_status = 'unpaid')`,
  firstVisitAt: sql<number | null>`(SELECT MIN(t.occurred_at) FROM transactions t WHERE ${SALE_OF_CUSTOMER})`,
  lastVisitAt: sql<number | null>`(SELECT MAX(t.occurred_at) FROM transactions t WHERE ${SALE_OF_CUSTOMER})`,
  // Distinct plates (spacing/dash variants merged; the most recent spelling wins), most recent first.
  plates: sql<string | null>`(SELECT group_concat(p, char(31)) FROM (SELECT t.vehicle_plate p, MAX(t.occurred_at) m FROM transactions t WHERE ${SALE_OF_CUSTOMER} AND t.vehicle_plate IS NOT NULL AND t.vehicle_plate <> '' GROUP BY ${sql.raw(plateKey("t.vehicle_plate"))} ORDER BY m DESC))`,
};

const baseColumns = {
  id: customers.id,
  name: customers.name,
  phone: customers.phone,
  lineId: customers.lineId,
  email: customers.email,
  shopName: customers.shopName,
  taxId: customers.taxId,
  address: customers.address,
  note: customers.note,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};

const listColumns = { ...baseColumns, ...statsColumns };

type StatsRow = Omit<CustomerRow, "deletedAt"> & {
  saleCount: number;
  totalSpent: number;
  unpaidTotal: number;
  firstVisitAt: number | null;
  lastVisitAt: number | null;
  plates: string | null;
};

function toCustomer(r: Omit<CustomerRow, "deletedAt">): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    lineId: r.lineId,
    email: r.email,
    shopName: r.shopName,
    taxId: r.taxId,
    address: r.address,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toCustomerWithStats(r: StatsRow): CustomerWithStats {
  return {
    ...toCustomer(r),
    saleCount: r.saleCount,
    totalSpent: r.totalSpent,
    unpaidTotal: r.unpaidTotal,
    firstVisitAt: r.firstVisitAt,
    lastVisitAt: r.lastVisitAt,
    vehiclePlates: r.plates ? r.plates.split("\u001f") : [],
  };
}

/** Non-deleted customer row, or undefined. */
export function findCustomer(db: DbLike, id: string): Customer | undefined {
  const r = db
    .select(baseColumns)
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .get();
  return r ? toCustomer(r) : undefined;
}

/** One search term -> OR over every searchable field. */
function termCondition(term: string): SQL {
  const p = likePattern(term);
  const ors: SQL[] = [
    sql`${customers.name} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.phone} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.lineId} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.email} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.shopName} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.taxId} LIKE ${p} ESCAPE '\\'`,
  ];
  // Phone: compare digits only, so "0812345678" finds "081-234-5678" (and vice versa).
  const digits = digitsOnly(term);
  if (/^[\d\-().+/]+$/.test(term) && digits.length >= 3) {
    const variants = new Set([digits]);
    // +66 81 234 5678 -> 0812345678
    if (digits.startsWith("66") && digits.length >= 10) variants.add("0" + digits.slice(2));
    for (const d of variants) ors.push(sql`${sql.raw(phoneDigitsExpr("customers.phone"))} LIKE ${"%" + d + "%"}`);
  }
  // Vehicle plates on their (non-void) bills; spaces and dashes ignored ("กข1234" finds "กข 1234").
  const plate = term.replace(/[\s-]/g, "").toUpperCase();
  if (plate) {
    ors.push(
      sql`EXISTS (SELECT 1 FROM transactions t WHERE t.customer_id = customers.id AND t.status = 'completed' AND ${sql.raw(plateKey("t.vehicle_plate"))} LIKE ${likePattern(plate)} ESCAPE '\\')`,
    );
  }
  return sql`(${sql.join(ors, sql` OR `)})`;
}

/** Thai dictionary-ish order: leading vowels (เ แ โ ใ ไ) are skipped when sorting, latin is case-insensitive. */
const nameSortKey = sql.raw(
  `lower(CASE WHEN substr(customers.name, 1, 1) IN ('เ', 'แ', 'โ', 'ใ', 'ไ') THEN substr(customers.name, 2) || substr(customers.name, 1, 1) ELSE customers.name END)`,
);

function loadVehicles(db: DbLike, customerId: string): CustomerVehicle[] {
  const rows = db
    .select({
      plate: transactions.vehiclePlate,
      model: transactions.vehicleModel,
      mileage: transactions.mileage,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.customerId, customerId),
        eq(transactions.type, "sale"),
        eq(transactions.status, "completed"),
        sql`${transactions.vehiclePlate} IS NOT NULL AND ${transactions.vehiclePlate} <> ''`,
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .all();
  const byKey = new Map<string, CustomerVehicle>();
  for (const r of rows) {
    const key = (r.plate ?? "").replace(/[\s-]/g, "").toUpperCase();
    const v = byKey.get(key);
    if (!v) {
      byKey.set(key, { plate: r.plate!, model: r.model || null, lastMileage: r.mileage ?? null, lastSeenAt: r.occurredAt, visitCount: 1 });
    } else {
      v.visitCount++;
      if (!v.model && r.model) v.model = r.model;
      if (v.lastMileage == null && r.mileage != null) v.lastMileage = r.mileage;
    }
  }
  return [...byKey.values()];
}

export function createCustomersApi(ctx: ApiContext): Handlers<CustomersApi> {
  const { db } = ctx;

  return {
    list: (input) => {
      const q = customerListQuerySchema.parse(input ?? {});
      const conds: SQL[] = [isNull(customers.deletedAt)];
      for (const term of (q.search ?? "").split(/\s+/).filter(Boolean)) conds.push(termCondition(term));
      const where = and(...conds);
      const order: SQL[] =
        q.sort === "name"
          ? [sql`${nameSortKey} ASC`, sql`${customers.id} ASC`]
          : q.sort === "spent"
            ? [sql`${statsColumns.totalSpent} DESC`, sql`${nameSortKey} ASC`, sql`${customers.id} ASC`]
            : [sql`COALESCE(${statsColumns.lastVisitAt}, ${customers.createdAt}) DESC`, sql`${customers.id} DESC`];
      const rows = db
        .select(listColumns)
        .from(customers)
        .where(where)
        .orderBy(...order)
        .limit(q.limit)
        .offset(q.offset)
        .all();
      const total = db.select({ n: count() }).from(customers).where(where).get()?.n ?? 0;
      return { items: rows.map(toCustomerWithStats), total };
    },

    get: (input): CustomerDetail => {
      const id = idSchema.parse(input);
      const r = db
        .select({
          ...listColumns,
          unpaidCount: sql<number>`(SELECT count(*) FROM transactions t WHERE ${SALE_OF_CUSTOMER} AND t.payment_status = 'unpaid')`,
        })
        .from(customers)
        .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
        .get();
      if (!r) throw notFound("ลูกค้า");
      return { ...toCustomerWithStats(r), unpaidCount: r.unpaidCount, vehicles: loadVehicles(db, id) };
    },

    create: (input) => {
      const v = customerInputSchema.parse(input);
      const ts = now();
      const row = { id: newId(), ...v, createdAt: ts, updatedAt: ts };
      db.transaction((tx) => {
        tx.insert(customers).values(row).run();
        writeAudit(tx, actorOf(tx, ctx.session), {
          entityType: "customer",
          entityId: row.id,
          entityLabel: v.name,
          action: "create",
          changes: initialFields(v, AUDIT_FIELDS),
          at: ts,
        });
      });
      return toCustomer(row);
    },

    update: (input) => {
      const { id, ...v } = customerUpdateSchema.parse(input);
      return db.transaction((tx) => {
        const before = findCustomer(tx, id);
        if (!before) throw notFound("ลูกค้า");
        tx.update(customers).set({ ...v, updatedAt: now() }).where(eq(customers.id, id)).run();
        const changes = diffFields(before, v, AUDIT_FIELDS);
        if (changes.length) writeAudit(tx, actorOf(tx, ctx.session), { entityType: "customer", entityId: id, entityLabel: v.name, action: "update", changes });
        return findCustomer(tx, id)!;
      });
    },

    remove: (input) => {
      const id = idSchema.parse(input);
      db.transaction((tx) => {
        const c = findCustomer(tx, id);
        if (!c) throw notFound("ลูกค้า");
        const ts = now();
        // Bills keep the customer link (the read model still resolves soft-deleted customers), and make sure
        // their contact snapshot is filled so they read correctly even without it.
        tx.update(transactions)
          .set({
            contactName: sql`COALESCE(NULLIF(${transactions.contactName}, ''), ${c.name})`,
            contactPhone: sql`COALESCE(NULLIF(${transactions.contactPhone}, ''), ${c.phone})`,
            updatedAt: ts,
          })
          .where(
            and(
              eq(transactions.customerId, id),
              sql`(${transactions.contactName} IS NULL OR ${transactions.contactName} = '' OR ((${transactions.contactPhone} IS NULL OR ${transactions.contactPhone} = '') AND ${c.phone} IS NOT NULL))`,
            ),
          )
          .run();
        tx.update(customers).set({ deletedAt: ts, updatedAt: ts }).where(eq(customers.id, id)).run();
        writeAudit(tx, actorOf(tx, ctx.session), { entityType: "customer", entityId: id, entityLabel: c.name, action: "delete", at: ts });
      });
    },

    history: (input) => {
      const q = customerHistoryQuerySchema.parse(input);
      if (!findCustomer(db, q.customerId)) throw notFound("ลูกค้า");
      const conds: SQL[] = [eq(transactions.customerId, q.customerId)];
      if (!q.includeVoid) conds.push(eq(transactions.status, "completed"));
      const where = and(...conds);
      const ids = db
        .select({ id: transactions.id })
        .from(transactions)
        .where(where)
        .orderBy(desc(transactions.occurredAt), desc(transactions.id))
        .limit(q.limit)
        .offset(q.offset)
        .all()
        .map((r) => r.id);
      const total = db.select({ n: count() }).from(transactions).where(where).get()?.n ?? 0;
      return { items: loadTransactionDetails(db, ids), total };
    },
  };
}
