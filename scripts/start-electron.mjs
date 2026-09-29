// Runs the production build (out/ + dist-electron/) without packaging. Run `npm run build` first.
import { spawn } from "node:child_process";
import { electronBinary, electronEnv } from "./electron-env.mjs";

const electronBin = electronBinary();
const child = spawn(electronBin, ["."], { stdio: "inherit", env: electronEnv() });
child.on("exit", (code) => process.exit(code ?? 0));
