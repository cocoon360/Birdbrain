# Smoke corpus (tracked)

Tiny markdown + text files used by `npm test` and as the default folder for
`npm run ingest` when `DOCS_PATH` is not set.

Your real notes can live **anywhere** on disk (including outside this
repo). Point Bird Brain at them from the workspace picker, or set
`DOCS_PATH` for CLI ingest. The repo's root `.gitignore` ignores `docs/`
and `data/` so large local trees are never committed by accident.
