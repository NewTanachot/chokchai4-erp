import { ZodError } from "zod";
import type { ApiError, ErrorCode } from "@shared/contract";

/** Throw this from handlers; `message` is shown to the user (Thai). */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "ข้อมูล") => new AppError("NOT_FOUND", `ไม่พบ${what}`);
export const notImplemented = (method: string) => new AppError("NOT_IMPLEMENTED", `ยังไม่รองรับ: ${method}`);

export function toApiError(e: unknown): ApiError {
  if (e instanceof AppError) return { code: e.code, message: e.message, details: e.details };
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const path = first?.path?.length ? ` (${first.path.join(".")})` : "";
    return { code: "VALIDATION", message: (first?.message ?? "ข้อมูลไม่ถูกต้อง") + path, details: e.issues };
  }
  const err = e as { code?: string; message?: string };
  if (typeof err?.code === "string" && err.code.startsWith("SQLITE_CONSTRAINT")) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") return { code: "CONFLICT", message: "ข้อมูลซ้ำกับที่มีอยู่แล้ว", details: err.message };
    if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") return { code: "CONFLICT", message: "ข้อมูลนี้ถูกใช้งานอยู่ หรืออ้างอิงข้อมูลที่ไม่มีอยู่", details: err.message };
    return { code: "CONFLICT", message: "ข้อมูลไม่ถูกต้องตามเงื่อนไข", details: err.message };
  }
  return { code: "INTERNAL", message: "เกิดข้อผิดพลาด: " + (err?.message ?? String(e)) };
}
