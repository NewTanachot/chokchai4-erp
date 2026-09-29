import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreApi } from "../electron/api";
import {
  autoBackupName,
  backupsDir,
  LEGACY_BACKUP_MESSAGE,
  NEWER_BACKUP_MESSAGE,
  cleanupStaleTempFiles,
  listBackupFiles,
  parseAutoBackupTime,
  performBackup,
  pruneAutoBackups,
  runAutoBackup,
  stageRestoreFile,
  swapInRestoredDb,
  validateBackupFile,
} from "../electron/api/backup";
import type { ApiContext } from "../electron/api/context";
import { newSession } from "../electron/api/session";
import { AppError } from "../electron/api/errors";
import { readMeta, writeMeta } from "../electron/api/settings";
import { createSystemApi, runStartupTasks } from "../electron/api/system";
import { openDatabase } from "../electron/db/client";
import { checkSchemaVersion, LegacyDatabaseError, readMigrationJournal, runMigrations, SchemaNewerThanAppError } from "../electron/db/migrate";
import { seedDefaults } from "../electron/db/seed";
import { seedDemo } from "../electron/dev/demo-seed";
import { LEGACY_DATA_DIR, removeDatabaseFiles, removeLegacyDataDir } from "../electron/legacy";

const DAY = 86_400_000;
const MIGRATIONS = path.resolve(__dirname, "../drizzle");
const restoreOpts = { migrationsFolder: MIGRATIONS };
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chokchai4-sys-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A real on-disk database (WAL, like the app) with migrations + demo data. */
async function fileDb(opts: { demo?: boolean } = {}) {
  const userDataPath = tempDir();
  const dbPath = path.join(userDataPath, "chokchai4.db");
  const { sqlite, db } = openDatabase(dbPath);
  runMigrations(db, MIGRATIONS);
  seedDefaults(db);
  const ctx: ApiContext = { db, sqlite, dbPath, userDataPath, session: newSession() };
  if (opts.demo !== false) await seedDemo(ctx);
  cleanups.push(() => {
    try {
      sqlite.close();
    } catch {
      /* closed */
    }
  });
  return ctx;
}

const count = (sqlite: Database.Database, table: string) =>
  sqlite.prepare(`select count(*) from ${table} where deleted_at is null`).pluck().get() as number;

function expectAppError(fn: () => unknown, code: string, message?: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    if (message) expect((e as AppError).message).toMatch(message);
    return;
  }
  throw new Error("expected an AppError");
}

describe("performBackup / validateBackupFile", () => {
  it("writes a complete, self-contained copy that validates", async () => {
    const ctx = await fileDb();
    const products = count(ctx.sqlite, "products");
    const sales = count(ctx.sqlite, "transactions");
    expect(products).toBeGreaterThan(10);
    expect(sales).toBeGreaterThan(10);

    const outDir = tempDir();
    const dest = path.join(outDir, "nested", "backup.db");
    const saved = await performBackup(ctx.sqlite, dest);
    expect(saved).toBe(dest);
    expect(fs.existsSync(dest)).toBe(true);

    const summary = validateBackupFile(dest);
    expect(summary).toMatchObject({ products, transactions: sales });
    expect(summary.customers).toBeGreaterThan(0);
    expect(summary.lastTransactionAt).toBeGreaterThan(0);

    const copy = new Database(dest, { readonly: true });
    expect(count(copy, "products")).toBe(products);
    expect(copy.pragma("journal_mode", { simple: true })).toBe("delete");
    copy.close();
    // Single file: no temp files or WAL sidecars left next to the backup.
    expect(fs.readdirSync(path.dirname(dest))).toEqual(["backup.db"]);
  });

  it("rejects missing, random and non-ERP SQLite files", async () => {
    const dir = tempDir();
    expectAppError(() => validateBackupFile(path.join(dir, "nope.db")), "NOT_FOUND");

    const random = path.join(dir, "random.db");
    fs.writeFileSync(random, Buffer.from(Array.from({ length: 8192 }, (_, i) => (i * 7919) % 256)));
    expectAppError(() => validateBackupFile(random), "VALIDATION", /ไม่ใช่ไฟล์สำรองข้อมูล/);

    const text = path.join(dir, "notes.db");
    fs.writeFileSync(text, "hello ".repeat(200));
    expectAppError(() => validateBackupFile(text), "VALIDATION");

    const other = path.join(dir, "other-app.db");
    const o = new Database(other);
    o.exec("create table products (id text); create table notes (x text); insert into notes values ('a')");
    o.close();
    expectAppError(() => validateBackupFile(other), "VALIDATION", /ไม่ใช่ไฟล์สำรองข้อมูล/);
  });

  it("rejects a corrupted backup", async () => {
    const ctx = await fileDb();
    const dest = path.join(tempDir(), "b.db");
    await performBackup(ctx.sqlite, dest);
    const buf = fs.readFileSync(dest);
    // Trash the schema page (page 1 after the 100-byte header) and a chunk of data pages.
    for (let i = 100; i < Math.min(buf.length, 3000); i++) buf[i] = (i * 31) % 256;
    for (let i = 8192; i < Math.min(buf.length, 20000); i++) buf[i] = 0xff;
    fs.writeFileSync(dest, buf);
    expect(() => validateBackupFile(dest)).toThrow(AppError);
  });
});

describe("backup listing and pruning", () => {
  const now = new Date(2026, 8, 25, 9, 0).getTime();

  function makeFiles(dir: string, names: string[], mtime: number) {
    for (const n of names) {
      const p = path.join(dir, n);
      fs.writeFileSync(p, "x");
      fs.utimesSync(p, mtime / 1000, mtime / 1000);
    }
  }

  it("parses auto backup names", () => {
    expect(autoBackupName(now)).toBe("auto-20260925-0900.db");
    expect(parseAutoBackupTime("auto-20260925-0900.db")).toBe(now);
    expect(parseAutoBackupTime("before-restore-20260925-090000.db")).toBeNull();
  });

  it("pruneAutoBackups deletes only auto-*.db files older than keepDays", () => {
    const dir = tempDir();
    const old = now - 60 * DAY;
    makeFiles(
      dir,
      [
        "auto-20260701-0900.db", // old -> deleted
        "auto-20260801-0900.db", // old -> deleted
        "auto-20260920-0900.db", // 5 days -> kept
        "before-restore-20260701-090000.db", // not auto -> kept
        "chokchai4-backup-20260701-0900.db", // manual -> kept
        "auto-notes.txt", // not .db -> kept
      ],
      old, // all files look old on disk; auto names carry their own time
    );
    const deleted = pruneAutoBackups(dir, 30, now).map((p) => path.basename(p));
    expect(deleted.sort()).toEqual(["auto-20260701-0900.db", "auto-20260801-0900.db"]);
    expect(fs.readdirSync(dir).sort()).toEqual([
      "auto-20260920-0900.db",
      "auto-notes.txt",
      "before-restore-20260701-090000.db",
      "chokchai4-backup-20260701-0900.db",
    ]);
  });

  it("pruneAutoBackups can always keep the newest N", () => {
    const dir = tempDir();
    makeFiles(dir, ["auto-20260101-0900.db", "auto-20260201-0900.db", "auto-20260301-0900.db"], now - 200 * DAY);
    const deleted = pruneAutoBackups(dir, 7, now, { minKeep: 2 }).map((p) => path.basename(p));
    expect(deleted).toEqual(["auto-20260101-0900.db"]);
  });

  it("listBackupFiles returns .db files newest first and [] for a missing dir", () => {
    const dir = tempDir();
    makeFiles(dir, ["a.db"], now - 3 * DAY);
    makeFiles(dir, ["b.db"], now - 1 * DAY);
    makeFiles(dir, ["c.txt"], now);
    const list = listBackupFiles(dir);
    expect(list.map((f) => f.name)).toEqual(["b.db", "a.db"]);
    expect(list[0]).toMatchObject({ size: 1, createdAt: now - DAY, path: path.join(dir, "b.db") });
    expect(listBackupFiles(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("automatic backup", () => {
  it("backs up at most once per 20 h, records lastAutoBackupAt and respects the setting", async () => {
    const ctx = await fileDb({ demo: false });
    const dir = backupsDir(ctx.userDataPath);
    const t0 = new Date(2026, 8, 25, 8, 30).getTime();

    const first = await runAutoBackup(ctx, t0);
    expect(first && path.basename(first)).toBe("auto-20260925-0830.db");
    expect(readMeta<number>(ctx.db, "lastAutoBackupAt")).toBe(t0);
    validateBackupFile(first!);

    expect(await runAutoBackup(ctx, t0 + 3_600_000)).toBeNull();
    const second = await runAutoBackup(ctx, t0 + 21 * 3_600_000);
    expect(second && path.basename(second)).toBe("auto-20260926-0530.db");
    expect(listBackupFiles(dir)).toHaveLength(2);

    const core = createCoreApi(ctx);
    await core.settings.update({ backup: { autoBackup: false } });
    expect(await runAutoBackup(ctx, t0 + 50 * 3_600_000)).toBeNull();
  });

  it("prunes old automatic backups after a new one", async () => {
    const ctx = await fileDb({ demo: false });
    const dir = backupsDir(ctx.userDataPath);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date(2026, 8, 25, 8, 0).getTime();
    for (const n of ["auto-20260601-0800.db", "auto-20260602-0800.db", "auto-20260603-0800.db", "auto-20260604-0800.db"]) {
      fs.writeFileSync(path.join(dir, n), "x");
    }
    await createCoreApi(ctx).settings.update({ backup: { keepDays: 10 } });
    await runAutoBackup(ctx, now);
    // New backup + the 2 newest old ones (always keeps 3 automatic backups).
    expect(listBackupFiles(dir).map((f) => f.name).sort()).toEqual([
      "auto-20260603-0800.db",
      "auto-20260604-0800.db",
      "auto-20260925-0800.db",
    ]);
  });

  it("runStartupTasks never throws", async () => {
    const ctx = await fileDb({ demo: false });
    ctx.sqlite.close();
    await expect(runStartupTasks(ctx)).resolves.toBeUndefined();
  });
});

describe("restore mechanics", () => {
  it("stages a backup and swaps it in for the closed live DB", async () => {
    const ctx = await fileDb();
    const products = count(ctx.sqlite, "products");
    const backup = path.join(tempDir(), "before-changes.db");
    await performBackup(ctx.sqlite, backup);

    // Changes made after the backup...
    ctx.sqlite.prepare("update products set deleted_at = 1").run();
    expect(count(ctx.sqlite, "products")).toBe(0);

    const staged = await stageRestoreFile(backup, ctx.dbPath, restoreOpts);
    ctx.sqlite.close();
    swapInRestoredDb(staged, ctx.dbPath);
    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.existsSync(ctx.dbPath + "-wal")).toBe(false);

    // ...are gone after "relaunch"; migrations still run on the restored file.
    const reopened = openDatabase(ctx.dbPath);
    runMigrations(reopened.db, MIGRATIONS);
    expect(count(reopened.sqlite, "products")).toBe(products);
    reopened.sqlite.close();
  });
});

describe("system api (no Electron needed)", () => {
  it("lists backups and validates inputs before touching Electron", async () => {
    const ctx = await fileDb({ demo: false });
    const sys = createSystemApi(ctx, restoreOpts);
    expect(await sys.listBackups()).toEqual([]);
    await runAutoBackup(ctx);
    const list = await sys.listBackups();
    expect(list).toHaveLength(1);
    expect(list[0].name).toMatch(/^auto-\d{8}-\d{4}\.db$/);

    await expect(Promise.resolve().then(() => sys.openExternal("javascript:alert(1)"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(Promise.resolve().then(() => sys.openExternal("file:///etc/passwd"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(Promise.resolve().then(() => sys.restore({ path: ctx.dbPath }))).rejects.toMatchObject({ code: "VALIDATION" });
    const bogus = path.join(ctx.userDataPath, "bogus.db");
    fs.writeFileSync(bogus, "not a database".repeat(100));
    await expect(Promise.resolve().then(() => sys.restore({ path: bogus }))).rejects.toMatchObject({ code: "VALIDATION" });
    // Nothing was replaced: the live DB still works.
    expect(count(ctx.sqlite, "categories")).toBeGreaterThan(0);
  });
});

describe("edge cases", () => {
  it("rejects empty files and directories", () => {
    const dir = tempDir();
    const empty = path.join(dir, "empty.db");
    fs.writeFileSync(empty, "");
    expectAppError(() => validateBackupFile(empty), "VALIDATION");
    const folder = path.join(dir, "folder.db");
    fs.mkdirSync(folder);
    expectAppError(() => validateBackupFile(folder), "VALIDATION");
    // A directory named *.db is not listed as a backup.
    expect(listBackupFiles(dir).map((f) => f.name)).toEqual(["empty.db"]);
  });

  it("restores a raw copy of a WAL database (with its -wal file) without touching the source folder", async () => {
    const ctx = await fileDb();
    const products = count(ctx.sqlite, "products");
    // Simulate copying the live files out of the data folder while the app is running.
    ctx.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    ctx.sqlite.prepare("update products set note = 'after-checkpoint'").run(); // lives only in the -wal file
    const usb = tempDir();
    const raw = path.join(usb, "copied.db");
    fs.copyFileSync(ctx.dbPath, raw);
    fs.copyFileSync(ctx.dbPath + "-wal", raw + "-wal");
    const before = fs.readdirSync(usb).sort();

    const target = await fileDb({ demo: false });
    const staged = await stageRestoreFile(raw, target.dbPath, restoreOpts);
    expect(fs.readdirSync(usb).sort()).toEqual(before); // no -shm / temp files left on the "flash drive"
    const copy = new Database(staged, { readonly: true });
    expect(count(copy, "products")).toBe(products);
    expect(copy.prepare("select count(*) from products where note = 'after-checkpoint'").pluck().get()).toBe(products);
    expect(copy.pragma("journal_mode", { simple: true })).toBe("delete");
    copy.close();
    // Only the staged file remains next to the target DB (the private .src copy is gone).
    expect(fs.readdirSync(path.dirname(target.dbPath)).filter((n) => n.includes(".restore-"))).toEqual([path.basename(staged)]);
  });

  it("explains a WAL database copied without its -wal file", async () => {
    const dir = tempDir();
    const live = path.join(dir, "live.db");
    const { sqlite, db } = openDatabase(live);
    runMigrations(db, MIGRATIONS); // tables exist only in the -wal so far
    const copy = path.join(tempDir(), "half.db");
    fs.copyFileSync(live, copy);
    sqlite.close();
    expectAppError(() => validateBackupFile(copy), "VALIDATION", /ขณะที่โปรแกรมเปิดใช้งานอยู่/);
    const target = await fileDb({ demo: false });
    await expect(stageRestoreFile(copy, target.dbPath, restoreOpts)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(stageRestoreFile(path.join(dir, "missing.db"), target.dbPath, restoreOpts)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fs.readdirSync(path.dirname(target.dbPath)).filter((n) => n.includes(".restore-"))).toEqual([]);
  });

  it("reports a friendly error when the destination is not writable", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const ctx = await fileDb({ demo: false });
    const dir = tempDir();
    fs.chmodSync(dir, 0o500);
    cleanups.push(() => fs.chmodSync(dir, 0o700));
    await expect(performBackup(ctx.sqlite, path.join(dir, "b.db"))).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/ไม่มีสิทธิ์/) });
    expect(fs.readdirSync(dir)).toEqual([]);
    // Same when a missing sub-folder cannot be created.
    await expect(performBackup(ctx.sqlite, path.join(dir, "sub", "b.db"))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("backs up again when the recorded time is in the future (clock was wrong)", async () => {
    const ctx = await fileDb({ demo: false });
    const now = new Date(2026, 8, 25, 8, 0).getTime();
    writeMeta(ctx.db, "lastAutoBackupAt", now + 5 * DAY);
    expect(await runAutoBackup(ctx, now)).not.toBeNull();
    expect(readMeta<number>(ctx.db, "lastAutoBackupAt")).toBe(now);
  });

  it("an existing auto backup file counts even without the meta row", async () => {
    const ctx = await fileDb({ demo: false });
    const now = new Date(2026, 8, 25, 8, 0).getTime();
    const dir = backupsDir(ctx.userDataPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, autoBackupName(now - 2 * 3_600_000)), "x");
    expect(await runAutoBackup(ctx, now)).toBeNull();
  });

  it("cleanupStaleTempFiles removes only old leftovers", async () => {
    const ctx = await fileDb({ demo: false });
    const dir = backupsDir(ctx.userDataPath);
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const old = (now - 2 * 3_600_000) / 1000;
    const make = (p: string, mtime?: number) => {
      fs.writeFileSync(p, "x");
      if (mtime) fs.utimesSync(p, mtime, mtime);
      return p;
    };
    const staleTmp = make(path.join(dir, "auto-20260925-0800.db.123-456.tmp"), old);
    const freshTmp = make(path.join(dir, "auto-20260925-0900.db.123-789.tmp"));
    const keepDb = make(path.join(dir, "auto-20260925-0800.db"), old);
    const staleRestore = make(`${ctx.dbPath}.restore-1-2.tmp`, old);
    const staleSrcWal = make(`${ctx.dbPath}.restore-1-2.src-wal`, old);
    const removed = cleanupStaleTempFiles(ctx, now);
    expect(removed.sort()).toEqual([staleTmp, staleRestore, staleSrcWal].sort());
    expect(fs.existsSync(freshTmp) && fs.existsSync(keepDb) && fs.existsSync(ctx.dbPath)).toBe(true);
  });
});

describe("schema version vs app version (backups from other app versions)", () => {
  const journal = readMigrationJournal(MIGRATIONS);
  const newestWhen = Math.max(...journal.map((e) => e.when));
  const migrationRows = (sqlite: Database.Database) =>
    (sqlite.prepare("select created_at from __drizzle_migrations order by created_at").pluck().all() as number[]).map(Number);

  /** What a future app version's migration leaves behind: a schema change + a __drizzle_migrations row we don't ship. */
  function makeNewer(file: string, createdAt = newestWhen + DAY) {
    const d = new Database(file);
    d.exec("alter table transactions add column branch_id text not null default 'main'");
    d.prepare("insert into __drizzle_migrations (hash, created_at) values ('future-migration', ?)").run(createdAt);
    d.close();
  }

  /** A copy of the app's migrations folder plus one extra migration: "the next app version". */
  function nextAppMigrations(): string {
    const dir = path.join(tempDir(), "drizzle");
    fs.cpSync(MIGRATIONS, dir, { recursive: true });
    const file = path.join(dir, "meta", "_journal.json");
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const tag = "9999_next_version";
    j.entries.push({ idx: j.entries.length, version: "6", when: newestWhen + DAY, tag, breakpoints: true });
    fs.writeFileSync(file, JSON.stringify(j, null, 2));
    fs.writeFileSync(path.join(dir, `${tag}.sql`), "ALTER TABLE `products` ADD `next_version_note` text;");
    return dir;
  }

  it("drizzle records each journal entry's `when` as created_at (the assumption the check relies on)", async () => {
    expect(journal.length).toBeGreaterThan(0);
    const ctx = await fileDb({ demo: false });
    expect(migrationRows(ctx.sqlite)).toEqual(journal.map((e) => e.when));
    expect(checkSchemaVersion(ctx.sqlite, MIGRATIONS)).toEqual({ applied: journal.length, pending: 0, unknown: [], newerThanApp: false, legacy: false });
    const fresh = new Database(":memory:");
    expect(checkSchemaVersion(fresh, journal)).toEqual({ applied: 0, pending: journal.length, unknown: [], newerThanApp: false, legacy: false });
    fresh.close();
  });

  it("rejects restoring a backup made by a newer app version, before anything is replaced", async () => {
    const ctx = await fileDb();
    const products = count(ctx.sqlite, "products");
    const newer = path.join(tempDir(), "from-newer-app.db");
    await performBackup(ctx.sqlite, newer);
    makeNewer(newer);

    // Still a healthy Chokchai4 file (manual-backup validation passes) ...
    expect(validateBackupFile(newer).products).toBe(products);
    // ... but not restorable by this version.
    expectAppError(() => validateBackupFile(newer, restoreOpts), "VALIDATION", /เวอร์ชันใหม่กว่า/);
    await expect(stageRestoreFile(newer, ctx.dbPath, restoreOpts)).rejects.toMatchObject({ code: "VALIDATION", message: NEWER_BACKUP_MESSAGE });

    const sys = createSystemApi(ctx, restoreOpts);
    await expect(Promise.resolve().then(() => sys.restore({ path: newer }))).rejects.toMatchObject({
      code: "VALIDATION",
      message: NEWER_BACKUP_MESSAGE,
    });
    // No safety copy, no staged leftovers, live DB untouched and still usable.
    expect(listBackupFiles(backupsDir(ctx.userDataPath))).toEqual([]);
    expect(fs.readdirSync(path.dirname(ctx.dbPath)).filter((n) => n.includes(".restore-"))).toEqual([]);
    expect(count(ctx.sqlite, "products")).toBe(products);
    expect(migrationRows(ctx.sqlite)).toEqual(journal.map((e) => e.when));

    // A migration unknown to this app counts even when it is not the newest one (a diverging build).
    const odd = path.join(tempDir(), "odd.db");
    await performBackup(ctx.sqlite, odd);
    makeNewer(odd, journal[0].when - DAY);
    expectAppError(() => validateBackupFile(odd, restoreOpts), "VALIDATION", /เวอร์ชันใหม่กว่า/);
  });

  it("accepts a backup from the same app version", async () => {
    const ctx = await fileDb();
    const backup = path.join(tempDir(), "same.db");
    await performBackup(ctx.sqlite, backup);
    expect(validateBackupFile(backup, restoreOpts).products).toBe(count(ctx.sqlite, "products"));
    const staged = await stageRestoreFile(backup, ctx.dbPath, restoreOpts);
    cleanups.push(() => fs.rmSync(staged, { force: true }));
    const copy = new Database(staged, { readonly: true });
    expect(checkSchemaVersion(copy, MIGRATIONS)).toMatchObject({ pending: 0, newerThanApp: false });
    copy.close();
  });

  it("accepts an older backup and upgrades it with the next start's migrations", async () => {
    const next = nextAppMigrations(); // the app doing the restore is one migration ahead of the backup
    const old = await fileDb();
    const products = count(old.sqlite, "products");
    const backup = path.join(tempDir(), "older.db");
    await performBackup(old.sqlite, backup);

    const live = await fileDb({ demo: false });
    runMigrations(live.db, next);
    expect(validateBackupFile(backup, { migrationsFolder: next }).products).toBe(products);
    const staged = await stageRestoreFile(backup, live.dbPath, { migrationsFolder: next });
    live.sqlite.close();
    swapInRestoredDb(staged, live.dbPath);

    // "Relaunch" of the newer app: the restored file gets the missing migration.
    const reopened = openDatabase(live.dbPath);
    cleanups.push(() => reopened.sqlite.close());
    expect(checkSchemaVersion(reopened.sqlite, next)).toMatchObject({ applied: journal.length, pending: 1, newerThanApp: false });
    runMigrations(reopened.db, next);
    expect(migrationRows(reopened.sqlite)).toEqual([...journal.map((e) => e.when), newestWhen + DAY]);
    expect(count(reopened.sqlite, "products")).toBe(products);
    expect(reopened.sqlite.prepare("select count(next_version_note) from products").pluck().get()).toBe(0);
    // And for that newer app, today's app is the "older version": it refuses the upgraded file.
    expect(checkSchemaVersion(reopened.sqlite, MIGRATIONS).newerThanApp).toBe(true);
  });

  it("runMigrations refuses a live database from a newer app version without changing it", async () => {
    const dir = tempDir();
    const file = path.join(dir, "chokchai4.db");
    const first = openDatabase(file);
    runMigrations(first.db, MIGRATIONS);
    seedDefaults(first.db);
    first.sqlite.close();
    makeNewer(file);
    const before = fs.readFileSync(file);

    const { sqlite, db } = openDatabase(file);
    cleanups.push(() => sqlite.close());
    let err: unknown;
    try {
      runMigrations(db, MIGRATIONS);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SchemaNewerThanAppError);
    expect((err as SchemaNewerThanAppError).check).toMatchObject({ unknown: [newestWhen + DAY], newerThanApp: true });
    expect(migrationRows(sqlite)).toEqual([...journal.map((e) => e.when), newestWhen + DAY]);
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});

describe("data of the pre-release test builds (before 0.1.0)", () => {
  const journal = readMigrationJournal(MIGRATIONS);
  const firstWhen = Math.min(...journal.map((e) => e.when));

  /** What a pre-0.1.0 build left behind: only migrations older than this app's first one (squashed since). */
  function makeLegacy(file: string) {
    const d = new Database(file);
    d.exec("delete from __drizzle_migrations");
    const ins = d.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)");
    ins.run("old-0000", firstWhen - 3 * DAY);
    ins.run("old-0001", firstWhen - 2 * DAY);
    d.close();
  }

  it("is recognised as legacy (not as a newer version)", async () => {
    const ctx = await fileDb({ demo: false });
    const file = path.join(tempDir(), "legacy.db");
    await performBackup(ctx.sqlite, file);
    makeLegacy(file);
    const d = new Database(file, { readonly: true });
    cleanups.push(() => d.close());
    expect(checkSchemaVersion(d, MIGRATIONS)).toMatchObject({ applied: 2, legacy: true, newerThanApp: false });
  });

  it("runMigrations refuses it without changing it (the app then starts a new database)", async () => {
    const dir = tempDir();
    const file = path.join(dir, "chokchai4.db");
    const first = openDatabase(file);
    runMigrations(first.db, MIGRATIONS);
    first.sqlite.close();
    makeLegacy(file);
    const before = fs.readFileSync(file);
    const { sqlite, db } = openDatabase(file);
    cleanups.push(() => sqlite.close());
    expect(() => runMigrations(db, MIGRATIONS)).toThrow(LegacyDatabaseError);
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it("cannot be restored", async () => {
    const ctx = await fileDb();
    const file = path.join(tempDir(), "legacy-backup.db");
    await performBackup(ctx.sqlite, file);
    makeLegacy(file);
    expectAppError(() => validateBackupFile(file, restoreOpts), "VALIDATION", /รุ่นทดลอง/);
    await expect(stageRestoreFile(file, ctx.dbPath, restoreOpts)).rejects.toMatchObject({ code: "VALIDATION", message: LEGACY_BACKUP_MESSAGE });
  });

  it("the test builds' data folder is deleted, never the folder in use", () => {
    const appData = tempDir();
    const legacy = path.join(appData, LEGACY_DATA_DIR);
    fs.mkdirSync(path.join(legacy, "backups"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "chokchai4.db"), "old");
    fs.writeFileSync(path.join(legacy, "backups", "auto-20260925-0900.db"), "old");
    const current = path.join(appData, "Chokchai 4 Yangyont 2002 ERP");
    fs.mkdirSync(current);

    expect(removeLegacyDataDir(appData, current)).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(current)).toBe(true);
    expect(removeLegacyDataDir(appData, current)).toBe(false);

    // A run pointed at the legacy folder itself (never happens in the app) keeps it.
    fs.mkdirSync(legacy);
    expect(removeLegacyDataDir(appData, legacy)).toBe(false);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it("removeDatabaseFiles deletes the database with its WAL and shared-memory files", () => {
    const dir = tempDir();
    const db = path.join(dir, "chokchai4.db");
    for (const f of [db, `${db}-wal`, `${db}-shm`, path.join(dir, "keep.db")]) fs.writeFileSync(f, "x");
    removeDatabaseFiles(db);
    expect(fs.readdirSync(dir)).toEqual(["keep.db"]);
  });
});
