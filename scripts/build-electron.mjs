// Bundles the Electron main + preload scripts (TypeScript) into dist-electron/.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const outdir = process.env.ERP_ELECTRON_OUT || "dist-electron";

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: true,
  logLevel: "info",
  tsconfig: "tsconfig.json",
  outExtension: { ".js": ".cjs" },
};

const configs = [
  { ...common, entryPoints: { main: "electron/main.ts" }, outdir, external: ["electron", "better-sqlite3"] },
  // Sandboxed preload: may only require "electron", everything else must be bundled.
  { ...common, entryPoints: { preload: "electron/preload.ts" }, outdir, external: ["electron"] },
];

if (watch) {
  const ctxs = await Promise.all(
    configs.map((c) =>
      esbuild.context({
        ...c,
        plugins: [
          {
            name: "notify",
            setup(build) {
              build.onEnd((r) => {
                if (r.errors.length === 0 && process.send) process.send({ type: "rebuilt" });
              });
            },
          },
        ],
      }),
    ),
  );
  await Promise.all(ctxs.map((c) => c.watch()));
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
