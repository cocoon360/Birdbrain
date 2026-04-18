# Bird Brain

> A little local-first console for a folder of markdown. Point it at an
> archive and it builds its own concept map, then lets you walk that map
> like a branching dialogue tree in a video game — every generated
> paragraph is itself clickable, and the tool quietly grows new concepts
> from whatever you keep clicking on.

Bird Brain is not a chatbot over your docs. The interaction primitive is a
branching dialogue tree: every dossier paragraph is itself hypertext, every
phrase resolves either to a known concept or to a candidate that can
promote itself into the ontology. The archive you read becomes a slightly
different archive because you read it.

---

## Why it exists

A weekend itch, really. I had a folder of my own writing I could no longer
navigate, and I wanted to see if the right tool over it could feel like
*reading* instead of *searching*. Bird Brain is the result, in three
compatible readings:

1. **Proof of execution.** A legibly-real stack (Next.js + SQLite + FTS5 +
   swappable LLM adapter, optional Tauri desktop shell) around a
   non-obvious product idea, shippable in a 90-second demo.
2. **A notebook for my own writing.** The demo corpus happens to be a
   creative project of mine — the tool is a second way to see the archive
   I already have.
3. **A general-purpose engine.** Point it at any folder of markdown and it
   does the same thing for that folder. No project-specific code in the
   engine; the specifics *emerge* when the engine is pointed at a specific
   folder.

All three collapse into: *a project-agnostic engine with an automatic
seeding pass and a participation-driven emergence pipeline*.

---

## The interaction model

Think branching dialogue trees in a video game — the kind where picking a
line opens up new things to investigate, and picking *those* shifts the
state of the scene. Bird Brain is that, but the branches aren't
pre-authored by a writer; they're generated at read time from whatever's
in your folder.

| In a dialogue-tree game                   | In Bird Brain                                      |
| ----------------------------------------- | -------------------------------------------------- |
| Opening a scene                           | Opening a project folder                            |
| Initial dialogue options                  | Seeded concept tiles (derived from the folder)      |
| Picking a branch → new dialogue reveals    | Clicking a concept → dossier + new hyperlinks       |
| "Investigate" points in the environment   | Clickable spans inside the generated paragraph      |
| A choice permanently shifts the scene     | A participation trail grows new concepts            |
| The in-game journal                       | The Datalog panel *(memesis loop)*                  |

Two readers on the same corpus end up with different concept panels,
because the hyperlinks inside a dossier are generated from the corpus, not
written in advance. The substrate is stronger than a hand-authored
dialogue tree because the branches are emergent rather than scripted.

### Umwelten — the perceptual framing

Each reader's Concepts panel accumulates as *their* lens. The same engine
pointed at a research folder and at a novel's drafts produces different
seeded concepts, because seeding is a function of the folder's signal, not of
hardcoded knowledge. That's the umwelten commitment: the tool inhabits the
world of the folder you point it at.

---

## What ships today

Everything below runs locally against the current branch:

- **Zero-hardcoded seeding.** `app/lib/ingest/derive-concepts.ts` stacks
  signals from filenames, headings, proper-noun tokens, and document-spread
  to populate `entities` at ingest time. No project config required.
- **Two-stage synthesis with bird's-eye precontext.** Before a dossier is
  written, a lightweight precontext pass summarises what the concept *is* at
  the project level. The dossier prompt then uses that precontext as its
  narrative spine instead of piecing together isolated facts. Cached per
  concept and invalidated by corpus signature.
- **Unified-audience prompts.** One reader, one voice — dossiers open
  directly with what the concept is and does inside the project, no
  dictionary preamble, no internal jargon (`lane`, `tier`, `artifact`,
  `operationalize`, etc. are forbidden in the prompt).
- **LLM-generated dossier prose *as hypertext*.** Synthesis returns a span
  array, not a string. Each span is either plain text, a `known` link to
  an existing concept, or a `candidate` phrase the LLM noticed but the
  ontology didn't know yet. The UI renders every span as a clickable node.
- **Candidate → emergent entity, end-to-end.** Clicking a candidate span
  promotes it: a new row in `entities` with `source='emerged'`, a tile in
  the Concepts panel, and its own dossier queued. The ontology really grows
  with use.
- **Participation event log + memesis synthesis.** Every click writes a row
  to `participation_events` (see `app/lib/db/participation.ts`). The Datalog
  panel's MemesisCard reads those events and generates a running paragraph
  of what you seem to be circling — the archive gossiping about you.
- **Provenance-tagged retrieval.** Every prompt is built from
  `direct | neighbor | fts_recall | from_peer` evidence, with current vs.
  archive documents weighted so dossiers describe the *current* state of the
  project, not every old contradicting note.
- **Two synthesis lanes.** Live (interactive, tight prompt) and queued
  (background, deeper retrieval). Engine layer is pluggable; today's default
  is the Cursor Agent CLI, with OpenAI / Anthropic / Ollama adapters ready.
- **Engine drawer with curated model dropdown.** Provider picker for
  cursor-cli / OpenAI / Anthropic / Ollama, plus a grouped model select
  populated from `cursor-agent models` — newest three-ish per provider by
  default, "show all" toggle for power users. Saved per workspace.
- **Citations on every dossier.** A Sources strip under the paragraph + full
  Current Grounding evidence cards that open the source document.
- **Export.** Dossier → Markdown to clipboard, preserving the hypertext spans
  as stable `#/concept/<slug>` links.
- **Telemetry + eval harness.** `[synthesize]` one-line logs per generation
  (evidence counts by provenance, prompt size, latency, word/link counts) and
  `npm run eval:dossiers` for a reproducible report across a slug batch, now
  including precontext length and latency columns.
- **Stable Metro panorama.** Hub · Concepts · Ask · Search · Workbench ·
  Datalog · Timeline. The panorama shape never changes; what grows is the
  Concepts panel.

## What is still partial

Honest list of remaining gaps against the *living-notebook* vision in
[`docs/ChatQuote.txt`](docs/ChatQuote.txt):

- **Bridging brief.** When you navigate A → B, B's dossier uses A as quiet
  peer evidence but does not *write the bridge*. The "this branch reveals
  the previous beat from a new angle" feeling is still implicit.
- **No drift radar.** Rising/fading indicators over the concept layer were
  cut as noisy; may return once candidate co-occurrence is richer.
- **Datalog voice.** Compact status strip + memesis paragraph reads fine but
  is still more "log" than "journal"; a copy pass wouldn't hurt.
- **Tauri desktop shell.** Prototype builds and opens; not yet stable enough
  to demo. Web is the primary surface for now.

---

## Quick start

```bash
cd app
npm install

npm run dev        # http://localhost:3000 — pick a workspace folder in the UI

# Optional CLI ingest (defaults to the tiny tracked fixtures/smoke-corpus/):
# DOCS_PATH=/absolute/path/to/your/markdown npm run ingest
```

For live dossier synthesis, install the Cursor Agent CLI and
`cursor-agent login`. Queued synthesis works without it if you wire a
different engine adapter under `app/lib/engine/`.

Desktop (Tauri) build: [`RUNNING_THE_PROTOTYPE.md`](RUNNING_THE_PROTOTYPE.md).

Demo path (90 seconds, screen-record ready): [`DEMO.md`](DEMO.md).

---

## Architecture

```
 markdown folder
       │
       ▼
 walk + parse          md / txt / rst / org / adoc / svg
       │
       ▼
 SQLite + FTS5         documents · chunks · entities · entity_mentions
       │               ontology_runs · synthesis cache · synthesis queue
       ▼
 seeded ontology       derive-concepts.ts — folder signal, no hardcoding
       │
       ▼
 retrieval merge       direct + neighbor + fts_recall + from_peer
       │
       ▼
 engine adapter        cursor-agent today; Claude / OpenAI / Ollama pluggable
       │
       ▼
 hypertext spans       Paragraph = Span[] with known | candidate refs
       │
       ▼
 Next.js panorama      Hub · Concepts · Ask · Search · Workbench · Datalog · Timeline
       │
       ▼
 (optional) Tauri desktop shell
```

The engine is deliberately local. Source markdown, parsed chunks, FTS index,
and ontology all live on disk. Only retrieved snippets leave the machine, and
only if the configured adapter targets a remote model.

---

## Data model (today)

| Table                         | Role                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `documents`, `chunks`         | Raw corpus + heading-delimited chunks                              |
| `chunks_fts`                  | FTS5 mirror for lexical retrieval                                  |
| `entities`, `entity_mentions` | Seeded + emerged concepts and their per-chunk mentions             |
| `concept_synthesis`           | Cached hypertextual paragraphs (live + queued profiles)            |
| `synthesis_queue`             | Background work list for queued synthesis                           |
| `ontology_runs`, `ontology_concepts`, `ontology_lenses` | LLM-assisted ontology overview          |
| `concept_precontext_cache`    | Bird's-eye precontext per concept, invalidated by corpus signature |
| `participation_sessions`, `participation_events` | Live click/read trail that feeds the memesis loop |
| `project_meta`                | Project name + engine config + guidance notes                       |

---

## Repo layout

```
birdbrain/
├── app/                       Next.js app + API routes + UI
│   ├── app/api/               dossier · concepts · search · hub · queue · …
│   ├── components/panels/     Hub, Concepts, Ask, Search, Workbench, Datalog, Timeline
│   ├── components/            ConceptDossier, DossierContext, StartupShell, …
│   ├── lib/ingest/            walker + parser + derive-concepts
│   ├── lib/db/                schema, queries, FTS helpers, migrations
│   ├── lib/ai/                synthesize, prompt builder, engine bridge
│   ├── lib/engine/            pluggable adapter (Cursor Agent CLI today)
│   ├── lib/ontology/          startup ontology overview
│   └── scripts/               ingest, synthesize-prep, eval-dossiers, smoke
├── src-tauri/                 desktop shell + sidecar packaging
├── docs/
│   ├── JOB                    how to pitch this when hiring
│   ├── ChatQuote.txt          source-of-truth on the memesis vision
│   └── FEATURE_NON_MARKDOWN_INGEST.md
├── DEMO.md                    locked 90-second demo script
├── RUNNING_THE_PROTOTYPE.md   web + desktop runbook
└── README.md                  (this file)
```

---

## Why it's interesting (to me, anyway)

In one breath: Bird Brain treats a folder of markdown as a walkable
dialogue tree whose branches are *generated at read time from the corpus*
and whose concept set *grows from what you pay attention to*. The engine
is project-agnostic, local-first, and the AI layer is scoped — it writes
paragraphs and nothing else; retrieval, ranking, promotion, and the
navigation model itself are all deterministic code you can read.

The fun part, for me, was that the tool ends up becoming a more specific
version of itself through use — the concept set after a reading session is
not the concept set you started with. Same mechanism that makes it useful
for my own archive makes it re-pointable at anyone's folder.

---

## License

Private. For personal and collaborator use.
