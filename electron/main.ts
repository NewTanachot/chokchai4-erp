import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_NAME } from "@shared/app";
import type { ErpHandlers } from "@shared/contract";
import { isLang } from "@shared/i18n";
import { createCoreApi } from "./api";
import { withAccessControl } from "./api/access";
import type { ApiContext } from "./api/context";
import { createPrintApi } from "./api/print";
import { newSession } from "./api/session";
import { readMeta, writeMeta } from "./api/settings";
import { appVersion, createSystemApi, runStartupTasks } from "./api/system";
import { loginTiles } from "./api/auth";
import { openDatabase } from "./db/client";
import { LegacyDatabaseError, runMigrations, SchemaNewerThanAppError } from "./db/migrate";
import { seedDefaults } from "./db/seed";
import { seedDemo } from "./dev/demo-seed";
import { onLanguageChange, setMainLanguage, tr } from "./i18n";
import { registerIpc } from "./ipc";
import { removeDatabaseFiles, removeLegacyDataDir } from "./legacy";
import { buildAppMenu } from "./menu";
import { registerAppProtocol, registerAppScheme } from "./protocol";
import { runScreenshotMode } from "./screenshot";
import { createMainWindow, DEV_URL, isTrustedUrl } from "./window";

const isDev = !app.isPackaged;

// Also names the data folder: <appData>/<APP_NAME>.
app.setName(APP_NAME);
// Tests / screenshots can point the app at a throwaway data directory.
if (process.env.ERP_USER_DATA) app.setPath("userData", process.env.ERP_USER_DATA);

registerAppScheme();

const screenshotMode = !!process.env.ERP_SCREENSHOT_DIR;
// Screenshot runs use their own throwaway data dir, so several may run next to the real app.
const hasInstanceLock = screenshotMode || app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

/** Project root in dev (overridable for parallel preview builds), app.asar when packaged. */
const appRoot = () => process.env.ERP_APP_ROOT || app.getAppPath();
const resourcePath = (...p: string[]) =>
  app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(appRoot(), ...p);

/** Modal error box (skipped in screenshot mode, where nobody could click it away). */
function showStartupError(title: string, message: string): void {
  console.error(`[startup] ${title}: ${message}`);
  if (!screenshotMode) dialog.showErrorBox(title, message);
}

async function bootstrap(): Promise<void> {
  // A second instance only forwards "second-instance" to the running one and quits.
  if (!hasInstanceLock) return;
  const userDataPath = app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });
  // Data of the pre-release test builds is not carried over (tests / screenshots use their own folder).
  if (!process.env.ERP_USER_DATA) {
    try {
      if (removeLegacyDataDir(app.getPath("appData"), userDataPath)) console.log("[startup] removed the data of the test builds");
    } catch (e) {
      console.error("[startup] could not remove the data of the test builds", e);
    }
  }
  const dbPath = path.join(userDataPath, "chokchai4.db");
  const migrationsFolder = resourcePath("drizzle");
  let { sqlite, db } = openDatabase(dbPath);
  try {
    try {
      runMigrations(db, migrationsFolder);
    } catch (e) {
      if (!(e instanceof LegacyDatabaseError)) throw e;
      // A test-build database copied into the new folder: start a new one instead.
      console.warn("[startup]", e.message);
      sqlite.close();
      removeDatabaseFiles(dbPath);
      ({ sqlite, db } = openDatabase(dbPath));
      runMigrations(db, migrationsFolder);
    }
  } catch (e) {
    sqlite.close();
    if (e instanceof SchemaNewerThanAppError) {
      // The data was last used by a newer version (the user installed an older one): never run on a schema this
      // version does not know. runMigrations checks before writing anything, so the data is untouched.
      console.error("[startup]", e.message);
      showStartupError(
        tr("ไม่สามารถเปิดโปรแกรมได้"),
        tr("ข้อมูลในเครื่องนี้ถูกใช้งานกับโปรแกรม {0} เวอร์ชันที่ใหม่กว่าเวอร์ชันนี้ ({1})", APP_NAME, appVersion()) +
          "\n\n" +
          tr("กรุณาติดตั้งโปรแกรมเวอร์ชันล่าสุด แล้วเปิดโปรแกรมอีกครั้ง") +
          "\n" +
          tr("ข้อมูลของคุณยังอยู่ครบ และไม่ได้ถูกแก้ไข") +
          "\n\n" +
          tr("ไฟล์ข้อมูล: {0}", dbPath),
      );
      app.exit(1);
      return;
    }
    throw e;
  }
  seedDefaults(db);
  // Dev / screenshot runs may force the language (ERP_LANGUAGE=en).
  const forced = process.env.ERP_LANGUAGE;
  if (!app.isPackaged && isLang(forced)) writeMeta(db, "language", forced);
  const savedLanguage = readMeta<unknown>(db, "language");
  if (isLang(savedLanguage)) setMainLanguage(savedLanguage);

  const ctx: ApiContext = { db, sqlite, dbPath, userDataPath, session: newSession() };
  const core = createCoreApi(ctx);
  const api: ErpHandlers = { ...core, print: createPrintApi(ctx), system: createSystemApi(ctx, { migrationsFolder }) };
  // Every call from the renderer goes through the access rules (login + permissions).
  registerIpc(withAccessControl(api, ctx), isTrustedUrl);

  if (process.env.ERP_DEMO_SEED === "1") await seedDemo(ctx);
  // Dev / screenshot runs only (never in the installed app): start logged in as this user name.
  const autoLogin = process.env.ERP_AUTO_LOGIN;
  if (autoLogin && !app.isPackaged) {
    const tile = loginTiles(db).find((u) => u.name === autoLogin);
    if (tile) ctx.session.userId = tile.id;
    else console.warn(`[startup] ERP_AUTO_LOGIN: no active user named "${autoLogin}"`);
  }
  void Promise.resolve(runStartupTasks(ctx)).catch((e) => console.error("[startup] tasks failed", e));

  if (!DEV_URL) registerAppProtocol(path.join(appRoot(), process.env.ERP_OUT_DIR || "out"));
  buildAppMenu(isDev);
  onLanguageChange(() => buildAppMenu(isDev));

  if (process.platform === "darwin" && isDev) {
    const icon = path.join(appRoot(), "build", "icon.png");
    if (fs.existsSync(icon)) app.dock?.setIcon(icon);
  }

  mainWindow = createMainWindow({ show: !screenshotMode || process.env.ERP_SCREENSHOT_SHOW === "1" });
  mainWindow.on("closed", () => (mainWindow = null));
  if (screenshotMode) {
    mainWindow.webContents.once("did-finish-load", () => void runScreenshotMode(mainWindow!));
  }

  app.on("before-quit", () => {
    try {
      sqlite.close();
    } catch {
      /* already closed */
    }
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.whenReady().then(bootstrap).catch((e) => {
  console.error("Failed to start", e);
  showStartupError(tr("ไม่สามารถเปิดโปรแกรมได้"), tr("เกิดข้อผิดพลาดขณะเปิดโปรแกรม: {0}", (e as Error)?.message ?? String(e)));
  app.exit(1);
});
