# Bird Brain

A local-first project intelligence console that turns a large markdown archive into current canon, change history, contradiction alerts, and actionable briefs.

## What it is

Bird Brain ingests a folder of markdown documents and surfaces them through a structured, searchable interface. It is designed for two users:

1. **Active builders and associates** working inside a complex evolving project — answer "what is current canon?", "what changed?", "what conflicts?", "what do we do next?"
2. **New teammates catching up** — get up to speed quickly without reading hundreds of documents manually

## Primary jobs

- Retrieve current canon with source citations
- Show what changed and when (timeline)
- Compare old vs current thinking on any concept
- Surface contradictions and unresolved questions (alerts)
- Generate actionable briefs from selected material

## What it is not

Not a chatbot. The AI layer is a secondary action, not the primary interface.

## UI identity

Windows Phone 7 / Zune / Metro panoramic interface.

Horizontal sections you scroll between:
- `NARRATIVE` — current canon and active concepts
- `TIMELINE` — chronological change feed
- `COMPARE` — doc vs doc or concept evolution
- `ALERTS` — contradictions, outdated refs, open questions
- `ASK` — cited brief generation, AI-assisted queries

Design principles:
- Giant typography that bleeds off screen edges
- High contrast, flat, dark theme + one accent color
- Horizontal panorama navigation (not vertical pages)
- Dossier cards with source citations
- Hypertext popups for concept exploration

## Technical identity

- **Local-first**: all documents and data stay on the machine
- **SQLite-backed**: structured memory spine for search, timeline, compare
- **FTS5**: full-text search over all chunks
- **Swappable AI**: Claude / OpenAI / local model — only retrieved context is sent to the model
- **Markdown as source of truth**: files are never modified

## Document corpus (Birdsong)

Source: `birdsong game copy/Game_Development/`

Folder priority (highest to lowest authority):
1. `_ACTIVE/00_CANON/` — locked current canon
2. `_ACTIVE/10_WORKING/` — active decisions in progress
3. `_ACTIVE/20_INCIDENTS/` through `50_CHARACTERS/` — active domain docs
4. `00_REFERENCE/` — reference and philosophy
5. `01_BRAINSTORM_ARCHIVE/`, `02_CHARACTER_WORK/`, etc. — historical archive

## Stack

- Next.js 14 + TypeScript (App Router)
- SQLite via `better-sqlite3`
- FTS5 for full-text search
- Tailwind CSS for UI
- Model adapter layer (Claude / OpenAI / Ollama)

## First demo milestone

1. Search "Opening Incident" → get current canon chunks with source citations
2. Open timeline → see recent changes across the archive
3. Select docs → generate one-page cited brief
