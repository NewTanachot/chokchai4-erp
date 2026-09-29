/**
 * Backup / restore helpers for the SQLite database. Pure Node (no Electron imports) so they run in tests.
 *
 * File naming inside <userData>/backups:
 *   auto-YYYYMMDD-HHmm.db              daily automatic backup (pruned after settings.backup.keepDays)
 *   before-restore-YYYYMMDD-HHmmss.db  safety copy of the live DB taken right before a restore (never pruned)
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { BackupFile } from "@shared/contract";
import type { ApiContext } from "./context";
import type { Sqlite } from "../db/client";
import { checkSchemaVersion, readMigrationJournal, type MigrationJournalEntry } from "../db/migrate";
import { AppError } from "./errors";
import { readMeta, readSettings, writeMeta } from "./settings";

const DAY = 86_400_000;
/** Skip the start-up backup when the newest automatic backup is younger than this. */
export const AUTO_BACKUP_INTERVAL_MS = 20 * 3_600_000;
/** Tables every Chokchai4 database has (used to recognise our backups). */
export const REQUIRED_TABLES = ["products", "transactions", "customers", "__drizzle_migrations"] as const;

/** Shown when a backup was made by a newer app version (its schema has migrations this app does not know). */
export const NEWER_BACKUP_MESSAGE = "ไฟล์สำรองนี้มาจากโปรแกรมเวอร์ชันใหม่กว่า กรุณาอัปเดตโปรแกรมก่อนกู้คืนข้อมูล";
/** Shown for a backup of a pre-release test build (before 0.1.0): its data is not carried over. */
export const LEGACY_BACKUP_MESSAGE = "ไฟล์สำรองนี้มาจากโปรแกรมรุ่นทดลองก่อนเวอร์ชัน 0.1.0 ใช้กับโปรแกรมเวอร์ชันนี้ไม่ได้";

const SQLITE_HEADER = "SQLite format 3\u0000";
const AUTO_RE = /^auto-(\d{8})-(\d{4})\.db$/i;

export const backupsDir = (userDataPath: string): string => path.join(userDataPath, "backups");

const p2 = (n: number) => String(n).padStart(2, "0");

/** Local-time stamp "YYYYMMDD-HHmm" (or "YYYYMMDD-HHmmss" with seconds). */
export function fileStamp(ms: number, withSeconds = false): string {
  const d = new Date(ms);
  const base = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  return withSeconds ? base + p2(d.getSeconds()) : base;
}

export const autoBackupName = (ms: number): string => `auto-${fileStamp(ms)}.db`;
export const beforeRestoreName = (ms: number): string => `before-restore-${fileStamp(ms, true)}.db`;
export const manualBackupName = (ms: number): string => `chokchai4-backup-${fileStamp(ms)}.db`;

/** Time encoded in an auto-*.db name (local time), or null. */
export function parseAutoBackupTime(name: string): number | null {
  const m = AUTO_RE.exec(name);
  if (!m) return null;
  const [, ymd, hm] = m;
  const t = new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hm.slice(0, 2), +hm.slice(2, 4)).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Adds "-2", "-3"... before the extension when the file already exists. */
function uniquePath(p: string): string {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const stem = p.slice(0, p.length - ext.length);
  for (let i = 2; ; i++) {
    const c = `${stem}-${i}${ext}`;
    if (!fs.existsSync(c)) return c;
  }
}

/**
 * Backups of a WAL database are WAL-mode files too; switch the copy to a classic rollback journal so it is
 * one self-contained file (no -wal/-shm sidecars appear next to it when it is opened later).
 */
function makeSelfContained(file: string): void {
  const db = new Database(file, { fileMustExist: true });
  try {
    db.pragma("journal_mode = DELETE");
  } finally {
    db.close();
  }
}

function removeQuietly(p: string): void {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Consistent online copy of an open database (better-sqlite3 backup API; safe while the app is writing).
 * Writes to a temp file next to `destPath` and renames it into place, so a failed backup never leaves
 * a half-written file behind.
 */
export async function performBackup(sqlite: Sqlite, destPath: string): Promise<string> {
  const dest = path.resolve(destPath);
  const tmp = `${dest}.${process.pid}-${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await sqlite.backup(tmp);
    makeSelfContained(tmp);
    fs.renameSync(tmp, dest);
  } catch (e) {
    removeQuietly(tmp);
    const code = (e as { code?: string })?.code ?? "";
    // fs errors (mkdir/rename) and SQLite's own errors when it cannot create the destination file.
    if (["EACCES", "EPERM", "EROFS", "SQLITE_CANTOPEN", "SQLITE_READONLY", "SQLITE_PERM", "SQLITE_AUTH"].includes(code)) {
      throw new AppError("VALIDATION", "ไม่มีสิทธิ์บันทึกไฟล์ในตำแหน่งนี้ กรุณาเลือกโฟลเดอร์อื่น");
    }
    if (code === "ENOSPC" || code === "SQLITE_FULL") throw new AppError("VALIDATION", "พื้นที่ดิสก์ไม่พอสำหรับสำรองข้อมูล");
    throw new AppError("INTERNAL", "สำรองข้อมูลไม่สำเร็จ: " + ((e as Error)?.message ?? String(e)));
  }
  return dest;
}

export interface BackupSummary {
  products: number;
  customers: number;
  transactions: number;
  /** Newest transactions.occurred_at, or null when there are none. */
  lastTransactionAt: number | null;
}

export interface ValidateBackupOptions {
  /**
   * The app's drizzle migrations folder. When given, a backup made by a newer app version (applied migrations
   * this app does not ship) is rejected. Older backups pass: `runMigrations` upgrades them on the next start.
   */
  migrationsFolder?: string;
}

/**
 * Checks that `filePath` is a healthy Chokchai4 database: SQLite header, PRAGMA integrity_check = ok, the
 * required tables exist and (with `migrationsFolder`) it is not from a newer app version.
 * Throws AppError (Thai message) otherwise. Opens the file read-only.
 */
export function validateBackupFile(filePath: string, opts: ValidateBackupOptions = {}): BackupSummary {
  const invalid = new AppError("VALIDATION", "ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของโปรแกรมนี้");
  let journal: MigrationJournalEntry[] | null = null;
  if (opts.migrationsFolder) {
    try {
      journal = readMigrationJournal(opts.migrationsFolder);
    } catch (e) {
      throw new AppError("INTERNAL", "อ่านข้อมูลเวอร์ชันฐานข้อมูลของโปรแกรมไม่ได้: " + ((e as Error)?.message ?? String(e)));
    }
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new AppError("NOT_FOUND", "ไม่พบไฟล์สำรองข้อมูล (อาจถูกย้ายหรือลบไปแล้ว)");
  }
  if (!stat.isFile() || stat.size < 512) throw invalid;

  // Cheap header check first so random files never reach SQLite.
  const header = Buffer.alloc(100);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, 100, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString("latin1", 0, 16) !== SQLITE_HEADER) throw invalid;
  // A WAL-mode file without its -wal sidecar is typically the live database copied while the app was running:
  // the newest data (sometimes even the tables) lives only in the missing -wal file.
  const walWithoutSidecar = header[18] === 2 && header[19] === 2 && !fs.existsSync(`${filePath}-wal`);

  let db: Database.Database | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const check = db.pragma("integrity_check", { simple: true });
    if (check !== "ok") throw new AppError("VALIDATION", "ไฟล์สำรองข้อมูลเสียหาย (ตรวจสอบความสมบูรณ์ไม่ผ่าน) กรุณาเลือกไฟล์อื่น");
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
    );
    if (!REQUIRED_TABLES.every((t) => tables.has(t))) {
      throw walWithoutSidecar
        ? new AppError(
            "VALIDATION",
            "ไฟล์นี้ถูกคัดลอกขณะที่โปรแกรมเปิดใช้งานอยู่ ข้อมูลในไฟล์จึงไม่ครบ กรุณาใช้ไฟล์ที่ได้จากปุ่ม “สำรองข้อมูลตอนนี้” แทน",
          )
        : invalid;
    }
    if (journal) {
      const version = checkSchemaVersion(db, journal);
      if (version.legacy) throw new AppError("VALIDATION", LEGACY_BACKUP_MESSAGE);
      if (version.newerThanApp) throw new AppError("VALIDATION", NEWER_BACKUP_MESSAGE);
    }
    // Informational only: an older backup may lack newer columns, which must not fail validation.
    const scalar = (sql: string): number | null => {
      try {
        return (db!.prepare(sql).pluck().get() as number | null) ?? null;
      } catch {
        return null;
      }
    };
    return {
      products: scalar("SELECT count(*) FROM products WHERE deleted_at IS NULL") ?? 0,
      customers: scalar("SELECT count(*) FROM customers WHERE deleted_at IS NULL") ?? 0,
      transactions: scalar("SELECT count(*) FROM transactions WHERE deleted_at IS NULL") ?? 0,
      lastTransactionAt: scalar("SELECT max(occurred_at) FROM transactions"),
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    const code = (e as { code?: string })?.code ?? "";
    if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") {
      throw new AppError("VALIDATION", "ไฟล์สำรองข้อมูลเสียหาย หรือไม่ใช่ไฟล์ฐานข้อมูล กรุณาเลือกไฟล์อื่น");
    }
    // Missing columns (very old / foreign DB) etc.
    if (code.startsWith("SQLITE_")) throw invalid;
    throw new AppError("INTERNAL", "เปิดไฟล์สำรองข้อมูลไม่ได้: " + ((e as Error)?.message ?? String(e)));
  } finally {
    db?.close();
  }
}

/** *.db files in `dir`, newest first. Missing dir -> []. */
export function listBackupFiles(dir: string): BackupFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: BackupFile[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".db")) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      out.push({ path: full, name, size: st.size, createdAt: Math.round(st.mtimeMs) });
    } catch {
      /* vanished */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

const autoBackupTime = (f: BackupFile): number => parseAutoBackupTime(f.name) ?? f.createdAt;

/**
 * Deletes automatic backups (auto-*.db only) older than `keepDays`. Other files are never touched.
 * `minKeep` newest automatic backups are always kept, whatever their age. Returns the deleted paths.
 */
export function pruneAutoBackups(dir: string, keepDays: number, now = Date.now(), opts: { minKeep?: number } = {}): string[] {
  const cutoff = now - Math.max(1, keepDays) * DAY;
  const autos = listBackupFiles(dir)
    .filter((f) => AUTO_RE.test(f.name))
    .sort((a, b) => autoBackupTime(b) - autoBackupTime(a));
  const deleted: string[] = [];
  autos.forEach((f, i) => {
    if (i < (opts.minKeep ?? 0)) return;
    if (autoBackupTime(f) >= cutoff) return;
    try {
      fs.rmSync(f.path);
      deleted.push(f.path);
    } catch (e) {
      console.error("[backup] could not delete", f.path, e);
    }
  });
  return deleted;
}

/** Newest automatic backup time: meta lastAutoBackupAt or the newest auto-*.db on disk. */
export function lastAutoBackupAt(ctx: ApiContext): number | null {
  const meta = readMeta<number>(ctx.db, "lastAutoBackupAt");
  const files = listBackupFiles(backupsDir(ctx.userDataPath)).filter((f) => AUTO_RE.test(f.name));
  const newestFile = files.length ? Math.max(...files.map(autoBackupTime)) : null;
  const candidates = [meta, newestFile].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return candidates.length ? Math.max(...candidates) : null;
}

/**
 * The start-up task: when auto backup is on and there is no automatic backup from the last 20 hours,
 * back up to backups/auto-YYYYMMDD-HHmm.db, record lastAutoBackupAt and prune old automatic backups.
 * Returns the new file path, or null when skipped.
 */
export async function runAutoBackup(ctx: ApiContext, now = Date.now()): Promise<string | null> {
  if (ctx.dbPath === ":memory:") return null;
  const { backup } = readSettings(ctx.db);
  if (!backup.autoBackup) return null;
  const last = lastAutoBackupAt(ctx);
  if (last !== null && now - last < AUTO_BACKUP_INTERVAL_MS && last <= now) return null;
  const dir = backupsDir(ctx.userDataPath);
  const dest = await performBackup(ctx.sqlite, uniquePath(path.join(dir, autoBackupName(now))));
  writeMeta(ctx.db, "lastAutoBackupAt", now);
  pruneAutoBackups(dir, backup.keepDays, now, { minKeep: 3 });
  return dest;
}

/** Safety copy of the live database, taken before it is replaced by a restore. */
export async function backupBeforeRestore(ctx: ApiContext, now = Date.now()): Promise<string> {
  return performBackup(ctx.sqlite, uniquePath(path.join(backupsDir(ctx.userDataPath), beforeRestoreName(now))));
}

/**
 * Turns the chosen backup into a validated, self-contained file next to the live DB, ready for
 * `swapInRestoredDb`. The chosen file is only ever read: it is copied (with its -wal sidecar, if any) into a
 * private temp file first, so validating it never leaves -shm/-wal files on the user's flash drive and a file
 * that changes or disappears half-way cannot hurt. Throws AppError (Thai message) when it is not a usable backup,
 * including a backup from a newer app version (checked against the journal in `opts.migrationsFolder`).
 */
export async function stageRestoreFile(sourcePath: string, dbPath: string, opts: { migrationsFolder: string }): Promise<string> {
  const validateOpts: ValidateBackupOptions = { migrationsFolder: opts.migrationsFolder };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    throw new AppError("NOT_FOUND", "ไม่พบไฟล์สำรองข้อมูล (อาจถูกย้ายหรือลบไปแล้ว)");
  }
  if (!stat.isFile()) throw new AppError("VALIDATION", "ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของโปรแกรมนี้");

  const stamp = `${process.pid}-${Date.now()}`;
  const raw = `${dbPath}.restore-${stamp}.src`;
  const staged = `${dbPath}.restore-${stamp}.tmp`;
  try {
    try {
      fs.copyFileSync(sourcePath, raw);
      if (fs.existsSync(`${sourcePath}-wal`)) fs.copyFileSync(`${sourcePath}-wal`, `${raw}-wal`);
    } catch (e) {
      throw new AppError("INTERNAL", "อ่านไฟล์สำรองข้อมูลไม่ได้: " + ((e as Error)?.message ?? String(e)));
    }
    validateBackupFile(raw, validateOpts);
    // Backup API (not a plain copy) so a -wal sidecar is folded in and the result is one consistent file.
    const src = new Database(raw, { fileMustExist: true });
    try {
      await src.backup(staged);
    } finally {
      src.close();
    }
    makeSelfContained(staged);
    validateBackupFile(staged, validateOpts);
    return staged;
  } catch (e) {
    removeQuietly(staged);
    if (e instanceof AppError) throw e;
    throw new AppError("INTERNAL", "คัดลอกไฟล์สำรองข้อมูลไม่สำเร็จ: " + ((e as Error)?.message ?? String(e)));
  } finally {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) removeQuietly(raw + suffix);
  }
}

/**
 * Removes leftovers of an interrupted backup / restore (temp files older than an hour):
 * "<backup>.<pid>-<ts>.tmp" in the backups folder and "<db>.restore-*" next to the database.
 * Returns the removed paths. Never throws.
 */
export function cleanupStaleTempFiles(ctx: Pick<ApiContext, "dbPath" | "userDataPath">, now = Date.now()): string[] {
  const removed: string[] = [];
  const sweep = (dir: string, match: (name: string) => boolean) => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!match(name)) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || now - st.mtimeMs < 3_600_000) continue;
        fs.rmSync(full, { force: true });
        removed.push(full);
      } catch {
        /* ignore */
      }
    }
  };
  sweep(backupsDir(ctx.userDataPath), (n) => /\.db\.\d+-\d+\.tmp$/i.test(n));
  if (ctx.dbPath !== ":memory:") {
    const base = path.basename(ctx.dbPath);
    sweep(path.dirname(ctx.dbPath), (n) => n.startsWith(`${base}.restore-`) || (n.startsWith(`${base}.`) && /\.\d+-\d+\.tmp$/.test(n)));
  }
  return removed;
}

/** Replaces the (closed) live DB with the staged file and removes stale WAL/SHM sidecars. */
export function swapInRestoredDb(stagedPath: string, dbPath: string): void {
  removeQuietly(`${dbPath}-wal`);
  removeQuietly(`${dbPath}-shm`);
  fs.renameSync(stagedPath, dbPath);
}

/** True when both paths point at the same file (case-insensitive on macOS/Windows). */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let r = path.resolve(p);
    try {
      r = fs.realpathSync(r);
    } catch {
      /* keep resolved */
    }
    return process.platform === "linux" ? r : r.toLowerCase();
  };
  return norm(a) === norm(b);
}
