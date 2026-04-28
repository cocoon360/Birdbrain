use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

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

        let port = pick_port().context("could not reserve a free TCP port for the sidecar")?;
        let sidecar_dir = locate_sidecar_dir(handle)?;
        let server_js = sidecar_dir.join("server.js");
        let node_binary = locate_node_binary().context(
            "`node` binary not found. Install Node.js 20+ (e.g. Homebrew), or set BIRDBRAIN_NODE to the full path of your node binary.",
        )?;

        let mut child = Command::new(&node_binary);
        child
            .arg(server_js)
            .current_dir(&sidecar_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        apply_sidecar_process_env(handle, &mut child, port);
        let mut child = child
            .spawn()
            .with_context(|| format!("failed to spawn sidecar via {:?}", node_binary))?;

        if let Err(e) = wait_for_sidecar_listen(port, Duration::from_secs(45), &mut child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e.context("sidecar did not become ready (check Console for Node errors)"));
        }

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

/// Environment for the embedded Next.js `node server.js` process.
/// GUI-launched macOS apps often inherit a minimal PATH; prepend standard
/// install locations so optional CLIs remain discoverable. Cursor-related
/// vars are re-copied from the Tauri parent when set (e.g. launchctl / Terminal).
fn apply_sidecar_process_env(handle: &AppHandle, cmd: &mut Command, port: u16) {
    cmd.env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production");

    if let Ok(app_data_dir) = handle.path().app_data_dir() {
        cmd.env("BIRDBRAIN_DATA_DIR", app_data_dir);
    }

    #[cfg(unix)]
    {
        let prefix = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
        let merged = std::env::var("PATH").map_or_else(
            |_| prefix.to_string(),
            |p| format!("{prefix}:{p}"),
        );
        cmd.env("PATH", merged);
    }

    for key in [
        "HOME",
        "USER",
        "TMPDIR",
        "CURSOR_AGENT_PATH",
        "CURSOR_AGENT_MODEL",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "OLLAMA_HOST",
    ] {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
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
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
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
    #[cfg(target_os = "macos")]
    {
        if let Some(p) = locate_node_macos_gui_fallback() {
            return Some(p);
        }
    }
    None
}

/// Finder-launched apps inherit a minimal PATH; resolve `node` via common install dirs.
#[cfg(target_os = "macos")]
fn locate_node_macos_gui_fallback() -> Option<PathBuf> {
    let out = Command::new("/bin/zsh")
        .arg("-c")
        .arg(
            "export PATH=\"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH\"; command -v node 2>/dev/null",
        )
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        return None;
    }
    let p = PathBuf::from(s);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

fn pick_port() -> Result<u16> {
    let listener =
        TcpListener::bind("127.0.0.1:0").context("failed to bind ephemeral port for sidecar")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_sidecar_listen(port: u16, timeout: Duration, child: &mut Child) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            anyhow::bail!(
                "timed out after {:?} waiting for 127.0.0.1:{} (port in use or server crashed)",
                timeout,
                port
            );
        }
        if let Ok(Some(status)) = child.try_wait() {
            anyhow::bail!("Node sidecar exited before listening (exit: {status})");
        }
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(80));
    }
}
