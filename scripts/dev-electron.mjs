// Dev runner: waits for `next dev`, bundles main/preload in watch mode, (re)starts Electron on change.
import { fork, spawn } from "node:child_process";
import { electronBinary, electronEnv } from "./electron-env.mjs";

const DEV_URL = process.env.ERP_DEV_URL || "http://localhost:3123";

async function waitForServer(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Next dev server did not start at ${url}`);
}

let child = null;
let restarting = false;

const electronBin = electronBinary();

function startElectron() {
  child = spawn(electronBin, ["."], { stdio: "inherit", env: electronEnv({ ERP_DEV_URL: DEV_URL, NODE_ENV: "development" }) });
  child.on("exit", (code) => {
    if (!restarting) process.exit(code ?? 0);
  });
}

function restartElectron() {
  if (!child) return startElectron();
  restarting = true;
  child.once("exit", () => {
    restarting = false;
    startElectron();
  });
  child.kill();
}

await waitForServer(DEV_URL);
let first = true;
const builder = fork(new URL("./build-electron.mjs", import.meta.url), ["--watch"], { stdio: "inherit" });
let timer = null;
builder.on("message", (m) => {
  if (m?.type !== "rebuilt") return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (first) {
      first = false;
      startElectron();
    } else {
      console.log("[dev] main/preload changed - restarting Electron");
      restartElectron();
    }
  }, 300);
});

const shutdown = () => {
  builder.kill();
  child?.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
