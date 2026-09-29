// Captures PNG screenshots of app routes using a throwaway database (optionally with demo data).
//
// Production-build mode (after `npm run build`):
//   node scripts/screenshot.mjs --demo --out screenshots
//
// Dev-server mode (no full build needed; safe to run several in parallel with different ports):
//   node scripts/screenshot.mjs --dev 3201 --demo --routes "/products/" --themes light,dark --out /tmp/shots
//   -> starts `next dev` on that port (own .next-<port> dir), bundles main/preload into dist-electron-<port>,
//      captures, then shuts everything down.
//
// Interactions: --routes-file shots.json  with [{"route":"/products/","js":"document.querySelector('[data-shot=new]').click()","name":"products-new"}]
// Other options: --keep-data DIR (reuse/keep the SQLite data dir), --delay MS (wait after load, default 1500),
//                --size 1360x860 (window size), --login NAME (start logged in as that user; with --demo the default
//                is the demo owner "เจ้าของร้าน"; "none" = stay on the login screen), --lang en (program language)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { electronBinary, electronEnv } from "./electron-env.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const outDir = path.resolve(opt("--out", "screenshots"));
const routes = opt("--routes", "/,/transactions/,/transactions/new/?type=sale,/products/,/services/,/customers/,/reports/,/settings/");
const themes = opt("--themes", "light,dark");
const delay = opt("--delay", "1500");
const devPort = opt("--dev", null);
// Electron's app.setPath() throws on relative paths (and then hangs on a hidden error dialog).
const dataDir = path.resolve(opt("--keep-data", null) ?? fs.mkdtempSync(path.join(os.tmpdir(), "chokchai4-shot-")));
fs.mkdirSync(dataDir, { recursive: true });

let nextProc = null;
let electronArgs = ["."];
const extraEnv = {};

async function waitForServer(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server did not start at ${url}`);
}

function cleanup() {
  if (nextProc && !nextProc.killed) {
    try {
      process.kill(-nextProc.pid, "SIGTERM");
    } catch {
      nextProc.kill("SIGTERM");
    }
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

if (devPort) {
  const url = `http://localhost:${devPort}`;
  const previewTsconfig = `tsconfig.preview-${devPort}.json`;
  fs.writeFileSync(path.join(root, previewTsconfig), JSON.stringify({ extends: "./tsconfig.json" }, null, 2));
  nextProc = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--port", devPort], {
    cwd: root,
    env: { ...process.env, NEXT_DIST_DIR: `.next-${devPort}`, NEXT_TSCONFIG: previewTsconfig, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const logFile = path.join(outDir, `next-dev-${devPort}.log`);
  fs.mkdirSync(outDir, { recursive: true });
  const log = fs.createWriteStream(logFile);
  nextProc.stdout.pipe(log);
  nextProc.stderr.pipe(log);
  const electronOut = `dist-electron-${devPort}`;
  const b = spawnSync(process.execPath, [path.join(root, "scripts/build-electron.mjs")], {
    cwd: root,
    env: { ...process.env, ERP_ELECTRON_OUT: electronOut },
    stdio: "inherit",
  });
  if (b.status !== 0) {
    console.error("[screenshot] electron bundle failed");
    process.exit(1);
  }
  await waitForServer(url);
  electronArgs = [path.join(root, electronOut, "main.cjs")];
  Object.assign(extraEnv, { ERP_DEV_URL: url, ERP_APP_ROOT: root });
  console.log(`[screenshot] next dev on ${url} (log: ${logFile})`);
}

const electronBin = electronBinary();
const size = opt("--size", "1360x860");
const routesFile = opt("--routes-file", null);
if (routesFile) extraEnv.ERP_SCREENSHOT_ROUTES_JSON = fs.readFileSync(path.resolve(routesFile), "utf8");
const child = spawn(electronBin, electronArgs, {
  cwd: root,
  stdio: "inherit",
  env: electronEnv({
    ...extraEnv,
    ERP_USER_DATA: dataDir,
    ERP_SCREENSHOT_DIR: outDir,
    ERP_SCREENSHOT_ROUTES: routes,
    ERP_SCREENSHOT_THEMES: themes,
    ERP_SCREENSHOT_DELAY: delay,
    ERP_SCREENSHOT_SIZE: size,
    ERP_DEMO_SEED: args.includes("--demo") ? "1" : "0",
    ERP_LANGUAGE: opt("--lang", ""),
    ERP_AUTO_LOGIN: (() => {
      const login = opt("--login", args.includes("--demo") ? "เจ้าของร้าน" : "none");
      return login === "none" ? "" : login;
    })(),
  }),
});
const timeout = setTimeout(() => {
  console.error("[screenshot] timed out");
  child.kill();
  process.exit(1);
}, 300_000);
child.on("exit", (code) => {
  clearTimeout(timeout);
  console.log(`[screenshot] done -> ${outDir} (data: ${dataDir})`);
  process.exit(code ?? 0);
});
