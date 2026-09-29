import { BrowserWindow, dialog, nativeTheme, shell } from "electron";
import path from "node:path";
import { APP_NAME } from "@shared/app";
import { tr } from "./i18n";
import { APP_ORIGIN } from "./protocol";

/** Set by scripts/dev-electron.mjs to the Next dev server, e.g. http://localhost:3123 */
export const DEV_URL = process.env.ERP_DEV_URL || null;

export const appOrigin = (): string => DEV_URL ?? APP_ORIGIN;

/**
 * URL of a renderer route. `route` is a path like "/print/?id=..." (keep the trailing
 * slash before "?" - the static export uses trailingSlash: true).
 */
export function getAppUrl(route = "/"): string {
  return appOrigin() + (route.startsWith("/") ? route : "/" + route);
}

export function isTrustedUrl(url: string): boolean {
  return url === appOrigin() || url.startsWith(appOrigin() + "/");
}

export const preloadPath = (): string => path.join(__dirname, "preload.cjs");

/** Shared secure webPreferences for every window that loads the renderer. */
export function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
  };
}

function hardenNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isTrustedUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
}

export function createMainWindow(opts: { show?: boolean } = {}): BrowserWindow {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#161827" : "#f5f6fa",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    autoHideMenuBar: !isMac,
    icon: isMac ? undefined : path.join(__dirname, "..", "build", "icon-win.png"),
    webPreferences: secureWebPreferences(),
  });
  hardenNavigation(win);
  confirmUnsavedOnClose(win);
  if (opts.show !== false) win.once("ready-to-show", () => win.show());
  void win.loadURL(getAppUrl("/"));
  return win;
}

/**
 * A page with unsaved work (the bill form registers `beforeunload` while it has changes) asks before the window
 * closes, the app quits or the page reloads. Hidden windows (screenshot runs) never block.
 */
function confirmUnsavedOnClose(win: BrowserWindow): void {
  win.webContents.on("will-prevent-unload", (event) => {
    if (!win.isVisible()) {
      event.preventDefault();
      return;
    }
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: [tr("ออกโดยไม่บันทึก"), tr("กลับไปแก้ไข")],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: tr("ยังไม่ได้บันทึก"),
      message: tr("บิลที่กำลังเปิดอยู่ยังไม่ได้บันทึก"),
      detail: tr("ถ้าออกตอนนี้ ข้อมูลที่กรอกไว้จะหายไป"),
    });
    // preventDefault ignores the page's beforeunload, i.e. lets it close.
    if (choice === 0) event.preventDefault();
  });
}

/** Hidden window used for printing / PDF export. Caller must destroy it. */
export function createHiddenRendererWindow(width = 800, height = 1000): BrowserWindow {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: { ...secureWebPreferences(), backgroundThrottling: false },
  });
  hardenNavigation(win);
  return win;
}
