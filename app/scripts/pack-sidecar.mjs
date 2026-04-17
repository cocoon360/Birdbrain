#!/usr/bin/env node
// Bundles the Next.js standalone build into a self-contained sidecar
// directory that Tauri can ship as externalBin. Specifically:
//   1. Copies the native better-sqlite3 addon (Node loads it at runtime so
//      the standalone output alone is not enough).
//   2. Copies the static assets `.next/static/` next to the server output.
//   3. Copies the `public/` folder so the served assets line up.
//
// The result is `.next/standalone/` which can be invoked with
// `node server.js`. Wrap that in a platform-specific launcher script or
// point Tauri's externalBin at the node binary alongside the bundle.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const standalone = path.join(appRoot, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.error(
    "pack-sidecar: .next/standalone not found. Run `next build` first (with `output: 'standalone'` in next.config)."
  );
  process.exit(1);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(from);
      try {
        fs.symlinkSync(target, to);
      } catch {
        fs.copyFileSync(from, to);
      }
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

const staticSrc = path.join(appRoot, ".next", "static");
const staticDest = path.join(standalone, ".next", "static");
console.log("copying .next/static → standalone/.next/static");
copyDir(staticSrc, staticDest);

const publicSrc = path.join(appRoot, "public");
if (fs.existsSync(publicSrc)) {
  const publicDest = path.join(standalone, "public");
  console.log("copying public → standalone/public");
  copyDir(publicSrc, publicDest);
}

const nativeSrc = path.join(appRoot, "node_modules", "better-sqlite3");
const nativeDest = path.join(standalone, "node_modules", "better-sqlite3");
if (fs.existsSync(nativeSrc)) {
  console.log("copying better-sqlite3 native addon → standalone/node_modules/better-sqlite3");
  copyDir(nativeSrc, nativeDest);
} else {
  console.warn("pack-sidecar: better-sqlite3 node_module not found; runtime will fail without it");
}

const bindingsSrc = path.join(appRoot, "node_modules", "bindings");
const bindingsDest = path.join(standalone, "node_modules", "bindings");
if (fs.existsSync(bindingsSrc)) {
  copyDir(bindingsSrc, bindingsDest);
}
const fileUriToPathSrc = path.join(appRoot, "node_modules", "file-uri-to-path");
const fileUriToPathDest = path.join(standalone, "node_modules", "file-uri-to-path");
if (fs.existsSync(fileUriToPathSrc)) {
  copyDir(fileUriToPathSrc, fileUriToPathDest);
}

console.log("sidecar packaged at:", standalone);
