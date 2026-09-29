/** Customers (ลูกค้า). */
import { z } from "zod";
import { idSchema, optText, pageSchema, reqText, type ID, type Millis, type Paged } from "./common";
import type { TransactionDetail } from "./transactions";

export interface Customer {
  id: ID;
  name: string;
  phone: string | null;
  lineId: string | null;
  email: string | null;
  shopName: string | null;
  taxId: string | null;
  address: string | null;
  note: string | null;
  createdAt: Millis;
  updatedAt: Millis;
}

/** Customer plus aggregate stats over their completed (non-void) SALES - purchases and void bills are ignored. */
export interface CustomerWithStats extends Customer {
  saleCount: number;
  /** Sum of completed sale totals (satang). */
  totalSpent: number;
  /** Sum of unpaid completed sale totals (satang). */
  unpaidTotal: number;
  firstVisitAt: Millis | null;
  lastVisitAt: Millis | null;
  /** Distinct vehicle plates seen on this customer's completed sales, most recent first. */
  vehiclePlates: string[];
}

/** A vehicle seen on a customer's completed sales (grouped by plate). */
export interface CustomerVehicle {
  plate: string;
  /** Model from the most recent bill that had one. */
  model: string | null;
  /** Mileage (km) from the most recent bill that had one. */
  lastMileage: number | null;
  lastSeenAt: Millis;
  visitCount: number;
}

/** Returned by customers.get: stats plus detail-page extras. */
export interface CustomerDetail extends CustomerWithStats {
  /** Number of unpaid completed sales. */
  unpaidCount: number;
  /** Vehicles, most recently seen first. */
  vehicles: CustomerVehicle[];
}

export const customerInputSchema = z.object({
  name: reqText("ชื่อลูกค้า", 200),
  phone: optText,
  lineId: optText,
  email: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\S+@\S+\.\S+$/.test(v), "อีเมลไม่ถูกต้อง"),
  shopName: optText,
  taxId: optText,
  address: optText,
  note: optText,
});
export type CustomerInput = z.input<typeof customerInputSchema>;
export const customerUpdateSchema = customerInputSchema.extend({ id: idSchema });
export type CustomerUpdate = z.input<typeof customerUpdateSchema>;

export const customerListQuerySchema = z.object({
  /** Matches name, phone (digits only compare), lineId, email, shopName, and vehicle plates on their transactions. */
  search: z.string().trim().optional(),
  sort: z.enum(["name", "recent", "spent"]).default("recent"),
  ...pageSchema,
});
export type CustomerListQuery = z.input<typeof customerListQuerySchema>;

export const customerHistoryQuerySchema = z.object({
  customerId: idSchema,
  /** Include voided transactions (shown greyed-out). Default false. */
  includeVoid: z.boolean().optional(),
  ...pageSchema,
});
export type CustomerHistoryQuery = z.input<typeof customerHistoryQuerySchema>;

export interface CustomersApi {
  list(query: CustomerListQuery): Promise<Paged<CustomerWithStats>>;
  get(id: ID): Promise<CustomerDetail>;
  create(input: CustomerInput): Promise<Customer>;
  update(input: CustomerUpdate): Promise<Customer>;
  /** Soft delete. Past transactions keep their contactName snapshot. */
  remove(id: ID): Promise<void>;
  /** Transactions of a customer with line items, newest first (occurredAt desc). Completed only unless includeVoid. */
  history(query: CustomerHistoryQuery): Promise<Paged<TransactionDetail>>;
}
