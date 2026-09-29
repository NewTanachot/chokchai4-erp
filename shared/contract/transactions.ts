/** Sales (รายการขาย) and purchases (รายการซื้อ). */
import { z } from "zod";
import type { VatMode } from "../calc";
import { idSchema, moneySchema, optText, pageSchema, qtySchema, type ID, type Millis, type Paged } from "./common";

export type TransactionType = "sale" | "purchase";
export type TransactionStatus = "completed" | "void";
export type PaymentMethod = "cash" | "transfer" | "card" | "credit" | "other";
export type PaymentStatus = "paid" | "unpaid";
export type LineItemType = "product" | "service" | "custom";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "โอนเงิน",
  card: "บัตร",
  credit: "เครดิต",
  other: "อื่น ๆ",
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  sale: "ขาย",
  purchase: "ซื้อ",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "ชำระแล้ว",
  unpaid: "ค้างชำระ",
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  completed: "สำเร็จ",
  void: "ยกเลิก",
};

export interface TransactionItem {
  id: ID;
  lineNo: number;
  itemType: LineItemType;
  productId: ID | null;
  serviceItemId: ID | null;
  name: string;
  unit: string | null;
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
  /**
   * Sale: product cost snapshot at the time of sale (0 for services / custom lines).
   * Purchase: net cost per unit after the LINE discount and without VAT = round(total / qty), with the VAT taken
   * out on a VAT-inclusive bill (shared/calc.ts purchaseUnitCost); the bill-level discount is not allocated.
   */
  unitCost: number;
  note: string | null;
}

/** Row for lists. */
export interface TransactionSummary {
  id: ID;
  type: TransactionType;
  docNo: string;
  status: TransactionStatus;
  occurredAt: Millis;
  customerId: ID | null;
  /** Customer name if linked, else contactName. */
  displayName: string | null;
  vehiclePlate: string | null;
  itemCount: number;
  /** Short "ยาง x4, ถ่วงล้อ, ..." description built from item names. */
  itemsPreview: string;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** Name of the user who created the bill (null: before the user system). */
  createdByName: string | null;
}

/** A user reference as it appears on records (the name is the user's current name, also for deleted users). */
export interface UserRef {
  id: ID;
  name: string;
}

export interface TransactionDetail {
  id: ID;
  type: TransactionType;
  docNo: string;
  status: TransactionStatus;
  occurredAt: Millis;
  customerId: ID | null;
  customer: {
    id: ID;
    name: string;
    phone: string | null;
    shopName: string | null;
    taxId: string | null;
    address: string | null;
    lineId: string | null;
    email: string | null;
  } | null;
  contactName: string | null;
  contactPhone: string | null;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  mileage: number | null;
  items: TransactionItem[];
  subtotal: number;
  discount: number;
  vatMode: VatMode;
  vatRate: number;
  vatAmount: number;
  total: number;
  /** Sale only: Σ qty × unitCost of lines (each rounded half up, shared/calc.ts mulQty). 0 for purchases. */
  costTotal: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /**
   * When the money was received / paid; null while unpaid. A bill entered as paid = its occurredAt, a bill marked
   * paid later = the time it was marked. Cash-flow figures (money received today) use this.
   */
  paidAt: Millis | null;
  note: string | null;
  voidedAt: Millis | null;
  voidReason: string | null;
  /** Who created the bill / changed it last / voided it (null: before the user system). */
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
  voidedBy: UserRef | null;
  createdAt: Millis;
  updatedAt: Millis;
}

export const lineItemInputSchema = z
  .object({
    itemType: z.enum(["product", "service", "custom"]),
    productId: z.string().nullish().transform((v) => v || null),
    serviceItemId: z.string().nullish().transform((v) => v || null),
    /** Name printed on the bill. Defaults to the catalog name when blank. */
    name: z.string().trim().max(300).default(""),
    unit: optText,
    qty: qtySchema.refine((n) => n > 0, "จำนวนต้องมากกว่า 0"),
    /** Price per unit in satang, may differ from the catalog price. */
    unitPrice: moneySchema,
    discount: moneySchema.default(0),
    note: optText,
  })
  .superRefine((v, ctx) => {
    if (v.itemType === "product" && !v.productId) ctx.addIssue({ code: "custom", message: "กรุณาเลือกสินค้า" });
    if (v.itemType === "service" && !v.serviceItemId) ctx.addIssue({ code: "custom", message: "กรุณาเลือกบริการ" });
    if (v.itemType === "custom" && !v.name) ctx.addIssue({ code: "custom", message: "กรุณากรอกชื่อรายการ" });
  });
export type LineItemInput = z.input<typeof lineItemInputSchema>;

export const transactionInputSchema = z.object({
  type: z.enum(["sale", "purchase"]),
  occurredAt: z.number().int(),
  customerId: z.string().nullish().transform((v) => v || null),
  contactName: optText,
  contactPhone: optText,
  vehiclePlate: optText,
  vehicleModel: optText,
  mileage: z.number().int().min(0).nullish().transform((v) => v ?? null),
  items: z.array(lineItemInputSchema).min(1, "ต้องมีอย่างน้อย 1 รายการ").max(500),
  /** Bill-level discount (satang). */
  discount: moneySchema.default(0),
  vatMode: z.enum(["none", "inclusive", "exclusive"]).default("none"),
  /** Percent; ignored when vatMode is "none". Defaults to settings.tax.vatRate. */
  vatRate: z.number().min(0).max(100).optional(),
  paymentMethod: z.enum(["cash", "transfer", "card", "credit", "other"]).default("cash"),
  paymentStatus: z.enum(["paid", "unpaid"]).default("paid"),
  note: optText,
});
export type TransactionInput = z.input<typeof transactionInputSchema>;

/** Full replacement of an existing transaction (type cannot change). */
export const transactionUpdateSchema = transactionInputSchema.extend({ id: idSchema });
export type TransactionUpdate = z.input<typeof transactionUpdateSchema>;

export const transactionVoidSchema = z.object({ id: idSchema, reason: optText });
export type TransactionVoid = z.input<typeof transactionVoidSchema>;

/** Receive / pay an unpaid bill (รับชำระ / จ่ายแล้ว) without editing it. */
export const transactionMarkPaidSchema = z.object({
  id: idSchema,
  paymentMethod: z.enum(["cash", "transfer", "card", "other"]),
});
export type TransactionMarkPaid = z.input<typeof transactionMarkPaidSchema>;

const transactionTypeSchema = z.enum(["sale", "purchase"]);

/**
 * Input of nextDocNo: `{ type, occurredAt }` (the bill date decides the period, like on save; null or
 * missing = now), or just the type for "a bill dated now".
 */
export const nextDocNoInputSchema = z.union([
  transactionTypeSchema.transform((type) => ({ type, occurredAt: null })),
  z.object({
    type: transactionTypeSchema,
    occurredAt: z
      .number()
      .int()
      .nullish()
      .transform((v) => v ?? null),
  }),
]);
export type NextDocNoInput = z.input<typeof nextDocNoInputSchema>;

export const transactionListQuerySchema = z.object({
  type: z.enum(["sale", "purchase"]).optional(),
  status: z.enum(["completed", "void"]).optional(),
  paymentStatus: z.enum(["paid", "unpaid"]).optional(),
  customerId: z.string().optional(),
  /** occurredAt >= from */
  from: z.number().int().optional(),
  /** occurredAt < to */
  to: z.number().int().optional(),
  /** Matches docNo, customer name/phone, contactName, vehiclePlate, item names. */
  search: z.string().trim().optional(),
  /** Bills created by this user id. */
  createdBy: z.string().optional(),
  ...pageSchema,
});
export type TransactionListQuery = z.input<typeof transactionListQuerySchema>;

/** Aggregates over ALL rows matching a list query (not just the page). Void bills are excluded. */
export interface TransactionListSums {
  saleCount: number;
  saleTotal: number;
  purchaseCount: number;
  purchaseTotal: number;
  /** Sum of unpaid totals (sales + purchases) among the matching rows. */
  unpaidTotal: number;
  /** Unpaid sales (ค้างรับ) among the matching rows. */
  saleUnpaidTotal: number;
  /** Unpaid purchases (ค้างจ่าย) among the matching rows. */
  purchaseUnpaidTotal: number;
  /** Void bills among the matching rows (0 when the query filters status = "completed"). */
  voidCount: number;
}

export interface TransactionListResult extends Paged<TransactionSummary> {
  sums: TransactionListSums;
}

export interface TransactionsApi {
  list(query: TransactionListQuery): Promise<TransactionListResult>;
  get(id: ID): Promise<TransactionDetail>;
  /** Creates the bill, assigns docNo, writes stock movements, updates product cost (purchase). */
  create(input: TransactionInput): Promise<TransactionDetail>;
  /** Replaces header + items; reverses old stock movements and applies new ones atomically. */
  update(input: TransactionUpdate): Promise<TransactionDetail>;
  /** Cancels the bill: status=void, stock movements removed. Kept for audit. */
  void(input: TransactionVoid): Promise<TransactionDetail>;
  /**
   * Marks an unpaid, completed bill as paid now with the given method (paidAt = now). Items, stock and cost are
   * not touched. CONFLICT when the bill is void or already paid.
   */
  markPaid(input: TransactionMarkPaid): Promise<TransactionDetail>;
  /** Preview of the next document number for a type and bill date (not reserved). */
  nextDocNo(input: NextDocNoInput): Promise<string>;
}
