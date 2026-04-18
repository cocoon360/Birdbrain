//! `tauri-build` requires every `bundle.resources` path to exist at compile time.
//!
//! The sidecar **must not** live under `app/.next/`: `next dev` constantly rewrites `.next/`,
//! which triggers Cargo rebuilds (`rerun-if-changed` on the resource) and makes `tauri dev`
//! restart in a tight loop (window flashes; UI feels frozen / unclickable).
//!
//! - **Dev:** ensure `bundle/sidecar` exists (empty is fine).
//! - **Release:** `beforeBuildCommand` runs `build:sidecar`; `pack-sidecar.mjs` mirrors
//!   `.next/standalone` into this folder before `cargo tauri build`.

use std::path::PathBuf;

fn main() {
    let sidecar = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bundle/sidecar");
    if !sidecar.exists() {
        std::fs::create_dir_all(&sidecar).unwrap_or_else(|e| {
            panic!(
                "failed to create placeholder {} for tauri-build ({}).\n\
                 For a production bundle, run from app/: npm run build:sidecar",
                sidecar.display(),
                e
            );
        });
    }
    tauri_build::build()
}
