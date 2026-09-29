import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Parallel dev servers (e.g. several preview sessions) need separate build dirs.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
  // Preview dev servers use their own tsconfig copy so Next doesn't rewrite the main one.
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG || "tsconfig.json" },
};

export default nextConfig;
