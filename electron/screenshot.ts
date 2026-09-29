import { app, nativeTheme, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getAppUrl } from "./window";

interface Shot {
  route: string;
  /** Optional JS run in the page after it loads (e.g. click a button to open a dialog). */
  js?: string;
  /** File name stem; defaults to a slug of the route. */
  name?: string;
}

/**
 * Dev tool driven by scripts/screenshot.mjs. Captures each route (light and/or dark) to PNG, then quits.
 * Env: ERP_SCREENSHOT_DIR, ERP_SCREENSHOT_ROUTES ("/,/products/") or ERP_SCREENSHOT_ROUTES_JSON
 * ('[{"route":"/products/","js":"...","name":"x"}]'), ERP_SCREENSHOT_THEMES, ERP_SCREENSHOT_DELAY, ERP_SCREENSHOT_SIZE.
 */
export async function runScreenshotMode(win: BrowserWindow): Promise<void> {
  const dir = process.env.ERP_SCREENSHOT_DIR!;
  const shots: Shot[] = process.env.ERP_SCREENSHOT_ROUTES_JSON
    ? JSON.parse(process.env.ERP_SCREENSHOT_ROUTES_JSON)
    : (process.env.ERP_SCREENSHOT_ROUTES || "/")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
        .map((route) => ({ route }));
  const themes = (process.env.ERP_SCREENSHOT_THEMES || "light").split(",") as ("light" | "dark")[];
  const delay = Number(process.env.ERP_SCREENSHOT_DELAY || 1500);
  const [w, h] = (process.env.ERP_SCREENSHOT_SIZE || "1360x860").split("x").map(Number);
  if (w && h) win.setContentSize(w, h);
  fs.mkdirSync(dir, { recursive: true });
  const errors: string[] = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(`[console] ${details.message}`);
  });
  for (const theme of themes) {
    nativeTheme.themeSource = theme;
    for (const shot of shots) {
      const stem = shot.name || shot.route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
      try {
        await win.loadURL(getAppUrl(shot.route));
        // next-themes stores an explicit choice in localStorage; force "system" so nativeTheme wins.
        await win.webContents.executeJavaScript(
          `try{localStorage.setItem('theme','system')}catch{}; document.documentElement.classList.toggle('dark', ${theme === "dark"}); 0`,
        );
        await new Promise((r) => setTimeout(r, delay));
        if (shot.js) {
          await win.webContents.executeJavaScript(`(async () => { ${shot.js} })().then(() => 0)`);
          await new Promise((r) => setTimeout(r, Math.max(800, delay / 2)));
        }
        const image = await win.webContents.capturePage();
        const name = `${stem}.${theme}.png`;
        fs.writeFileSync(path.join(dir, name), image.toPNG());
        console.log(`[screenshot] ${shot.route} (${theme}) -> ${name}`);
      } catch (e) {
        errors.push(`[screenshot] ${shot.route}: ${String(e)}`);
      }
    }
  }
  fs.writeFileSync(path.join(dir, "console-errors.txt"), errors.join("\n"));
  app.exit(0);
}
