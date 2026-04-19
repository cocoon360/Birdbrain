# Bundle icons

These PNG / ICNS / ICO files are generated from the **transparent** robot-bird mark (no tile background), same paths as `public/icons/robot-bird-transparent.svg` and `app/app/icon.svg`.

**Regenerate**

From the **repository root** (`birdbrain/`):

```bash
cd src-tauri && cargo tauri icon ../app/public/icons/robot-bird-transparent.svg
```

From the **`app/`** folder:

```bash
cd ../src-tauri && cargo tauri icon ../public/icons/robot-bird-transparent.svg
```

Then remove extra outputs if you only ship desktop bundles (the CLI also writes Windows Store tiles, iOS, and Android assets under `icons/`). `tauri.conf.json` only references:

- `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`
