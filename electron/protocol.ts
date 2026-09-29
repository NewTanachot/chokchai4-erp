import { net, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const APP_SCHEME = "app";
export const APP_ORIGIN = `${APP_SCHEME}://erp`;

/** Must run before app "ready". */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'self'",
].join("; ");

function resolveFile(root: string, pathname: string): string | null {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = path.normalize(path.join(root, rel));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null; // path traversal
  const tries = pathname.endsWith("/")
    ? [path.join(candidate, "index.html")]
    : [candidate, candidate + ".html", path.join(candidate, "index.html")];
  for (const f of tries) {
    try {
      if (fs.statSync(f).isFile()) return f;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Serves the Next.js static export (out/) at app://erp/. */
export function registerAppProtocol(outDir: string): void {
  const root = path.resolve(outDir);
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    let file = resolveFile(root, url.pathname);
    let status = 200;
    if (!file) {
      file = resolveFile(root, "/404.html");
      status = 404;
      if (!file) return new Response("Not found", { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    if (file.endsWith(".html")) headers.set("Content-Security-Policy", CSP);
    return new Response(res.body, { status, headers });
  });
}
