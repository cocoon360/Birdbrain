use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

// SidecarState owns the Next.js server process that Bird Brain runs
// alongside the Tauri shell. In dev we don't spawn anything (Tauri's
// beforeDevCommand already ran `npm run dev`). In bundled builds we
// spawn `node <resource_dir>/sidecar/server.js`, which is the standalone
// output produced by `npm run build:sidecar`.

pub struct SidecarState {
    child: Mutex<Option<Child>>,
    port: u16,
}

impl SidecarState {
    pub fn spawn(handle: &AppHandle) -> Result<Self> {
        if cfg!(debug_assertions) {
            return Ok(Self {
                child: Mutex::new(None),
                // Match `build.devUrl` / `next dev` so the webview origin lines up with the dev server.
                port: 3000,
            });
        }

        let port = pick_port();
        let sidecar_dir = locate_sidecar_dir(handle)?;
        let server_js = sidecar_dir.join("server.js");
        let node_binary = locate_node_binary().context(
            "`node` binary not found on PATH. Bird Brain's sidecar requires Node.js 20+ installed on the host.",
        )?;

        let child = Command::new(&node_binary)
            .arg(server_js)
            .current_dir(&sidecar_dir)
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("NODE_ENV", "production")
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .with_context(|| format!("failed to spawn sidecar via {:?}", node_binary))?;

        Ok(Self {
            child: Mutex::new(Some(child)),
            port,
        })
    }

    pub fn base_url(&self) -> String {
        if cfg!(debug_assertions) {
            format!("http://localhost:{}", self.port)
        } else {
            format!("http://127.0.0.1:{}", self.port)
        }
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.lock().ok().and_then(|mut g| g.take()) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn locate_sidecar_dir(handle: &AppHandle) -> Result<PathBuf> {
    let resource_dir = handle
        .path()
        .resource_dir()
        .context("resource dir unavailable")?;
    Ok(resource_dir.join("sidecar"))
}

fn locate_node_binary() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("BIRDBRAIN_NODE") {
        let p = PathBuf::from(explicit);
        if p.exists() {
            return Some(p);
        }
    }
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["node.exe"]
    } else {
        &[
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
            "node",
        ]
    };
    for c in candidates {
        let p = PathBuf::from(c);
        if p.is_absolute() && p.exists() {
            return Some(p);
        }
        if which::which(c).is_ok() {
            return Some(PathBuf::from(c));
        }
    }
    None
}

fn pick_port() -> u16 {
    // Try 34521 first; if already bound just return it — Node will fail fast
    // and we'll surface the error in stdout. Random port selection would
    // complicate the URL rewrite we expose to the renderer.
    34521
}
