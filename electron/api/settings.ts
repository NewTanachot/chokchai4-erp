import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, settingsPatchSchema, type AppSettings, type AuditFieldChange, type SettingsApi, type Handlers } from "@shared/contract";
import { auditValue, writeAudit } from "./audit";
import type { ApiContext } from "./context";
import type { Db } from "../db/client";
import { settings } from "../db/schema";
import { actorOf } from "./session";

/** History value of a setting: the logo image is recorded as "has a logo" rather than its data. */
function settingValue(section: string, key: string, value: unknown) {
  if (section === "shop" && key === "logoDataUrl") return value ? "(มีรูปโลโก้)" : null;
  return auditValue(value);
}

const SECTIONS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];

/** Read full settings (defaults merged in). Other namespaces call this directly. */
export function readSettings(db: Db): AppSettings {
  const rows = db.select().from(settings).all();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  for (const section of SECTIONS) {
    const raw = stored.get(section);
    if (!raw) continue;
    try {
      Object.assign(out[section], JSON.parse(raw));
    } catch {
      /* ignore corrupt section, fall back to defaults */
    }
  }
  return out;
}

/** Internal key/value helpers for non-user-facing state (e.g. lastAutoBackupAt, deviceId). */
export function readMeta<T>(db: Db, key: string): T | null {
  const row = db.select().from(settings).where(eq(settings.key, `meta:${key}`)).get();
  return row ? (JSON.parse(row.value) as T) : null;
}
export function writeMeta(db: Db, key: string, value: unknown): void {
  const k = `meta:${key}`;
  const v = JSON.stringify(value);
  db.insert(settings).values({ key: k, value: v, updatedAt: Date.now() }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: Date.now() } }).run();
}

export function createSettingsApi(ctx: ApiContext): Handlers<SettingsApi> {
  const { db } = ctx;
  return {
    get: () => readSettings(db),
    update: (input) => {
      const patch = settingsPatchSchema.parse(input ?? {});
      const current = readSettings(db);
      const at = Date.now();
      db.transaction((tx) => {
        const changes: AuditFieldChange[] = [];
        for (const section of SECTIONS) {
          const p = patch[section];
          if (!p) continue;
          const before = current[section] as Record<string, unknown>;
          const merged = { ...before, ...p } as Record<string, unknown>;
          for (const key of Object.keys(p)) {
            const from = settingValue(section, key, before[key]);
            const to = settingValue(section, key, merged[key]);
            if (from !== to) changes.push({ field: `${section}.${key}`, from, to });
          }
          const value = JSON.stringify(merged);
          tx.insert(settings)
            .values({ key: section, value, updatedAt: at })
            .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: at } })
            .run();
        }
        if (changes.length) writeAudit(tx, actorOf(tx, ctx.session), { entityType: "settings", entityId: null, entityLabel: "ตั้งค่า", action: "update", changes, at });
      });
      return readSettings(db);
    },
  };
}
