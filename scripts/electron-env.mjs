// Shared helpers for scripts that launch Electron.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

/** Environment for spawning Electron. ELECTRON_RUN_AS_NODE (set by some editors/tools) would turn it into plain Node. */
export function electronEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * Absolute path of the Electron binary for dev / unpackaged runs.
 *
 * macOS: node_modules' Electron.app shows "Electron" in the menu bar (Info.plist CFBundleName) and in the Dock
 * tooltip (the bundle's folder name). So this runs a copy named after package.json `productName`:
 * node_modules/.cache/electron-dev/<productName>.app (an APFS clone, so it costs no disk space), with CFBundleName /
 * CFBundleDisplayName set to that name. Its ad-hoc signature does not cover Info.plist, so it still launches.
 * Refreshed when the Electron version or the name changes; installers are not affected (electron-builder packs its
 * own copy of Electron).
 */
export function electronBinary() {
  const bin = require("electron");
  if (process.platform !== "darwin") return bin;
  const name = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).productName;
  const srcApp = path.resolve(path.dirname(bin), "..", "..");
  if (!name || !srcApp.endsWith(".app")) return bin;
  const devDir = path.join(root, "node_modules", ".cache", "electron-dev");
  const app = path.join(devDir, `${name}.app`);
  const devBin = path.join(app, path.relative(srcApp, bin));
  const stampFile = path.join(devDir, "stamp");
  const stamp = `${fs.readFileSync(path.join(path.dirname(srcApp), "version"), "utf8").trim()}\n${name}`;
  const current = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, "utf8") : null;
  if (current === stamp && fs.existsSync(devBin)) return devBin;
  try {
    fs.rmSync(devDir, { recursive: true, force: true });
    fs.mkdirSync(devDir, { recursive: true });
    try {
      execFileSync("cp", ["-cR", srcApp, app]); // APFS clone
    } catch {
      fs.rmSync(app, { recursive: true, force: true });
      execFileSync("cp", ["-R", srcApp, app]);
    }
    const plist = path.join(app, "Contents", "Info.plist");
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) execFileSync("plutil", ["-replace", key, "-string", name, plist]);
    // Let the Dock / Finder pick up the new bundle.
    execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", app]);
    fs.writeFileSync(stampFile, stamp);
    console.log(`[electron] dev app: ${path.relative(root, app)}`);
    return devBin;
  } catch (e) {
    console.warn(`[electron] could not create the named dev app, using Electron.app: ${e.message}`);
    return bin;
  }
}
