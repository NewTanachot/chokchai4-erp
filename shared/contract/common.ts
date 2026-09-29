import { z } from "zod";
import { isDateStr } from "../dates";

export type ID = string;

/** Epoch milliseconds. */
export type Millis = number;

export interface Paged<T> {
  items: T[];
  total: number;
}

export const idSchema = z.string().min(1, "ต้องระบุรหัส");

/** Optional trimmed text: "" and whitespace become null. */
export const optText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null));

export const reqText = (label: string, max = 300) =>
  z.string().trim().min(1, `กรุณากรอก${label}`).max(max, `${label}ยาวเกินไป`);

/** Integer satang, >= 0. */
export const moneySchema = z.number().int("จำนวนเงินไม่ถูกต้อง").min(0, "จำนวนเงินต้องไม่ติดลบ");

/** Quantity with at most 2 decimals. */
export const qtySchema = z
  .number()
  .finite()
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "จำนวนทศนิยมได้ไม่เกิน 2 ตำแหน่ง");

/** Most rows one list request may ask for (bigger lists are fetched in several requests: src/lib/paging.ts). */
export const MAX_PAGE_LIMIT = 1000;

export const pageSchema = {
  limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).default(50),
  offset: z.number().int().min(0).default(0),
};

/** Date range: from inclusive, to exclusive (epoch ms, local-time boundaries computed by caller). */
export const rangeSchema = z.object({
  from: z.number().int(),
  to: z.number().int(),
});
export type DateRange = z.infer<typeof rangeSchema>;

/** A calendar date "YYYY-MM-DD" (local, no time of day; see shared/dates.ts). */
export const dateSchema = z.string().trim().refine(isDateStr, "วันที่ไม่ถูกต้อง");
/** Optional calendar date: "" and null become null. */
export const optDateSchema = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isDateStr(v), "วันที่ไม่ถูกต้อง");

/** Inclusive range of calendar dates. */
export const dateRangeSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((r) => r.from <= r.to, "วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด");
export type DateStrRange = z.input<typeof dateRangeSchema>;

/**
 * UNAUTHORIZED = not logged in (the renderer shows the login screen); FORBIDDEN = logged in without the permission.
 */
export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_IMPLEMENTED"
  | "INTERNAL";

export interface ApiError {
  code: ErrorCode;
  /** Thai, user-facing message. */
  message: string;
  details?: unknown;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * Turns a renderer-side contract (methods returning Promise) into the main-process
 * handler shape (methods may return plain values or promises).
 */
export type Handlers<NS> = {
  [M in keyof NS]: NS[M] extends (...args: infer A) => Promise<infer O> ? (...args: A) => O | Promise<O> : never;
};
