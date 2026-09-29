/** Products (สินค้า), categories (หมวดหมู่) and service items (บริการ). */
import { z } from "zod";
import type { PriceChange, PriceHistoryQuery } from "./audit";
import { idSchema, moneySchema, optText, pageSchema, qtySchema, reqText, type ID, type Millis, type Paged } from "./common";

// ---------- Categories ----------
export interface Category {
  id: ID;
  name: string;
  sortOrder: number;
  /** Number of non-deleted products in this category. */
  productCount: number;
  createdAt: Millis;
  updatedAt: Millis;
}

export const categoryInputSchema = z.object({
  name: reqText("ชื่อหมวดหมู่", 100),
  sortOrder: z.number().int().default(0),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;
export const categoryUpdateSchema = categoryInputSchema.extend({ id: idSchema });
/** When `sortOrder` is omitted on update the current order is kept; on create it is appended at the end. */
export type CategoryUpdate = z.input<typeof categoryUpdateSchema>;

/** All category ids in the desired display order (sortOrder = index). */
export const categoryReorderSchema = z.array(idSchema).min(1).max(1000);

export interface CategoriesApi {
  list(): Promise<Category[]>;
  create(input: CategoryInput): Promise<Category>;
  update(input: CategoryUpdate): Promise<Category>;
  /** Soft delete. Fails with CONFLICT if products still use it. */
  remove(id: ID): Promise<void>;
  /** Set display order: `ids[i]` gets sortOrder i. Ids not listed keep their order after the listed ones. */
  reorder(ids: ID[]): Promise<Category[]>;
}

// ---------- Products ----------
export interface Product {
  id: ID;
  sku: string | null;
  barcode: string | null;
  name: string;
  categoryId: ID | null;
  categoryName: string | null;
  brand: string | null;
  model: string | null;
  spec: string | null;
  unit: string;
  costPrice: number;
  sellPrice: number;
  stockQty: number;
  minStock: number;
  trackStock: boolean;
  isActive: boolean;
  note: string | null;
  createdAt: Millis;
  updatedAt: Millis;
}

export const productInputSchema = z.object({
  sku: optText,
  barcode: optText,
  name: reqText("ชื่อสินค้า", 200),
  categoryId: z.string().nullish().transform((v) => v || null),
  brand: optText,
  model: optText,
  spec: optText,
  unit: z.string().trim().min(1, "กรุณาระบุหน่วย").max(30, "หน่วยยาวเกินไป").default("ชิ้น"),
  costPrice: moneySchema.default(0),
  sellPrice: moneySchema.default(0),
  minStock: qtySchema.min(0, "จำนวนต้องไม่ติดลบ").default(0),
  trackStock: z.boolean().default(true),
  isActive: z.boolean().default(true),
  note: optText,
});
export type ProductInput = z.input<typeof productInputSchema>;

export const productCreateSchema = productInputSchema.extend({
  /** Opening stock; creates an "initial" stock movement when > 0. */
  initialStock: qtySchema.min(0, "จำนวนต้องไม่ติดลบ").default(0),
});
export type ProductCreate = z.input<typeof productCreateSchema>;

export const productUpdateSchema = productInputSchema.extend({ id: idSchema });
export type ProductUpdate = z.input<typeof productUpdateSchema>;

/** `categoryId` filter value that selects products without a category. */
export const NO_CATEGORY = "none";

export const productListQuerySchema = z.object({
  /**
   * Matches name, sku, barcode, brand, model, spec and category name. Every word must match. Tyre sizes
   * also match in compact form, e.g. "2055516" or "205/55/16" finds "205/55R16 91V".
   */
  search: z.string().trim().optional(),
  /** Category id, or NO_CATEGORY ("none") for products without a category. */
  categoryId: z.string().optional(),
  /** Only products with trackStock and stockQty <= minStock. */
  lowStockOnly: z.boolean().optional(),
  includeInactive: z.boolean().optional(),
  /** "stock" = lowest stock first (products that don't track stock last). */
  sort: z.enum(["name", "updated", "stock"]).default("name"),
  ...pageSchema,
});
export type ProductListQuery = z.input<typeof productListQuerySchema>;

export const stockAdjustSchema = z.object({
  productId: idSchema,
  /** Signed delta: +5 adds, -2 removes. Must not be 0. */
  qty: qtySchema.refine((n) => n !== 0, "จำนวนต้องไม่เป็น 0"),
  note: optText,
});
export type StockAdjust = z.input<typeof stockAdjustSchema>;

export type StockMovementType = "initial" | "purchase" | "sale" | "adjust";

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  initial: "ยอดยกมา",
  purchase: "ซื้อเข้า",
  sale: "ขายออก",
  adjust: "ปรับยอด",
};

export interface StockMovement {
  id: ID;
  productId: ID;
  type: StockMovementType;
  qty: number;
  unitCost: number | null;
  transactionId: ID | null;
  /** Doc no of the linked transaction, if any. */
  docNo: string | null;
  /** Customer (sale) or supplier (purchase) of the linked transaction, if any. */
  partyName: string | null;
  note: string | null;
  occurredAt: Millis;
  /** Running balance after this movement (computed). */
  balance: number;
  /** Who recorded it: the adjustment's user, or the linked bill's creator. */
  userName: string | null;
}

export const movementsQuerySchema = z.object({ productId: idSchema, ...pageSchema });
export type MovementsQuery = z.input<typeof movementsQuerySchema>;

/** Summary numbers for the products page. */
export interface ProductStats {
  /** Active (เปิดขาย), non-deleted products. */
  productCount: number;
  /** Non-deleted products that are switched off (ปิดขาย). */
  inactiveCount: number;
  /** Σ stockQty × costPrice (satang) over non-deleted, stock-tracked products with positive stock. */
  stockValue: number;
  /** Active, stock-tracked products with stockQty <= minStock (same rule as `lowStockOnly`). */
  lowStockCount: number;
  /** Product counts per category (categoryId null = no category). */
  byCategory: { categoryId: ID | null; activeCount: number; totalCount: number }[];
}

export interface ProductsApi {
  list(query: ProductListQuery): Promise<Paged<Product>>;
  get(id: ID): Promise<Product>;
  create(input: ProductCreate): Promise<Product>;
  update(input: ProductUpdate): Promise<Product>;
  /** Soft delete. Past transactions keep their name snapshot. */
  remove(id: ID): Promise<void>;
  /** Manual stock correction (นับสต็อก / ปรับยอด). */
  adjustStock(input: StockAdjust): Promise<Product>;
  /** Stock card, newest first, with running balance. */
  movements(query: MovementsQuery): Promise<Paged<StockMovement>>;
  /** Summary cards (จำนวนสินค้า, มูลค่าสต็อก, ใกล้หมด) and per-category counts. */
  stats(): Promise<ProductStats>;
  /** Cost / sell price changes, newest first (also for deleted products). */
  priceHistory(query: PriceHistoryQuery): Promise<Paged<PriceChange>>;
}

// ---------- Service items (บริการ) ----------
export interface ServiceItem {
  id: ID;
  code: string | null;
  name: string;
  defaultPrice: number;
  unit: string;
  isActive: boolean;
  note: string | null;
  createdAt: Millis;
  updatedAt: Millis;
}

export const serviceItemInputSchema = z.object({
  code: optText,
  name: reqText("ชื่อบริการ", 200),
  defaultPrice: moneySchema.default(0),
  unit: z.string().trim().min(1, "กรุณาระบุหน่วย").max(30, "หน่วยยาวเกินไป").default("ครั้ง"),
  isActive: z.boolean().default(true),
  note: optText,
});
export type ServiceItemInput = z.input<typeof serviceItemInputSchema>;
export const serviceItemUpdateSchema = serviceItemInputSchema.extend({ id: idSchema });
export type ServiceItemUpdate = z.input<typeof serviceItemUpdateSchema>;

export const serviceItemListQuerySchema = z.object({
  search: z.string().trim().optional(),
  includeInactive: z.boolean().optional(),
  ...pageSchema,
});
export type ServiceItemListQuery = z.input<typeof serviceItemListQuerySchema>;

export interface ServiceItemsApi {
  /** Matches name, code and note; every word must match. Sorted by name. */
  list(query: ServiceItemListQuery): Promise<Paged<ServiceItem>>;
  get(id: ID): Promise<ServiceItem>;
  /** `code` is unique among non-deleted services (CONFLICT). */
  create(input: ServiceItemInput): Promise<ServiceItem>;
  update(input: ServiceItemUpdate): Promise<ServiceItem>;
  /** Soft delete. Past transactions keep their name snapshot. */
  remove(id: ID): Promise<void>;
  /** Default price changes, newest first (also for deleted services). */
  priceHistory(query: PriceHistoryQuery): Promise<Paged<PriceChange>>;
}
