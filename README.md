# Bird Brain

> A local-first project intelligence console for active builders and new teammates.

Bird Brain turns a messy markdown archive into searchable current canon, change history, contradiction alerts, and AI-assisted briefs — all running locally on your machine with a Metro-style panoramic UI.

## Quick start

```bash
# Install dependencies
npm install

# Point it at your docs (edit .env.local)
DOCS_PATH=./birdsong game copy/Game_Development
DB_PATH=./data/birdbrain.sqlite

# Run ingestion
npm run ingest

# Start the app
npm run dev
```

Then open `http://localhost:3000`.

## Architecture

```
markdown docs
     │
     ▼
ingest script          ← reads .md files, extracts structure
     │
     ▼
SQLite + FTS5          ← documents, chunks, entities, timeline
     │
     ▼
API layer              ← search, compare, timeline, brief
     │
  ┌──┴──┐
  ▼     ▼
Metro UI   Model adapter (Claude / OpenAI / Ollama)
```

All source documents stay local. Only retrieved context snippets are sent to the AI model.

## Folder structure

```
birdbrain/
  birdsong game copy/          ← source markdown archive (read-only)
  data/
    birdbrain.sqlite           ← local database (gitignored)
  src/
    app/                       ← Next.js App Router pages
    components/                ← UI components
    lib/
      db/                      ← SQLite schema + query helpers
      ingest/                  ← markdown parser + extraction
      models/                  ← AI provider adapters
  scripts/
    ingest.ts                  ← ingestion entry point
  PROJECT_BRIEF.md
  README.md
```

## Document status mapping

Bird Brain derives document status and category from folder path — no frontmatter needed.

| Path contains | Status |
|---|---|
| `_ACTIVE/00_CANON` | `canon` |
| `_ACTIVE/10_WORKING` | `working` |
| `_ACTIVE/90_ARCHIVE` or `90_ARCHIVE` | `archive` |
| `01_BRAINSTORM_ARCHIVE` | `brainstorm` |
| `00_REFERENCE` | `reference` |
| anything else in `_ACTIVE` | `active` |

## License

Private. For personal and team use only.
