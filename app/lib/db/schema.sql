-- Bird Brain SQLite Schema

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Raw document records
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',  -- canon, working, active, archive, brainstorm, reference
  category TEXT NOT NULL DEFAULT 'general', -- character, world, systems, incidents, content, general
  word_count INTEGER DEFAULT 0,
  file_mtime INTEGER NOT NULL,             -- unix timestamp from file system
  ingested_at INTEGER NOT NULL             -- unix timestamp of last ingestion
);

-- Heading-delimited chunks from each document
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  heading TEXT,                            -- the heading this chunk falls under (null = top of doc)
  heading_level INTEGER DEFAULT 0,         -- 1-6 for h1-h6
  body TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,            -- order within document
  word_count INTEGER DEFAULT 0
);

-- FTS5 virtual table for full-text search over chunks
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  body,
  heading,
  title,
  status,
  category,
  content=chunks,
  content_rowid=id
);

-- Track each ingestion run for timeline purposes
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at INTEGER NOT NULL,
  docs_added INTEGER DEFAULT 0,
  docs_updated INTEGER DEFAULT 0,
  docs_removed INTEGER DEFAULT 0
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, body, heading, title, status, category)
  SELECT NEW.id, NEW.body, NEW.heading,
    (SELECT title FROM documents WHERE id = NEW.document_id),
    (SELECT status FROM documents WHERE id = NEW.document_id),
    (SELECT category FROM documents WHERE id = NEW.document_id);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, body, heading, title, status, category)
  VALUES('delete', OLD.id, OLD.body, OLD.heading, '', '', '');
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, body, heading, title, status, category)
  VALUES('delete', OLD.id, OLD.body, OLD.heading, '', '', '');
  INSERT INTO chunks_fts(rowid, body, heading, title, status, category)
  SELECT NEW.id, NEW.body, NEW.heading,
    (SELECT title FROM documents WHERE id = NEW.document_id),
    (SELECT status FROM documents WHERE id = NEW.document_id),
    (SELECT category FROM documents WHERE id = NEW.document_id);
END;
