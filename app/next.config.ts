import type { NextConfig } from "next";

// `standalone` output is only for the packaged Tauri sidecar. Normal dev/build
// should use Next's default output so `next dev` and `next start` manage their
// own manifests normally.
//
// Builds use webpack (`npm run build` → `next build --webpack`) so
// Turbopack’s NFT trace does not pull the whole tree via server routes that
// probe the filesystem for the cursor-agent binary.
const nextConfig: NextConfig = {
  ...(process.env.BIRDBRAIN_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
