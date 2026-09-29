// electron-builder afterPack hook: keep only the better-sqlite3 prebuilt binary of the target OS/arch.
// File patterns cannot express this: their ${platform} macro is the build machine's OS (Windows is cross-built
// on a Mac), and platform-level `files:` lists replace the top-level whitelist (the whole repo got packed).
const fs = require("node:fs");
const path = require("node:path");
const { Arch } = require("builder-util");

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  const resources =
    platform === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const dir = path.join(resources, "app.asar.unpacked", "node_modules", "better-sqlite3", "prebuilds");
  const keep = `${platform}-${arch}.node`;
  if (!fs.existsSync(path.join(dir, keep))) throw new Error(`better-sqlite3 prebuild ${keep} is missing in ${dir}`);
  for (const name of fs.readdirSync(dir)) if (name !== keep) fs.rmSync(path.join(dir, name));
};
