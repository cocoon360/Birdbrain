# Bird Brain — 90-second demo path

A locked happy-path script for screen recordings and live interview demos. Every
step is something the app already does today. Nothing here is aspirational.

> **One-line framing (say this first):** "Bird Brain is a local-first AI
> knowledge console. You point it at a folder of markdown, it builds an
> ontology of concepts, and you navigate the archive through a Life-is-Strange-
> style hypertext dialogue tree instead of a chatbox."

---

## Before the camera rolls

1. Docs path set (`DOCS_PATH` in `app/.env.local` or pick in the UI picker).
2. Ingest is up to date: `cd app && npm run ingest`.
3. Dev server running: `cd app && npm run dev` → `http://localhost:3000`.
4. Cursor Agent CLI logged in: `cursor-agent login` (only needed for live
   synthesis; queued mode also works without it).
5. Wipe the synthesis cache if you want fresh paragraphs on camera:
   `sqlite3 data/birdbrain.sqlite 'DELETE FROM concept_synthesis;'`

---

## The script (90 seconds)

### 0:00 — Open with positioning (10s)
- Say the one-line framing above.
- Mention: "Everything stays on my laptop. Only retrieved snippets go to the
  model."

### 0:10 — Folder picker → Hub (15s)
- Open the picker, select a project folder.
- Watch ingest finish (documents + chunks + entities counts flash up).
- Land on the **Hub**: "These seeded concepts came from the folder itself —
  nothing about this project is hardcoded in the engine."

### 0:25 — Open a seeded concept (20s)
- Click a character or core-theme tile (e.g. `Oliver`, `Seaview`, `the Ex-wife`).
- Dossier opens. Highlight:
  - The **synthesis paragraph** — grounded summary with status-tinted links.
  - The **Sources** strip right under it — "this is what it read."
  - The **Current Grounding** evidence cards below — click one to open the raw
    markdown.

### 0:45 — Hypertext branching (20s)
- Click a linked concept *inside* the paragraph.
- A second dossier opens. "Same pattern, new lens. Every click is a branch in
  a dialogue tree that writes itself from the corpus."
- Click a **candidate** (dashed-pink) phrase to promote an emergent concept.

### 1:05 — Regenerate live (10s)
- Hit **Regenerate** on a dossier. Narrate:
  "Live path uses the local Cursor Agent CLI with a tighter prompt. The queued
  lane runs in the background with deeper retrieval."

### 1:15 — Export + search (15s)
- Hit **Export** on the dossier → paste the markdown into your notes app.
- Switch to the **Search** panel, run a keyword query across the corpus.
- Close with: "Same engine, point it at any folder of markdown. That's the
  product."

---

## Fallbacks if something is slow on stage

- Live synthesis stalls → switch the global toggle to **Queued** and narrate
  the async lane. The evidence pane stays useful regardless.
- Cursor Agent not logged in → the pending banner shows a clean `cursor-agent
  login` hint; use it as a talking point for the swappable engine layer.
- Ingest hasn't run yet → the start screen has an explicit **Rebuild** button.
- Regeneration is slow on a cold cache → open a concept you pre-warmed before
  the demo.

---

## Stuff to *not* click during the demo

- The Timeline tab if the corpus has few `file_mtime` variations — looks empty.
- Tiny candidate phrases in deeply archived docs — the dossier will correctly
  refuse to invent content and show a stub; fine to mention, bad to linger on.
- Any panel that requires a workspace that isn't the one you opened. Stay in
  one workspace for the whole take.
