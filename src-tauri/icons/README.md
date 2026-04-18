# Icons

These files are the **default Tauri app-template icons** (from `tauri-v2.0.0`
`crates/tauri-cli/templates/app/src-tauri/icons`) so `cargo tauri dev` and
`cargo tauri build` can run without extra setup. Tauri’s build reads them at
compile time.

Replace them before shipping Bird Brain:

```bash
cd src-tauri
cargo tauri icon path/to/your-1024.png
```

That regenerates `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, and
`icon.ico` in this folder.
