import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@shared/contract";
import { ACCESS, checkAccess } from "../electron/api/access";
import { generateRecoveryCode, normalizeRecoveryCode } from "../electron/api/auth";
import { hashPassword, verifyPassword } from "../electron/api/session";
import { addStaff, apiError, guardedApi, loginAs, setupOwner } from "./helpers/auth";
import { createTestApi } from "./helpers/db";

type T = ReturnType<typeof createTestApi>;
let t: T;
beforeEach(() => {
  t = createTestApi();
});
afterEach(() => {
  vi.useRealTimers();
  t.close();
});

const product = () => t.api.products.create({ name: "ยางทดสอบ", costPrice: 100_000, sellPrice: 150_000, initialStock: 10 });
const saleOf = (productId: string, over: Record<string, unknown> = {}) => ({
  type: "sale" as const,
  occurredAt: Date.now(),
  items: [{ itemType: "product" as const, productId, qty: 1, unitPrice: 150_000 }],
  ...over,
});

describe("passwords", () => {
  it("hashes with a random salt and verifies in constant time", () => {
    const a = hashPassword("1234");
    const b = hashPassword("1234");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("1234", a)).toBe(true);
    expect(verifyPassword("12345", a)).toBe(false);
    expect(verifyPassword("1234", "garbage")).toBe(false);
    expect(verifyPassword("1234", "scrypt$x$8$1$AAAA$AAAA")).toBe(false);
  });

  it("recovery codes are 12 unambiguous characters, typed with any case / dashes", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(normalizeRecoveryCode(` ${code.toLowerCase().replace(/-/g, " ")} `)).toBe(code.replace(/-/g, ""));
  });
});

describe("first run", () => {
  it("needs setup until the owner account exists; setup logs in and returns a recovery code once", async () => {
    let s = await t.api.auth.status();
    expect(s).toMatchObject({ needsSetup: true, user: null, users: [] });
    expect(s.shopName).toBeTruthy();

    const { user, recoveryCode } = await setupOwner(t, "เจ้าของร้าน", "1234");
    expect(user).toMatchObject({ name: "เจ้าของร้าน", role: "owner" });
    expect(user.permissions).toEqual([...PERMISSIONS]);
    expect(recoveryCode).toMatch(/^\w{4}-\w{4}-\w{4}$/);

    s = await t.api.auth.status();
    expect(s.needsSetup).toBe(false);
    expect(s.user?.id).toBe(user.id);
    expect(s.users).toEqual([{ id: user.id, name: "เจ้าของร้าน", role: "owner", hasPassword: true }]);

    expect((await apiError(() => setupOwner(t, "อีกคน", "9999"))).code).toBe("CONFLICT");
  });

  it("validates the owner name and password", async () => {
    expect((await apiError(() => t.api.auth.setupOwner({ name: " ", password: "1234" }))).code).toBe("VALIDATION");
    expect((await apiError(() => t.api.auth.setupOwner({ name: "เจ้าของ", password: "123" }))).message).toContain("อย่างน้อย 4");
    expect((await apiError(() => t.api.auth.setupOwner({ name: "เจ้าของ", password: " 1234" }))).code).toBe("VALIDATION");
  });
});

describe("login / logout", () => {
  it("logs in with the right password only and records the history", async () => {
    const { user: owner } = await setupOwner(t);
    const staff = await addStaff(t, "น้องเมย์", [], "1111");
    await t.api.auth.logout();
    expect((await t.api.auth.status()).user).toBeNull();

    const wrong = await apiError(() => loginAs(t, staff.id, "0000"));
    expect(wrong).toMatchObject({ code: "VALIDATION", message: "รหัสผ่านไม่ถูกต้อง" });
    expect((await t.api.auth.status()).user).toBeNull();

    const me = await loginAs(t, staff.id, "1111");
    expect(me).toMatchObject({ id: staff.id, role: "staff", permissions: [] });
    expect((await t.api.auth.status()).user?.id).toBe(staff.id);
    expect((await t.api.users.list()).find((u) => u.id === staff.id)?.lastLoginAt).toBeGreaterThan(0);

    await t.api.auth.logout();
    const log = await t.api.audit.list({ entityType: "user", entityId: staff.id });
    expect(log.items.map((e) => e.action)).toEqual(["logout", "login", "login_failed", "create"]);
    expect(log.items.find((e) => e.action === "login_failed")?.userId).toBeNull();
    expect(log.items.find((e) => e.action === "create")?.userName).toBe(owner.name);
  });

  it("throttles wrong passwords: after 5 tries the user must wait, even with the right password", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 26, 10, 0));
    const { user } = await setupOwner(t, "เจ้าของ", "1234");
    await t.api.auth.logout();
    for (let i = 0; i < 5; i++) expect((await apiError(() => loginAs(t, user.id, "9999"))).message).toBe("รหัสผ่านไม่ถูกต้อง");
    const locked = await apiError(() => loginAs(t, user.id, "1234"));
    expect(locked.message).toMatch(/รอ 30 วินาที/);
    vi.setSystemTime(new Date(2026, 8, 26, 10, 0, 31));
    expect((await loginAs(t, user.id, "1234")).id).toBe(user.id);
  });

  it("a deactivated or deleted user cannot log in and loses the session", async () => {
    const { user: owner } = await setupOwner(t);
    const staff = await addStaff(t, "ช่างเอก", [], "1111");
    await t.api.users.update({ ...staff, isActive: false });
    await t.api.auth.logout();
    expect((await apiError(() => loginAs(t, staff.id, "1111"))).message).toContain("ปิดใช้งาน");
    expect((await t.api.auth.status()).users.map((u) => u.name)).not.toContain("ช่างเอก");

    // A logged-in user who is deleted meanwhile loses the session on the next call.
    await loginAs(t, owner.id, "1234");
    const other = await addStaff(t, "แคชเชียร์", [], "2222");
    await loginAs(t, other.id, "2222");
    t.sqlite.prepare("update users set deleted_at = 1 where id = ?").run(other.id);
    expect((await t.api.auth.status()).user).toBeNull();
    expect(t.ctx.session.userId).toBeNull();
  });

  it("changes the own password after checking the current one", async () => {
    const { user } = await setupOwner(t, "เจ้าของ", "1234");
    expect((await apiError(() => t.api.auth.changePassword({ currentPassword: "0000", newPassword: "5678" }))).message).toBe("รหัสผ่านเดิมไม่ถูกต้อง");
    await t.api.auth.changePassword({ currentPassword: "1234", newPassword: "5678" });
    await t.api.auth.logout();
    expect((await apiError(() => loginAs(t, user.id, "1234"))).code).toBe("VALIDATION");
    expect((await loginAs(t, user.id, "5678")).id).toBe(user.id);
  });
});

describe("recovery code", () => {
  it("resets an owner's password once; the code is replaced after use", async () => {
    const setup = await setupOwner(t, "เจ้าของ", "1234");
    const { user } = setup;
    const recoveryCode = setup.recoveryCode!;
    const staff = await addStaff(t, "พนักงาน", [], "1111");
    await t.api.auth.logout();

    expect((await apiError(() => t.api.auth.recover({ userId: user.id, recoveryCode: "AAAA-BBBB-CCCC", newPassword: "4321" }))).message).toBe("รหัสกู้คืนไม่ถูกต้อง");
    expect((await apiError(() => t.api.auth.recover({ userId: staff.id, recoveryCode, newPassword: "4321" }))).message).toContain("เจ้าของร้าน");

    const r = await t.api.auth.recover({ userId: user.id, recoveryCode: recoveryCode.toLowerCase(), newPassword: "4321" });
    expect(r.user.id).toBe(user.id);
    expect(r.recoveryCode).not.toBe(recoveryCode);
    expect((await t.api.auth.status()).user?.id).toBe(user.id);
    await t.api.auth.logout();
    expect((await loginAs(t, user.id, "4321")).id).toBe(user.id);
    await t.api.auth.logout();
    // the old code no longer works
    expect((await apiError(() => t.api.auth.recover({ userId: user.id, recoveryCode, newPassword: "1111" }))).code).toBe("VALIDATION");
    await t.api.auth.recover({ userId: user.id, recoveryCode: r.recoveryCode!, newPassword: "1111" });

    // an owner can issue a new code; staff cannot
    const again = await t.api.auth.newRecoveryCode();
    expect(again.recoveryCode).not.toBe(r.recoveryCode);
    await loginAs(t, staff.id, "1111");
    expect((await apiError(() => t.api.auth.newRecoveryCode())).code).toBe("FORBIDDEN");
  });
});

describe("users", () => {
  it("creates staff with chosen permissions; names are unique (case-insensitive); an employee has one account", async () => {
    await setupOwner(t);
    const e = await t.api.employees.create({ firstName: "สมศักดิ์", nickname: "ศักดิ์" });
    const u = await t.api.users.create({ name: "Mae", role: "staff", permissions: ["reports.view", "catalog.manage", "reports.view"], employeeId: e.id, password: "1111" });
    expect(u).toMatchObject({ role: "staff", employeeId: e.id, employeeName: "ศักดิ์", isActive: true });
    expect(u.permissions).toEqual(["catalog.manage", "reports.view"]);
    expect((await apiError(() => t.api.users.create({ name: " mae ", password: "1111" }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.users.create({ name: "อีกคน", employeeId: e.id, password: "1111" }))).message).toContain("มีบัญชีผู้ใช้อยู่แล้ว");
    expect((await apiError(() => t.api.users.create({ name: "x", permissions: ["hack" as never], password: "1111" }))).code).toBe("VALIDATION");
    expect((await t.api.employees.get(e.id)).userName).toBe("Mae");
    // owners are stored without a list but have every permission
    const o = await t.api.users.create({ name: "หุ้นส่วน", role: "owner", permissions: [], password: "9999" });
    expect(o.permissions).toEqual([...PERMISSIONS]);
  });

  it("keeps at least one active owner and protects the own account", async () => {
    const { user: owner } = await setupOwner(t);
    const me = (await t.api.users.list()).find((u) => u.id === owner.id)!;
    expect((await apiError(() => t.api.users.update({ ...me, role: "staff" }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.users.update({ ...me, isActive: false }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.users.remove(owner.id))).message).toContain("ของตัวเอง");

    const second = await t.api.users.create({ name: "หุ้นส่วน", role: "owner", password: "9999" });
    // the other owner may be demoted while I remain an owner
    await t.api.users.update({ ...second, role: "staff" });
    // log in as the demoted user: they cannot touch users any more (guarded)
    await loginAs(t, second.id, "9999");
    expect((await apiError(() => guardedApi(t).users.list())).code).toBe("FORBIDDEN");
    await loginAs(t, owner.id, "1234");
    await t.api.users.remove(second.id);
    expect((await t.api.users.list()).map((u) => u.name)).toEqual(["เจ้าของร้าน"]);
    // name can be reused after delete
    await t.api.users.create({ name: "หุ้นส่วน", role: "staff", password: "9999" });
  });

  it("the last active owner cannot be deactivated, demoted or deleted", async () => {
    const { user: a } = await setupOwner(t, "เจ้าของ A", "1234");
    const b = await t.api.users.create({ name: "เจ้าของ B", role: "owner", password: "5678" });
    await t.api.users.update({ ...b, isActive: false }); // A is still an active owner
    t.ctx.session.userId = null; // e.g. a call without a session
    const aRow = (await t.api.users.list()).find((u) => u.id === a.id)!;
    expect((await apiError(() => t.api.users.update({ ...aRow, isActive: false }))).message).toContain("อย่างน้อย 1");
    expect((await apiError(() => t.api.users.update({ ...aRow, role: "staff" }))).code).toBe("CONFLICT");
    expect((await apiError(() => t.api.users.remove(a.id))).code).toBe("CONFLICT");
    await t.api.users.update({ ...b, isActive: true });
    await t.api.users.remove(a.id);
  });

  it("resets a password and records who did it", async () => {
    await setupOwner(t);
    const s = await addStaff(t, "น้องเมย์", [], "1111");
    await t.api.users.resetPassword({ id: s.id, password: "2468" });
    await t.api.auth.logout();
    expect((await loginAs(t, s.id, "2468")).id).toBe(s.id);
    const log = await t.api.audit.list({ entityType: "user", entityId: s.id });
    expect(log.items.some((e) => e.action === "password_reset" && e.userName === "เจ้าของร้าน")).toBe(true);
  });
});

describe("access rules (IPC boundary)", () => {
  it("every API method has a rule", () => {
    const api = guardedApi(t) as unknown as Record<string, Record<string, unknown>>;
    for (const [ns, methods] of Object.entries(api)) {
      for (const m of Object.keys(methods)) expect((ACCESS as unknown as Record<string, Record<string, unknown>>)[ns]?.[m], `${ns}.${m}`).toBeDefined();
    }
    expect(() => checkAccess(t.ctx, "products", "nope", {})).toThrow();
  });

  it("without login only the public methods work", async () => {
    const g = guardedApi(t);
    expect((await g.auth.status()).needsSetup).toBe(true);
    expect((await g.attendance.board()).rows).toEqual([]);
    for (const call of [() => g.products.list({}), () => g.transactions.list({}), () => g.settings.get(), () => g.employees.list({}), () => g.users.list()]) {
      expect((await apiError(call)).code).toBe("UNAUTHORIZED");
    }
  });

  it("staff can sell and receive payment but need permissions for the rest", async () => {
    const { user: owner } = await setupOwner(t);
    const p = await product();
    const staff = await addStaff(t, "แคชเชียร์", [], "1111");
    await loginAs(t, staff.id, "1111");
    const g = guardedApi(t);

    const sale = await g.transactions.create(saleOf(p.id, { paymentStatus: "unpaid", paymentMethod: "credit" }));
    expect(sale.createdBy).toEqual({ id: staff.id, name: "แคชเชียร์" });
    const paid = await g.transactions.markPaid({ id: sale.id, paymentMethod: "cash" });
    expect(paid).toMatchObject({ paymentStatus: "paid", paymentMethod: "cash" });
    await g.customers.create({ name: "ลูกค้าใหม่" });
    await g.products.list({});
    await g.reports.lowStock({});

    const forbidden = [
      () => g.transactions.update({ ...saleOf(p.id), id: sale.id }),
      () => g.transactions.void({ id: sale.id }),
      () => g.transactions.create({ ...saleOf(p.id), type: "purchase" }),
      () => g.products.update({ id: p.id, name: "x" }),
      () => g.products.adjustStock({ productId: p.id, qty: 1 }),
      () => g.products.priceHistory({ id: p.id }),
      () => g.reports.summary({ from: 0, to: Date.now() }),
      () => g.employees.list({}),
      () => g.payroll.listRuns({}),
      () => g.attendance.summary({ from: "2026-09-01", to: "2026-09-30" }),
      () => g.audit.list({}),
      () => g.settings.update({ shop: { name: "ร้านใหม่" } }),
      () => g.settings.update({ payroll: { workStart: "09:00" } }),
      () => g.users.list(),
      () => g.auth.newRecoveryCode(),
    ];
    for (const call of forbidden) {
      const err = await apiError(call);
      expect(err.code, String(call)).toBe("FORBIDDEN");
    }
    expect((await apiError(() => g.transactions.void({ id: sale.id }))).message).toContain('"ยกเลิกบิล"');

    // the owner grants permissions; they apply at once (no re-login)
    await loginAs(t, owner.id, "1234");
    await t.api.users.update({ ...staff, permissions: ["transactions.void", "reports.view", "employees.manage"] });
    await loginAs(t, staff.id, "1111");
    await g.transactions.void({ id: sale.id, reason: "ทดสอบ" });
    await g.reports.summary({ from: 0, to: Date.now() });
    await g.settings.update({ payroll: { workStart: "09:00" } });
    expect((await apiError(() => g.settings.update({ payroll: { workStart: "09:00" }, shop: { name: "x" } }))).code).toBe("FORBIDDEN");
    await g.employees.list({});
  });

  it("purchase bills need the purchase permission for create, edit, void and payment", async () => {
    await setupOwner(t);
    const p = await product();
    const purchase = await t.api.transactions.create({ type: "purchase", occurredAt: Date.now(), paymentStatus: "unpaid", paymentMethod: "credit", items: [{ itemType: "product", productId: p.id, qty: 2, unitPrice: 90_000 }] });
    const staff = await addStaff(t, "พนักงาน", ["transactions.edit", "transactions.void"], "1111");
    await loginAs(t, staff.id, "1111");
    const g = guardedApi(t);
    expect((await apiError(() => g.transactions.markPaid({ id: purchase.id, paymentMethod: "transfer" }))).code).toBe("FORBIDDEN");
    expect((await apiError(() => g.transactions.void({ id: purchase.id }))).code).toBe("FORBIDDEN");
    expect((await apiError(() => g.transactions.update({ id: purchase.id, type: "purchase", occurredAt: Date.now(), items: [{ itemType: "product", productId: p.id, qty: 1, unitPrice: 1 }] }))).code).toBe("FORBIDDEN");
  });

  it("the time clock works without logging in", async () => {
    await setupOwner(t);
    const e = await t.api.employees.create({ firstName: "เอก" });
    await t.api.auth.logout();
    const g = guardedApi(t);
    const r = await g.attendance.clock({ employeeId: e.id });
    expect(r).toMatchObject({ action: "in", employeeName: "เอก" });
    expect((await g.attendance.board()).rows[0]).toMatchObject({ employeeId: e.id, status: "in" });
  });
});

describe("users without a password", () => {
  it("log in by tapping the name; a user with a password still needs it", async () => {
    await setupOwner(t, "เจ้าของ", "1234");
    const tap = await t.api.users.create({ name: "ช่างเอก", role: "staff", permissions: [], password: null });
    expect(tap.hasPassword).toBe(false);
    const staff = await addStaff(t, "พนักงาน", [], "1111");
    expect(staff.hasPassword).toBe(true);

    const tiles = (await t.api.auth.status()).users;
    expect(tiles.find((u) => u.id === tap.id)?.hasPassword).toBe(false);
    expect(tiles.find((u) => u.id === staff.id)?.hasPassword).toBe(true);

    await t.api.auth.logout();
    const me = await t.api.auth.login({ userId: tap.id });
    expect(me).toMatchObject({ id: tap.id, hasPassword: false });
    await t.api.auth.logout();
    // any typed text is ignored for a user without a password
    expect((await t.api.auth.login({ userId: tap.id, password: "whatever" })).id).toBe(tap.id);
    await t.api.auth.logout();

    expect((await apiError(() => t.api.auth.login({ userId: staff.id }))).message).toBe("กรุณากรอกรหัสผ่าน");
    expect((await apiError(() => t.api.auth.login({ userId: staff.id, password: "0000" }))).message).toBe("รหัสผ่านไม่ถูกต้อง");
  });

  it("can set their own password without a current one; the owner can remove or set it", async () => {
    const { user: owner } = await setupOwner(t, "เจ้าของ", "1234");
    const tap = await t.api.users.create({ name: "ช่างเอก", role: "staff", permissions: [], password: null });
    await t.api.auth.logout();

    await t.api.auth.login({ userId: tap.id });
    await t.api.auth.changePassword({ newPassword: "2468" });
    expect((await t.api.auth.status()).user?.hasPassword).toBe(true);
    await t.api.auth.logout();
    expect((await apiError(() => t.api.auth.login({ userId: tap.id }))).message).toBe("กรุณากรอกรหัสผ่าน");
    await loginAs(t, tap.id, "2468");
    // now the current password is required to change it
    expect((await apiError(() => t.api.auth.changePassword({ newPassword: "1357" }))).message).toBe("รหัสผ่านเดิมไม่ถูกต้อง");
    await t.api.auth.logout();

    await loginAs(t, owner.id, "1234");
    await t.api.users.resetPassword({ id: tap.id, password: null });
    const listed = (await t.api.users.list()).find((u) => u.id === tap.id)!;
    expect(listed.hasPassword).toBe(false);
    const history = await t.api.audit.list({ entityType: "user", entityId: tap.id });
    expect(history.items.map((e) => e.action)).toContain("password_remove");
    await t.api.users.resetPassword({ id: tap.id, password: "9999" });
    await t.api.auth.logout();
    expect((await loginAs(t, tap.id, "9999")).id).toBe(tap.id);
  });

  it("an owner can be set up without a password (no recovery code then)", async () => {
    const r = await t.api.auth.setupOwner({ name: "เจ้าของ", password: null });
    expect(r.recoveryCode).toBeNull();
    expect(r.user.hasPassword).toBe(false);
    await t.api.auth.logout();
    expect((await t.api.auth.login({ userId: r.user.id })).role).toBe("owner");
  });
});
