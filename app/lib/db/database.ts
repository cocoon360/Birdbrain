import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getCurrentWorkspace } from '../workspaces/context';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  category TEXT NOT NULL DEFAULT 'general',
  word_count INTEGER DEFAULT 0,
  file_mtime INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'markdown',  -- markdown | text | svg
  source_ext TEXT NOT NULL DEFAULT '.md'         -- lowercased extension, incl. dot
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  heading TEXT,
  heading_level INTEGER DEFAULT 0,
  body TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  word_count INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  body,
  heading,
  content=chunks,
  content_rowid=id
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at INTEGER NOT NULL,
  docs_added INTEGER DEFAULT 0,
  docs_updated INTEGER DEFAULT 0,
  docs_removed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corpus_signature TEXT NOT NULL,
  startup_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  overview_json TEXT,
  summary_text TEXT,
  error_text TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS ontology_concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ontology_runs(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology_lenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ontology_runs(id) ON DELETE CASCADE,
  concept_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'seeded',
  emerged_from TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS entity_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  match_count INTEGER NOT NULL DEFAULT 1
);

-- Pre-generated hypertext paragraphs for concept dossiers.
-- paragraph_json is a JSON array of spans: { text } | { text, ref, kind: 'known' | 'candidate' }
CREATE TABLE IF NOT EXISTS concept_synthesis (
  entity_id INTEGER PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  paragraph_json TEXT NOT NULL,
  generator TEXT NOT NULL DEFAULT 'cursor-agent',
  model TEXT,
  generated_at INTEGER NOT NULL
);

-- V3 cache table keyed by synthesis profile so the preview can compare
-- immediate "live" output against slower queued output.
CREATE TABLE IF NOT EXISTS concept_synthesis_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  profile TEXT NOT NULL DEFAULT 'live',
  paragraph_json TEXT NOT NULL,
  generator TEXT NOT NULL DEFAULT 'cursor-agent',
  model TEXT,
  generated_at INTEGER NOT NULL,
  UNIQUE(entity_id, profile)
);

-- Bird's-eye concept context cached separately from the final dossier prose.
-- This lets dossier synthesis reuse a project-level framing layer instead of
-- re-deriving the concept's role from raw snippets on every open/regenerate.
CREATE TABLE IF NOT EXISTS concept_precontext_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  corpus_signature TEXT NOT NULL,
  plain_definition TEXT NOT NULL,
  project_role TEXT NOT NULL,
  study_relevance TEXT NOT NULL,
  related_concepts_json TEXT NOT NULL DEFAULT '[]',
  precontext_text TEXT NOT NULL,
  generator TEXT NOT NULL DEFAULT 'cursor-agent',
  model TEXT,
  generated_at INTEGER NOT NULL,
  UNIQUE(entity_id, corpus_signature)
);
CREATE INDEX IF NOT EXISTS idx_concept_precontext_entity ON concept_precontext_cache(entity_id);

-- Queue of phrases the user clicked on that still need synthesis.
CREATE TABLE IF NOT EXISTS synthesis_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  context_slug TEXT,
  root_slug TEXT,
  profile TEXT NOT NULL DEFAULT 'queued',
  requested_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(entity_id)
);

-- ── Memesis / living-notebook layer ────────────────────────────────────────
-- The panorama's Datalog panel reads from these three tables. None of them
-- are required for ingest or synthesis to work — they only light up once the
-- reader starts clicking around.

-- One row per reading session. A new session is started client-side after
-- ~30 minutes of idle; sessions are never cleaned up (a session is an audit
-- record of a reading, not an ephemeral handle).
CREATE TABLE IF NOT EXISTS participation_sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL
);

-- Every click / resolve / ask that counts as the reader attending to
-- something. Fire-and-forget inserts from /api/participation/event. The
-- Datalog panel's trail is a SELECT over the last N rows of this table.
CREATE TABLE IF NOT EXISTS participation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES participation_sessions(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,         -- open_concept | open_doc | impression | promote | dismiss | ask | search | reset | memesis
  slug TEXT,                  -- concept slug when relevant
  from_slug TEXT,             -- peer concept for bridging
  phrase TEXT,                -- free-text phrase for impressions / candidates
  doc_id INTEGER,             -- doc id when openDoc
  source TEXT                 -- where the click came from (tile/pill/prose/related/…)
);
CREATE INDEX IF NOT EXISTS idx_events_session_at ON participation_events(session_id, at);
CREATE INDEX IF NOT EXISTS idx_events_kind_at ON participation_events(kind, at);
CREATE INDEX IF NOT EXISTS idx_events_slug ON participation_events(slug);

-- Attention-weighted candidates. A candidate lives here the moment the LLM
-- emits a candidate span in a dossier paragraph (impression) and again
-- whenever a reader clicks one (click). Promotion and dismissal are recorded
-- via status. co_concepts_json is a JSON array of peer slugs the
-- candidate has been seen alongside — that is the co-click material that
-- ChatQuote calls "SQL earning its keep".
CREATE TABLE IF NOT EXISTS candidate_concepts (
  slug TEXT PRIMARY KEY,
  phrase TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  distinct_sessions INTEGER NOT NULL DEFAULT 0,
  session_ids_json TEXT NOT NULL DEFAULT '[]',
  co_concepts_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'watching'  -- watching | promoted | dismissed
);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidate_concepts(status);

-- The session synthesis paragraph — "the archive gossiping about you". One
-- row per (session, generated_at) so you can scroll back through how the
-- tool's running interpretation of your attention evolved.
CREATE TABLE IF NOT EXISTS session_synthesis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES participation_sessions(id) ON DELETE CASCADE,
  paragraph_json TEXT NOT NULL,
  generator TEXT NOT NULL DEFAULT 'cursor-agent',
  model TEXT,
  event_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_synth_at ON session_synthesis(session_id, generated_at DESC);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, body, heading)
  VALUES (NEW.id, NEW.body, NEW.heading);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, body, heading)
  VALUES('delete', OLD.id, OLD.body, OLD.heading);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, body, heading)
  VALUES('delete', OLD.id, OLD.body, OLD.heading);
  INSERT INTO chunks_fts(rowid, body, heading)
  VALUES (NEW.id, NEW.body, NEW.heading);
END;
`;

// Cache of open database connections keyed by workspace id. A server process
// can hold connections to many workspaces at once (one per open tab / window
// in the eventual desktop wrapper), so we reuse the Database instance per
// workspace instead of opening one per request.
const pool = new Map<string, Database.Database>();

export class MissingWorkspaceError extends Error {
  constructor() {
    super(
      'No workspace is active for this request. Pick a workspace before calling the API.'
    );
    this.name = 'MissingWorkspaceError';
  }
}

function openDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  migrateEntities(db);
  migrateSynthesisCache(db);
  migrateSynthesisQueue(db);
  migrateDocumentsSource(db);
  return db;
}

export function getDb(): Database.Database {
  const ctx = getCurrentWorkspace();
  if (!ctx) {
    throw new MissingWorkspaceError();
  }
  const cached = pool.get(ctx.id);
  if (cached) return cached;
  const db = openDb(ctx.db_path);
  pool.set(ctx.id, db);
  return db;
}

// Directly open a DB without going through async-local context. Used by
// maintenance scripts (ingest.ts CLI) that know the path up front. The opened
// connection is NOT cached in the pool because it's usually a short-lived
// script invocation.
export function openWorkspaceDb(dbPath: string): Database.Database {
  return openDb(dbPath);
}

export function closeWorkspace(id: string) {
  const db = pool.get(id);
  if (db) {
    db.close();
    pool.delete(id);
  }
}

export function closeAll() {
  for (const [, db] of pool) {
    try {
      db.close();
    } catch {
      // best-effort
    }
  }
  pool.clear();
}

// Additive, idempotent migrations for tables that existed before a column was
// added to the canonical schema. CREATE TABLE IF NOT EXISTS will skip the new
// column on existing DBs, so we add them here.
function migrateEntities(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(entities)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('source')) {
    db.exec("ALTER TABLE entities ADD COLUMN source TEXT NOT NULL DEFAULT 'seeded'");
  }
  if (!names.has('emerged_from')) {
    db.exec('ALTER TABLE entities ADD COLUMN emerged_from TEXT');
  }
  if (!names.has('created_at')) {
    db.exec('ALTER TABLE entities ADD COLUMN created_at INTEGER');
  }
}

function migrateSynthesisCache(db: Database.Database) {
  const legacyCount = (
    db.prepare(
      "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='concept_synthesis'"
    ).get() as { n: number }
  ).n;
  if (!legacyCount) return;

  const copied = (
    db.prepare('SELECT COUNT(*) as n FROM concept_synthesis_cache').get() as { n: number }
  ).n;
  if (copied > 0) return;

  db.exec(`
    INSERT OR IGNORE INTO concept_synthesis_cache
      (entity_id, profile, paragraph_json, generator, model, generated_at)
    SELECT entity_id, 'live', paragraph_json, generator, model, generated_at
    FROM concept_synthesis
  `);
}

function migrateSynthesisQueue(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(synthesis_queue)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('root_slug')) {
    db.exec('ALTER TABLE synthesis_queue ADD COLUMN root_slug TEXT');
  }
  if (!names.has('profile')) {
    db.exec("ALTER TABLE synthesis_queue ADD COLUMN profile TEXT NOT NULL DEFAULT 'queued'");
  }
}

// Tier 1.5: documents grew a source_kind + source_ext column so we can
// remember how each row was parsed (markdown vs text vs svg). Existing rows
// all came from markdown ingest, so we default-fill them accordingly.
function migrateDocumentsSource(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(documents)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('source_kind')) {
    db.exec("ALTER TABLE documents ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'markdown'");
  }
  if (!names.has('source_ext')) {
    db.exec("ALTER TABLE documents ADD COLUMN source_ext TEXT NOT NULL DEFAULT '.md'");
  }
}
