# Running the Bird Brain Prototype

Bird Brain has two modes:

- **Web preview** — a Next.js app you open in your browser. Fastest loop for
  iterating on the UI and for running on any machine that already has Node.js.
- **Desktop app (Tauri)** — a native window wrapping the same Next.js server.
  This is what you hand to teammates so they can open multiple folders in
  multiple windows on different computers.

Both modes share the same codebase. The desktop build just embeds the Next.js
server as a "sidecar" process that the Tauri window talks to.

---

## 1. Prerequisites

| Tool     | Version    | Notes                                        |
| -------- | ---------- | -------------------------------------------- |
| Node.js  | 20 or 22   | Required for both web preview and desktop.   |
| npm      | 10+        | Ships with Node.js.                          |
| Rust     | stable     | Only needed for the desktop build.           |
| Xcode CLT (macOS) / VS Build Tools (Windows) / `build-essential` (Linux) | — | Native compile deps for Tauri + better-sqlite3. |
| Cursor CLI *(optional)* | latest | Default LLM engine. Not required; you can switch to OpenAI, Anthropic, or local Ollama from inside the app. |

Install Rust once via [rustup](https://rustup.rs/). Install Tauri's CLI
globally *or* use `npx` (the repo does not ship it by default):

```bash
cargo install tauri-cli --version "^2.0"
# or use: cargo tauri ... directly via cargo
```

On macOS make sure Xcode Command Line Tools are present:

```bash
xcode-select --install
```

On Ubuntu/Debian:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

---

## 2. Web preview (fast loop)

```bash
cd app
npm install
npm run dev
```

Open <http://localhost:3000>. This is the workspace picker. Add a folder of
readable files (see the picker copy for extensions; source code is optional)
and the app will ingest into a SQLite database under
`~/.birdbrain/workspaces/<id>.db`. Each workspace is isolated.

Useful scripts inside `app/`:

```bash
npm run ingest                          # CLI ingest of the active workspace
WORKSPACE_FOLDER=/path/to/docs npm run ingest
INGEST_INCLUDE_CODE=1 npm run ingest   # optional: force code files on (0 = off; omit = use DB)
npm run build                           # production web build
npm run start                           # run the production web build
```

Engine settings (Cursor CLI / OpenAI / Anthropic / Ollama) are configured
from the gear icon in the top chrome. API keys can live in either:

- `~/.birdbrain/secrets.json` (written by the Engine Settings panel), or
- your shell environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.), or
- the OS keychain (desktop builds only — see below).

---

## 3. Desktop app (Tauri)

### 3a. Develop with a live window

From the `app/` directory (same as other npm scripts):

```bash
cd app
npm run tauri:dev
```

Or from the repo root:

```bash
cd src-tauri
cargo tauri dev
```

`cargo tauri dev` runs `npm run dev` in `app/` for you (see `beforeDevCommand`
in `src-tauri/tauri.conf.json`) and opens a native window pointed at
`http://localhost:3000`. Hot reload works as normal.

### 3b. Produce installable bundles

From `app/`:

```bash
cd app
npm run tauri:build
```

Or:

```bash
cd src-tauri
cargo tauri build
```

This runs `npm run build:sidecar` first, which produces the Next.js
standalone bundle at `app/.next/standalone/` (including `better-sqlite3`'s
native addon). `pack-sidecar.mjs` then mirrors that tree into
`src-tauri/bundle/sidecar/` (outside `app/.next/` so `tauri dev` is not
constantly invalidated by Turbopack). Tauri bundles `bundle/sidecar` as
`resources/sidecar` and builds a platform-specific installer:

| Platform | Output                                          |
| -------- | ----------------------------------------------- |
| macOS    | `src-tauri/target/release/bundle/dmg/*.dmg` and `.app` |
| Windows  | `src-tauri/target/release/bundle/nsis/*.exe`    |
| Linux    | `src-tauri/target/release/bundle/deb/*.deb` and AppImage |

Cross-compiling is not supported by default — build each platform on its
own host (or via CI).

### 3c. How the desktop app runs

1. Tauri launches and spawns `node <resource_dir>/sidecar/server.js` on a
   fixed loopback port (`127.0.0.1:34521`). This is the same Next.js server
   you run during `npm run dev`.
2. The Tauri window loads `http://127.0.0.1:34521/` — the workspace picker.
3. When you pick "Open in new window", the Rust `open_workspace_window`
   IPC command spawns a second webview pointed at the sidecar's
   `/w/<workspaceId>` route.
4. API keys go through the `keychain_*` IPC commands, which use the OS
   credential store (Keychain on macOS, Credential Vault on Windows, libsecret
   on Linux).

**Node.js is a runtime dependency of the bundled app.** On end-user machines
that don't have Node installed, the sidecar will fail to start. The easiest
workarounds are:

- document "install Node.js 20+" as part of the prototype README, or
- bundle a Node runtime under `src-tauri/binaries/` and point
  `BIRDBRAIN_NODE` at it. The Rust sidecar already honors
  `BIRDBRAIN_NODE` if set.

For the prototype, the first option is fine.

### 3d. Icons

Replace the placeholders in `src-tauri/icons/` with real assets by running
once you have a source PNG:

```bash
cd src-tauri
cargo tauri icon path/to/source-1024.png
```

This writes `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, and
`icon.ico` in-place, matching the paths already listed in `tauri.conf.json`.

---

## 4. Multi-window, multi-folder workflow

From the workspace picker:

1. Click **Add Folder**. In the desktop app this opens an OS-native folder
   picker via `tauri-plugin-dialog`; in the web preview it's a text field.
2. Bird Brain ingests the folder into its own SQLite database. The first
   ingest may take a minute for large archives.
3. Click **Open in new window** to launch that workspace in its own native
   window. Repeat for each project. Each window has its own:
   - database,
   - synthesis cache,
   - exploration branches (scoped by `localStorage`),
   - engine configuration (provider, model, API key env var).

On a different computer, copy the folder of markdown, install Bird Brain,
point it at the folder, and the same ingest + ontology pipeline runs.

---

## 5. Troubleshooting

- **"Engine not configured" on startup.** Open the gear icon and set a
  provider. Default is Cursor CLI (no key needed); the app will fall back
  to retrieval-only briefs when nothing is configured.
- **Sidecar log says `node: command not found`.** Install Node.js 20+ or
  set `BIRDBRAIN_NODE=/abs/path/to/node` before launching the app.
- **`better-sqlite3` load error.** Re-run `npm install` inside `app/` on
  the same platform you're building on. The native addon has to match the
  architecture shipped inside `sidecar/node_modules/better-sqlite3/`.
- **Workspace picker is empty after upgrade.** Bird Brain auto-adopts the
  legacy `~/.birdbrain/bird.db` as "Legacy" the first time you open it.
  If that didn't happen, add the folder manually.
- **Port 34521 already in use.** Set the `PORT` env var before launching
  the desktop app, or kill whatever else is using it — the sidecar binds
  to a fixed port so the renderer has a stable URL.

---

## 6. Anatomy of the repo

```
birdbrain/
├── app/                  # Next.js + TypeScript (UI + API + ingest)
│   ├── app/api/          # REST endpoints, all workspace-scoped
│   ├── lib/engine/       # Engine interface + Cursor/OpenAI/Anthropic/Ollama adapters
│   ├── lib/workspaces/   # Registry + AsyncLocalStorage context
│   └── scripts/          # ingest.ts, pack-sidecar.mjs
├── src-tauri/            # Rust desktop shell
│   ├── src/commands/     # IPC: folder picker, keychain, open window
│   ├── src/sidecar.rs    # Spawns node <resource>/sidecar/server.js
│   └── tauri.conf.json   # Bundles bundle/sidecar → resources/sidecar
└── RUNNING_THE_PROTOTYPE.md   # this file
```

Have fun. If something looks off, the engine, workspace, and ingest logic are
all plain TypeScript — edit and reload like any Next.js app.
