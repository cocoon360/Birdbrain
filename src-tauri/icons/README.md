# Icons

Tauri expects icons in this folder before `tauri build` succeeds. Drop in the
following files before packaging:

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (macOS)
- `icon.ico` (Windows)

You can generate all of them from a single source PNG with:

```bash
cd src-tauri
cargo tauri icon path/to/source-icon.png
```

The placeholder dev icon is intentionally left out so Cargo does not ship a
generic logo in builds. Dev runs (`cargo tauri dev`) still work without icons.
