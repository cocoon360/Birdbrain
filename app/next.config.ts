import type { NextConfig } from "next";

// `standalone` output is how we ship the Next.js backend as a sidecar next
// to the Tauri shell. It emits a self-contained `.next/standalone` bundle
// that can be run with `node server.js` without a node_modules lookup at
// runtime. The scripts/pack-sidecar.mjs helper copies the native
// better-sqlite3 binding into that bundle so it works once packaged.
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
