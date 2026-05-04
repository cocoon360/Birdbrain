# Bird Brain

> A hypertext project reader. Point it at a project folder, let it build a
> concept map, then walk that map like a branching dialogue tree in a video
> game. Every brief is clickable inside a 2010s-inspired metro UI.

**Bird Brain turns folders of text and code files into a generative hypertext
concept map for active work and research synthesis instead of the traditional
linear LLM conversation path.** You click a concept, it writes a short page
about that concept grounded in the actual files, and every phrase in the page
is itself clickable within the 2010's-inspired metro UI: either a link to
another concept it already recognizes, or a new one it thinks is worth
noticing. Click a new one and it joins the map. As you explore, the folder
gradually transforms, offering a new perspective on itself with each
interaction.

## Project status

- **Stage:** Prototype with active real-world use
- **Core loop:** Working end-to-end (ingest -> overview -> linked brief)
- **Interfaces:** Web app + Tauri desktop wrapper
- **Engine support:** Cursor CLI, OpenAI, Anthropic, Ollama, Demo Mode

## Quick start (2 minutes)

Install **Node.js 20 or 22** (npm 10+ ships with Node.js), then from repo root:

```bash
cd app
npm install
npm run dev
```

Open <http://localhost:3000>. You should see the workspace picker.

### First workspace

1. Choose **Begin a new project**.
2. Click **browse** (or paste an absolute folder path).
3. Pick a folder with readable files for Bird Brain to ingest.
4. Leave **include source code** on if you also want code files indexed.
5. After ingest, choose **Demo mode** for the bundled demo material, or choose
   **Configure AI** to use Cursor CLI, OpenAI, Anthropic, or Ollama.
6. Click **build overview** or **enter**. You should land in the Hub when the
   overview is ready.

### Optional AI setup (Cursor CLI)

```bash
# Install (if you haven't)
npm install -g @cursorai/cli

# Log in (no API key required; follow prompts)
cursor-agent login
```

Once logged in, select Cursor CLI in the engine drawer. API-key providers can
use the engine drawer, environment variables (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`), or the desktop keychain path.

For desktop/Tauri build and packaging instructions, see
[RUNNING_THE_PROTOTYPE.md](RUNNING_THE_PROTOTYPE.md).

## Screenshots and photos

Architecture snapshot:

![Bird Brain architecture](assets/architecture.png)

## Why it exists

Over the weekend, the amount of files for the video game I'm working on became
unruly, and I wanted to see if I could make something that would help me
navigate it.

Nothing about my game is baked into the engine; it works with any project
folder and does the same thing. It's just that the inspiration material happens
to be my own: Bird Brain is a new interactive way to see the abstract and messy
archive I already have and turn it into something easy for me and my
collaborators to work with. **But it's pointing the tool at a project I'm just
beginning to learn about when the tool is at its best.**

## The interaction model

Think branching dialogue trees in a video game, the kind where picking one
option opens up new things to investigate, and picking *those new options*
shifts the state of the scene, affecting how players see the game world in an
increasingly personalized lense as the story unfolds.

| In a dialogue-tree game                 | In Bird Brain                                                |
| --------------------------------------- | ------------------------------------------------------------ |
| Opening a scene                         | Opening a project folder                                     |
| Initial dialogue options                | The starter concept map, derived from the folder itself      |
| Picking a branch -> new dialogue reveals | Clicking a concept -> a short generated page + new links     |
| "Investigate" points in the environment | Clickable phrases inside the generated page                  |
| A choice permanently shifts the scene   | What you click on becomes part of the map                    |
| The in-game journal                     | The Journal panel - a running paragraph of what you're doing |

### Umwelten for archives: a perceptual framing

Bird Brain is designed to help you experience project files through a fresh
lense. Instead of presenting a static summary, it adapts and reorganizes what
you see based on the pathways you follow and the concepts you engage with. The
map it builds isn't hardcoded: it emerges entirely from your ongoing
interactions with the material. As you explore and click through ideas, your
personal journey shapes a unique perspective, one that grows more relevant and
meaningful the more you use it. Over time, the archive isn't just organized; it
becomes a living reflection of your attention and curiosity and relationship to
the project.

## How it works

### Short version

```mermaid
flowchart TD
    A[Your folder] --> B[Bird Brain reads the files]
    B --> C[Builds a starter concept map]
    C --> D[You click a concept]
    D --> E[Opens a grounded linked brief]
    E --> F[Page phrases become clickable]
    F -->|Known concept| D
    F -->|New phrase| G[New concept joins the map]
    G --> C
    E --> H[Journal notes what you keep circling]
    H -.-> C

    style A fill:#f4f0e8,stroke:#8a7f6a,color:#2a2a2a
    style G fill:#e8f0f4,stroke:#6a8799,color:#2a2a2a
    style H fill:#f4e8ee,stroke:#996a81,color:#2a2a2a
```

**The short read:** a folder goes in, a living map of concepts comes out. The
map grows from what you click. Briefs are grounded in the actual files, not the
model's general knowledge.

### Under the hood: ingest -> overview -> linked brief

Your project folder is only **read**; app state (SQLite, registry) lives in
`data/`, not inside the source tree. Ingest stores documents and chunks, startup
builds an overview plus starter lenses, and opening a concept uses a cached
**precontext** as the spine for the default linked brief. The full dossier
rewrite path is still available from the dossier engine toggle when you want a
heavier synthesis pass.

```mermaid
flowchart TB
  folder[Project folder]
  ingest[Ingest readable files and code]
  projectMap[Project map and starter topics]
  concept[User opens concept]
  precontext[Cached precontext for this topic]
  linked[Default linked brief]
  dossier[Optional full dossier rewrite]
  cache[Cache output by corpus signature]
  ui[Display dossier drawer]

  folder --> ingest
  ingest --> projectMap
  projectMap --> concept
  concept --> precontext
  precontext --> linked
  precontext --> dossier
  linked --> cache
  dossier --> cache
  cache --> ui
```

## Data, privacy, and engine behavior

Project files and workspace state are stored on disk by default (`data/`
inside the repo, or `BIRDBRAIN_DATA_DIR` if set). Text is sent to remote AI
providers only when you configure one (for example OpenAI or Anthropic). Demo
Mode and Ollama support offline workflows.

Bird Brain's own workspace databases and registry live under the repo's
`data/` folder by default (`data/workspaces.json` + `data/workspace-dbs/`).
Older installs may still have a legacy `~/.birdbrain/` folder that gets merged
in on first launch.

## What ships today

Everything below runs against the current branch.

- **No hardcoded concepts.** Point Bird Brain at a folder and it derives its own
  starter concept list from filenames, headings, and proper nouns. No
  per-project config, nothing baked into the engine.
- **Generated pages as hypertext.** Click a concept and the engine writes a
  short paragraph about it. Every phrase in that page is either a link to a
  known concept, or a *candidate* the engine thinks deserves one of its own.
  Click a candidate and it becomes a real concept, joins the map, and gets its
  own page.
- **The map grows from attention.** Every click is logged. A running paragraph
  in the Journal panel reads those clicks back to you in plain prose -
  *"you keep circling X, Y, and the tension between them"* - and new concepts
  get promoted from whatever you keep hovering around.
- **Grounded in your files, not the model's memory.** Each page cites the actual
  documents it pulled from. A Sources strip sits under every page, with full
  evidence cards one click away, each of which opens the source file.
- **Two-stage generation.** Before writing the dossier, the engine writes a
  short bird's-eye **brief** of what the concept is *inside this project*, then
  uses that as the spine for the dossier. Cached per concept and thrown out
  when the files change.
- **Swappable engine.** Cursor Agent CLI is the default; OpenAI, Anthropic, and
  Ollama adapters are wired in. A settings drawer lets you pick provider and
  model without leaving the app, with a curated shortlist of
  newest-per-provider plus a "show all" toggle.
- **Desktop app.** A Tauri wrapper ships as a native macOS build.
- **Bundled demo workspace.** Packaged builds include a prebuilt **Bird Brain
  Demo** workspace with cached linked briefs, so users can explore concepts and
  dossiers before configuring AI.
- **Export.** Copy the generated dossier **paragraph** as plain text to
  clipboard.
- **Possible evidence conflicts (v1).** Sometimes two passages about the same
  concept *sound* like they're saying opposite things. Bird Brain can flag a
  few of those pairs as "maybe look at this" in the dossier. It's
  pattern-matching on wording, not "understanding" your project. Treat it as a
  nudge, not a verdict.

## What is still partial

Honest list of things I haven't nailed yet:

- **Bridging text between pages.** When you navigate from concept A to concept
  B, B's page uses A as quiet context but doesn't *write the bridge*.
- **No drift indicators.** Rising/fading markers over the concept map were cut
  as too noisy; may return once the click signal is richer.
- **Journal voice.** The "what you're circling" paragraph reads fine but is
  still more log than journal; a copy pass wouldn't hurt.
- **Workbench tab.** Still evaluating whether the Workbench tab meaningfully
  improves the user experience or just adds complexity.
- **Deeper conflict detection.** Beyond the narrow v1 regex rules, there is no
  general analysis that arbitrary facts, dates, or claims across files
  contradict each other.
- **Long overview builds can still feel quiet.** The app now recovers stale
  interrupted overview runs, but progress feedback for multi-pass AI overview
  generation can still be clearer.

## Next priorities

- Tighten bridge-writing between concept transitions.
- Improve long-run overview progress visibility.
- Upgrade conflict detection beyond regex heuristics.

## Data model (today)

| Table                                                    | Role                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `documents`, `chunks`                                    | Raw corpus + heading-delimited chunks                              |
| `chunks_fts`                                             | FTS5 mirror for lexical retrieval                                  |
| `entities`, `entity_mentions`                            | Seeded + emerged concepts and their per-chunk mentions             |
| `concept_synthesis`                                      | Cached hypertextual paragraphs (live + queued profiles)            |
| `synthesis_queue`                                        | Background work list for queued synthesis                          |
| `ontology_runs`, `ontology_concepts`, `ontology_lenses` | LLM-assisted ontology overview                                     |
| `concept_precontext_cache`                               | Bird's-eye precontext per concept, invalidated by corpus signature |
| `participation_sessions`, `participation_events`         | Live click/read trail that feeds the memesis loop                  |
| `project_meta`                                           | Project name + engine config + guidance notes                      |

## Repo layout

```
birdbrain/
├── app/                       Next.js app + API routes + UI
│   ├── app/api/               dossier · concepts · search · hub · queue · …
│   ├── components/panels/     Hub, Workbench, Journal, Timeline (+ Concepts, Ask, Search)
│   ├── components/            ConceptDossier, DossierContext, StartupShell, …
│   ├── lib/ingest/            walker + parser + derive-concepts
│   ├── lib/db/                schema, queries, FTS helpers, migrations
│   ├── lib/ai/                synthesize, prompt builder, engine bridge
│   ├── lib/engine/            pluggable adapter (Cursor Agent CLI today)
│   ├── lib/ontology/          startup ontology overview
│   └── scripts/               ingest, synthesize-prep, eval-dossiers, smoke
├── src-tauri/                 desktop shell + sidecar packaging
├── RUNNING_THE_PROTOTYPE.md   web + desktop runbook
└── README.md                  (this file)
```

## Licence

For personal use.