import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { amountInWords, bahtTextEn } from "@shared/bahttext";
import { fillTemplate, translate } from "@shared/i18n";
import { payrollTitle } from "@shared/payroll";
import { readMeta } from "../electron/api/settings";
import { mainLanguage, setMainLanguage, tr } from "../electron/i18n";
import { analyze } from "../scripts/i18n.mjs";
import { apiError, guardedApi, setupOwner } from "./helpers/auth";
import { createTestApi } from "./helpers/db";

describe("Thai -> English dictionary (shared/i18n/en.json)", () => {
  it("has an English translation for every Thai string in the code, with the same parameters", () => {
    const r = analyze(path.resolve(__dirname, ".."));
    expect(r.keys.size).toBeGreaterThan(1500);
    expect(r.missing).toEqual([]);
    expect(r.placeholderMismatch).toEqual([]);
    expect(r.untranslated).toEqual([]);
    expect(r.unused).toEqual([]);
  });
});

describe("translate", () => {
  it("keeps Thai as it is and fills parameters", () => {
    expect(translate("th", "บันทึกบิล {0} แล้ว", ["S6909-0001"])).toBe("บันทึกบิล S6909-0001 แล้ว");
    expect(translate("en", "บันทึกบิล {0} แล้ว", ["S6909-0001"])).toBe("Bill S6909-0001 saved");
  });

  it("chooses English plurals", () => {
    expect(translate("en", "{0} บิล", [1])).toBe("1 bill");
    expect(translate("en", "{0} บิล", [3])).toBe("3 bills");
    expect(fillTemplate("{0|# item|# items}", [2])).toBe("2 items");
  });

  it("translates text built in Thai elsewhere (main-process messages), including known parameters", () => {
    expect(translate("en", "ใส่รหัสผิดหลายครั้ง กรุณารอ 30 วินาทีแล้วลองใหม่")).toBe("Too many wrong attempts. Please wait 30 seconds and try again");
    expect(translate("en", 'คุณไม่มีสิทธิ์ "บันทึกการซื้อ" กรุณาให้เจ้าของร้านเพิ่มสิทธิ์ให้')).toBe(
      'You don\'t have the permission "Record purchase". Please ask the owner to add it',
    );
    expect(translate("en", "ค่าล่วงเวลา (OT) ×1.5")).toBe("Overtime (OT) ×1.5");
  });

  it("does not rewrite typed text that only starts like a short template", () => {
    expect(translate("en", "ลบรอยขีดข่วน")).toBe("ลบรอยขีดข่วน");
    expect(translate("en", "สมชาย ใจดี")).toBe("สมชาย ใจดี");
  });

  it("uses a context translation when there is one", () => {
    expect(translate("en", "ยกเลิกบิล")).toBe("Void bill");
    expect(translate("en", "ยกเลิกบิล", [], "audit")).toBe("Bill voided");
    expect(translate("en", "ยกเลิก", [], "audit")).toBe("Cancel");
  });

  it("leaves text without a translation (and non-Thai text) unchanged", () => {
    expect(translate("en", "ข้อความที่ไม่มีในพจนานุกรม")).toBe("ข้อความที่ไม่มีในพจนานุกรม");
    expect(translate("en", "฿1,200.00")).toBe("฿1,200.00");
  });
});

describe("documents in English", () => {
  it("amount in words", () => {
    expect(bahtTextEn(0)).toBe("Zero baht only");
    expect(bahtTextEn(2150)).toBe("Twenty-one baht and fifty satang");
    expect(bahtTextEn(123_456_789)).toBe("One million two hundred thirty-four thousand five hundred sixty-seven baht and eighty-nine satang");
    expect(amountInWords(200_000, "th")).toBe("สองพันบาทถ้วน");
    expect(amountInWords(200_000, "en")).toBe("Two thousand baht only");
  });

  it("default pay run title", () => {
    expect(payrollTitle("2026-09-01", "2026-09-30", "en")).toBe("Salary Sept 2026");
    expect(payrollTitle("2026-09-01", "2026-09-15", "en")).toBe("Salary 1–15 Sept 2026");
  });
});

describe("program language (main process)", () => {
  afterEach(() => setMainLanguage("th"));

  it("system.setLanguage works without logging in, is saved, and switches the main process", async () => {
    const t = createTestApi();
    await setupOwner(t);
    await t.api.auth.logout();
    const api = guardedApi(t);
    // The stub system API in guardedApi does not implement it; call the real one through the access rules.
    const { createSystemApi } = await import("../electron/api/system");
    const { withAccessControl } = await import("../electron/api/access");
    const guarded = withAccessControl({ ...api, system: createSystemApi(t.ctx, { migrationsFolder: path.resolve(__dirname, "../drizzle") }) }, t.ctx);
    await guarded.system.setLanguage({ language: "en" });
    expect(readMeta(t.db, "language")).toBe("en");
    expect(mainLanguage()).toBe("en");
    expect(tr("ไม่สามารถเปิดโปรแกรมได้")).toBe("Cannot open the program");
    expect((await apiError(() => guarded.system.setLanguage({ language: "fr" as "th" }))).code).toBe("VALIDATION");
    t.close();
  });
});
