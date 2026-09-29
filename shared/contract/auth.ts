/** Login (เข้าสู่ระบบ), program users (ผู้ใช้งาน) and what each user may do (สิทธิ์). */
import { z } from "zod";
import { idSchema, reqText, type ID, type Millis } from "./common";

export type UserRole = "owner" | "staff";

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  owner: "เจ้าของร้าน",
  staff: "พนักงาน",
};

/**
 * Permissions a STAFF user can be given. Owners always have all of them, plus the owner-only areas (users,
 * restoring a backup). Everyone who is logged in can sell, see bills, products, services and customers,
 * add customers, receive payment of sale bills and print.
 */
export const PERMISSIONS = [
  "purchases.create",
  "transactions.edit",
  "transactions.void",
  "customers.manage",
  "catalog.manage",
  "stock.adjust",
  "reports.view",
  "attendance.manage",
  "employees.manage",
  "audit.view",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_GROUPS: { label: string; items: Permission[] }[] = [
  { label: "บิลซื้อ-ขาย", items: ["purchases.create", "transactions.edit", "transactions.void"] },
  { label: "ข้อมูลร้าน", items: ["customers.manage", "catalog.manage", "stock.adjust"] },
  { label: "ตัวเลขและรายงาน", items: ["reports.view", "audit.view"] },
  { label: "พนักงาน", items: ["attendance.manage", "employees.manage"] },
  { label: "ระบบ", items: ["settings.manage"] },
];

export const PERMISSION_INFO: Record<Permission, { label: string; hint: string }> = {
  "purchases.create": { label: "บันทึกการซื้อ", hint: "เปิดบิลซื้อสินค้าเข้าร้าน และบันทึกจ่ายเงินบิลซื้อ" },
  "transactions.edit": { label: "แก้ไขบิล", hint: "แก้ไขรายการ ราคา ลูกค้า ในบิลที่บันทึกแล้ว" },
  "transactions.void": { label: "ยกเลิกบิล", hint: "ยกเลิกบิลขาย/ซื้อ (คืนสต็อก ไม่นับยอด)" },
  "customers.manage": { label: "แก้ไข/ลบลูกค้า", hint: "แก้ไขหรือลบข้อมูลลูกค้า (เพิ่มลูกค้าใหม่ทำได้ทุกคน)" },
  "catalog.manage": { label: "จัดการสินค้าและบริการ", hint: "เพิ่ม แก้ไข ลบ สินค้า บริการ หมวดหมู่ และเปลี่ยนราคา" },
  "stock.adjust": { label: "ปรับยอดสต็อก", hint: "แก้จำนวนสินค้าคงเหลือหลังนับสต็อก" },
  "reports.view": { label: "ดูยอดขายและรายงาน", hint: "แดชบอร์ด ยอดรวม กำไร รับเงินวันนี้ และหน้ารายงาน" },
  "audit.view": { label: "ดูประวัติการแก้ไข", hint: "ดูว่าใครแก้ไขอะไร เมื่อไหร่ และประวัติราคา" },
  "attendance.manage": { label: "จัดการเวลาทำงาน", hint: "ดูตารางเวลาทุกคน แก้ไขเวลาเข้า-ออก และบันทึกวันลา" },
  "employees.manage": { label: "ข้อมูลพนักงานและเงินเดือน", hint: "ดู/แก้ไขข้อมูลพนักงาน เงินเดือน เบิกเงิน และจ่ายเงินเดือน" },
  "settings.manage": { label: "ตั้งค่าร้าน", hint: "ข้อมูลร้าน ภาษี เอกสาร การพิมพ์ สต็อก และสำรองข้อมูล" },
};

/** Ticked for a new staff user (the owner can change them). */
export const DEFAULT_STAFF_PERMISSIONS: Permission[] = ["purchases.create", "transactions.edit", "customers.manage"];

/** The logged-in user as the renderer sees it. `permissions` is effective (an owner has all of them). */
export interface SessionUser {
  id: ID;
  name: string;
  role: UserRole;
  permissions: Permission[];
  employeeId: ID | null;
  /** false = logs in by tapping the name (no password / PIN). */
  hasPassword: boolean;
}

/** A name tile on the login screen. */
export interface LoginTile {
  id: ID;
  name: string;
  role: UserRole;
  /** false = tapping the tile logs in straight away. */
  hasPassword: boolean;
}

export interface AuthStatus {
  /** No user exists yet: the first start must create the owner account (auth.setupOwner). */
  needsSetup: boolean;
  /** Logged-in user, or null. */
  user: SessionUser | null;
  /** Active users for the login screen, owners first. */
  users: LoginTile[];
  /** For the login screen header. */
  shopName: string;
}

/** Password or PIN: at least 4 characters. */
export const passwordSchema = z
  .string()
  .min(4, "รหัสผ่านต้องมีอย่างน้อย 4 ตัว")
  .max(100, "รหัสผ่านยาวเกินไป")
  .refine((v) => v.trim() === v, "รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง");

export const userNameSchema = reqText("ชื่อผู้ใช้", 60);

/** null = no password: the user logs in by tapping the name on the login screen. */
const optionalPasswordSchema = passwordSchema.nullable();

export const setupOwnerSchema = z.object({ name: userNameSchema, password: optionalPasswordSchema });
export type SetupOwnerInput = z.input<typeof setupOwnerSchema>;

/** `password` is ignored for users without one. */
export const loginSchema = z.object({ userId: idSchema, password: z.string().max(200).default("") });
export type LoginInput = z.input<typeof loginSchema>;

/** `currentPassword` is not needed when the user has no password yet. */
export const changePasswordSchema = z.object({ currentPassword: z.string().max(200).default(""), newPassword: passwordSchema });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const recoverSchema = z.object({
  userId: idSchema,
  recoveryCode: z.string().trim().min(1, "กรุณากรอกรหัสกู้คืน").max(100),
  newPassword: passwordSchema,
});
export type RecoverInput = z.input<typeof recoverSchema>;

export interface AuthApi {
  /** Public. What the login gate needs. */
  status(): Promise<AuthStatus>;
  /**
   * Public, only while no user exists: creates the owner and logs in. Returns the recovery code (shown once), or
   * null for an owner without a password.
   */
  setupOwner(input: SetupOwnerInput): Promise<{ user: SessionUser; recoveryCode: string | null }>;
  /** Public. Wrong passwords are throttled (a few tries, then a short wait). No password needed for users without one. */
  login(input: LoginInput): Promise<SessionUser>;
  logout(): Promise<void>;
  /** Sets or changes your own password (removing it is up to the owner, users.resetPassword). */
  changePassword(input: ChangePasswordInput): Promise<void>;
  /**
   * Public. An owner who forgot the password sets a new one with the recovery code. Logs in and returns a NEW
   * recovery code (the used one stops working).
   */
  recover(input: RecoverInput): Promise<{ user: SessionUser; recoveryCode: string }>;
  /** Owner: replaces the recovery code and returns the new one (shown once). */
  newRecoveryCode(): Promise<{ recoveryCode: string }>;
}

// ---------- Users (owner only) ----------
export interface User {
  id: ID;
  name: string;
  role: UserRole;
  /** Stored permissions (for owners: all). */
  permissions: Permission[];
  employeeId: ID | null;
  /** Linked employee's display name. */
  employeeName: string | null;
  isActive: boolean;
  /** false = logs in by tapping the name. */
  hasPassword: boolean;
  lastLoginAt: Millis | null;
  createdAt: Millis;
  updatedAt: Millis;
}

const permissionsSchema = z
  .array(z.enum(PERMISSIONS))
  .max(PERMISSIONS.length * 2)
  .default([])
  .transform((list) => PERMISSIONS.filter((p) => list.includes(p)));

const userFields = {
  name: userNameSchema,
  role: z.enum(["owner", "staff"]).default("staff"),
  permissions: permissionsSchema,
  employeeId: z.string().nullish().transform((v) => v || null),
  isActive: z.boolean().default(true),
};

export const userCreateSchema = z.object({ ...userFields, password: optionalPasswordSchema });
export type UserCreate = z.input<typeof userCreateSchema>;
export const userUpdateSchema = z.object({ id: idSchema, ...userFields });
export type UserUpdate = z.input<typeof userUpdateSchema>;
/** password null = remove the password (the user then logs in by tapping the name). */
export const resetPasswordSchema = z.object({ id: idSchema, password: optionalPasswordSchema });
export type ResetPassword = z.input<typeof resetPasswordSchema>;

export interface UsersApi {
  /** All non-deleted users, owners first, then by name. */
  list(): Promise<User[]>;
  /** Name must be unique (CONFLICT); an employee can have one account. */
  create(input: UserCreate): Promise<User>;
  /** There must always be at least one active owner; you cannot deactivate or demote yourself. */
  update(input: UserUpdate): Promise<User>;
  resetPassword(input: ResetPassword): Promise<void>;
  /** Soft delete (history keeps the name). Not yourself, not the last owner. */
  remove(id: ID): Promise<void>;
}

/** Effective permissions of a user row. */
export function effectivePermissions(role: UserRole, stored: readonly string[]): Permission[] {
  if (role === "owner") return [...PERMISSIONS];
  return PERMISSIONS.filter((p) => stored.includes(p));
}
