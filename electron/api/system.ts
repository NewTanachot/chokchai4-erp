/**
 * system.* - desktop-only capabilities: app info, backup / restore, opening folders and links.
 * Pure file/DB logic lives in ./backup.ts (tested without Electron); this file adds dialogs, shell and relaunch.
 * Electron is imported lazily so importing this module never requires a running Electron app.
 */
import fs from "node:fs";
import path from "node:path";
import { restoreInputSchema, setLanguageSchema, type SystemApi, type Handlers } from "@shared/contract";
import { setMainLanguage, tr } from "../i18n";
import type { ApiContext } from "./context";
import { AppError } from "./errors";
import { readMeta, writeMeta } from "./settings";
import {
  backupBeforeRestore,
  backupsDir,
  cleanupStaleTempFiles,
  lastAutoBackupAt,
  listBackupFiles,
  manualBackupName,
  performBackup,
  runAutoBackup,
  samePath,
  stageRestoreFile,
  swapInRestoredDb,
  validateBackupFile,
} from "./backup";

type ElectronModule = typeof import("electron");
const electron = (): ElectronModule => require("electron") as ElectronModule;

const dbFilters = () => [{ name: tr("ไฟล์สำรองข้อมูล (.db)"), extensions: ["db"] }];

/** The app's version (package.json in dev, app.getVersion() when packaged). */
export function appVersion(): string {
  const { app } = electron();
  if (!app.isPackaged) {
    // Dev / screenshot runs may start Electron from a bundle dir without package.json.
    try {
      const root = process.env.ERP_APP_ROOT || app.getAppPath();
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* fall back */
    }
  }
  return app.getVersion();
}

function parentWindow(): Electron.BrowserWindow | undefined {
  const { BrowserWindow } = electron();
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
}

function existingDir(p: string | null | undefined): string | null {
  if (!p) return null;
  try {
    return fs.statSync(p).isDirectory() ? p : null;
  } catch {
    return null;
  }
}

let restoring = false;

export interface SystemApiOptions {
  /** The drizzle folder the app migrates with (resources/drizzle when packaged): restore rejects newer backups. */
  migrationsFolder: string;
}

export function createSystemApi(ctx: ApiContext, opts: SystemApiOptions): Handlers<SystemApi> {
  const { db } = ctx;
  const backupsPath = backupsDir(ctx.userDataPath);

  return {
    info: () => {
      const { app } = electron();
      return {
        appName: app.getName(),
        version: appVersion(),
        platform: process.platform,
        dbPath: ctx.dbPath,
        userDataPath: ctx.userDataPath,
        backupsPath,
        lastAutoBackupAt: lastAutoBackupAt(ctx),
      };
    },

    backup: async () => {
      const { app, dialog } = electron();
      const dir = existingDir(readMeta<string>(db, "lastBackupDir")) ?? app.getPath("documents");
      const opts: Electron.SaveDialogOptions = {
        title: tr("สำรองข้อมูล"),
        buttonLabel: tr("บันทึกไฟล์สำรอง"),
        defaultPath: path.join(dir, manualBackupName(Date.now())),
        filters: dbFilters(),
        properties: ["createDirectory", "showOverwriteConfirmation"],
      };
      const win = parentWindow();
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return null;
      let dest = res.filePath;
      if (path.extname(dest).toLowerCase() !== ".db") dest += ".db";
      if (samePath(dest, ctx.dbPath)) throw new AppError("VALIDATION", "ไม่สามารถบันทึกทับฐานข้อมูลที่ใช้งานอยู่ได้ กรุณาเลือกชื่อไฟล์อื่น");
      const saved = await performBackup(ctx.sqlite, dest);
      validateBackupFile(saved);
      writeMeta(db, "lastBackupDir", path.dirname(saved));
      writeMeta(db, "lastManualBackupAt", Date.now());
      return { path: saved };
    },

    listBackups: () => listBackupFiles(backupsPath),

    restore: async (input) => {
      const parsed = restoreInputSchema.parse(input);
      if (restoring) throw new AppError("CONFLICT", "กำลังกู้คืนข้อมูลอยู่ กรุณารอสักครู่");
      if (ctx.dbPath === ":memory:") throw new AppError("VALIDATION", "ฐานข้อมูลนี้ไม่รองรับการกู้คืน");
      let source = parsed?.path?.trim() || null;
      if (!source) {
        const { app, dialog } = electron();
        const dir = existingDir(readMeta<string>(db, "lastBackupDir")) ?? app.getPath("documents");
        const opts: Electron.OpenDialogOptions = {
          title: tr("เลือกไฟล์สำรองข้อมูลที่ต้องการกู้คืน"),
          buttonLabel: tr("กู้คืนจากไฟล์นี้"),
          defaultPath: dir,
          filters: dbFilters(),
          properties: ["openFile"],
        };
        const win = parentWindow();
        const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        if (res.canceled || !res.filePaths[0]) return { restored: false };
        source = res.filePaths[0];
      }
      if (samePath(source, ctx.dbPath)) throw new AppError("VALIDATION", "ไฟล์นี้คือฐานข้อมูลที่กำลังใช้งานอยู่ กรุณาเลือกไฟล์สำรองข้อมูล");

      restoring = true;
      let staged: string | null = null;
      try {
        // 1) validated, self-contained private copy of the chosen backup (the chosen file is only read),
        // 2) safety copy of today's data - both before anything is replaced.
        staged = await stageRestoreFile(source, ctx.dbPath, { migrationsFolder: opts.migrationsFolder });
        const safety = await backupBeforeRestore(ctx);
        console.log(`[restore] safety copy: ${safety}; restoring from ${source}`);
      } catch (e) {
        restoring = false;
        if (staged) fs.rmSync(staged, { force: true });
        throw e;
      }

      // Point of no return: close the live DB, swap files, relaunch (migrations upgrade older backups).
      try {
        ctx.sqlite.close();
      } catch (e) {
        console.error("[restore] close failed", e);
      }
      try {
        swapInRestoredDb(staged, ctx.dbPath);
      } catch (e) {
        // The original file is untouched (rename is atomic) - relaunching simply reopens today's data.
        console.error("[restore] swap failed", e);
      }
      // Let this IPC reply reach the renderer before the app goes away.
      setTimeout(() => {
        const { app } = electron();
        app.relaunch();
        app.exit(0);
      }, 400);
      return { restored: true };
    },

    openDataFolder: async () => {
      const { shell } = electron();
      fs.mkdirSync(ctx.userDataPath, { recursive: true });
      const err = await shell.openPath(ctx.userDataPath);
      if (err) throw new AppError("INTERNAL", "เปิดโฟลเดอร์ข้อมูลไม่ได้: " + err);
    },

    openExternal: async (input) => {
      if (typeof input !== "string" || input.length > 2000) throw new AppError("VALIDATION", "ลิงก์ไม่ถูกต้อง");
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        throw new AppError("VALIDATION", "ลิงก์ไม่ถูกต้อง");
      }
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
        throw new AppError("VALIDATION", "เปิดได้เฉพาะลิงก์เว็บไซต์ (http/https) หรืออีเมลเท่านั้น");
      }
      await electron().shell.openExternal(url.toString());
    },

    setLanguage: (input) => {
      const { language } = setLanguageSchema.parse(input);
      writeMeta(db, "language", language);
      setMainLanguage(language);
    },
  };
}

/** Called once after start-up: automatic daily backup (+ pruning). Never throws. */
export async function runStartupTasks(ctx: ApiContext): Promise<void> {
  try {
    const removed = cleanupStaleTempFiles(ctx);
    if (removed.length) console.log(`[startup] removed ${removed.length} stale temp file(s)`);
  } catch (e) {
    console.error("[startup] temp cleanup failed", e);
  }
  try {
    const file = await runAutoBackup(ctx);
    if (file) console.log(`[startup] auto backup -> ${file}`);
  } catch (e) {
    console.error("[startup] auto backup failed", e);
  }
}
