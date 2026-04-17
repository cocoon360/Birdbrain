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
  ingested_at INTEGER NOT NULL
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
