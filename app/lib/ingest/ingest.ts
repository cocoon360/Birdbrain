import path from 'path';
import { getDb } from '../db/database';
import { parseMarkdownFile, walkMarkdownFiles, type ParsedDocument } from './parse';
import { loadProjectGuidance, splitGuidanceFiles } from './project-guidance';

function deriveProjectName(docsRoot: string): string {
  const base = path.basename(path.resolve(docsRoot));
  // Clean numeric/underscore prefixes and normalize casing.
  return base
    .replace(/^[_\d]+/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || base;
}

interface IngestStats {
  added: number;
  updated: number;
  removed: number;
  total: number;
  entities_seeded: number;
  mentions_recorded: number;
}

export interface RunIngestionOptions {
  userGuidance?: string;
}

export function runIngestion(
  docsRoot: string,
  options: RunIngestionOptions = {}
): IngestStats {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stats: IngestStats = {
    added: 0,
    updated: 0,
    removed: 0,
    total: 0,
    entities_seeded: 0,
    mentions_recorded: 0,
  };

  const files = walkMarkdownFiles(docsRoot);
  const { guidance: guidanceFiles, content: contentFiles } = splitGuidanceFiles(files, docsRoot);
  const guidance = loadProjectGuidance(guidanceFiles, docsRoot);
  stats.total = contentFiles.length;
  console.log(`Found ${contentFiles.length} markdown files in ${docsRoot}`);
  if (guidance.source_files.length) {
    console.log(`Loaded ${guidance.source_files.length} guidance file(s): ${guidance.source_files.join(', ')}`);
  }

  // ── Pass 1: Parse every document into memory ───────────────────────────────
  const parsed: ParsedDocument[] = [];
  for (const file of contentFiles) {
    try {
      parsed.push(parseMarkdownFile(file, docsRoot));
    } catch (err) {
      console.error(`Error parsing ${file}:`, err);
    }
  }

  // ── Prepared statements ────────────────────────────────────────────────────
  const existingPaths = new Set<string>(
    (db.prepare('SELECT path FROM documents').all() as { path: string }[]).map((r) => r.path)
  );

  const upsertDoc = db.prepare(`
    INSERT INTO documents (path, title, status, category, word_count, file_mtime, ingested_at)
    VALUES (@path, @title, @status, @category, @word_count, @file_mtime, @ingested_at)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      category = excluded.category,
      word_count = excluded.word_count,
      file_mtime = excluded.file_mtime,
      ingested_at = excluded.ingested_at
  `);

  const getDocId = db.prepare('SELECT id FROM documents WHERE path = ?');
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE document_id = ?');
  const insertChunk = db.prepare(`
    INSERT INTO chunks (document_id, heading, heading_level, body, chunk_index, word_count)
    VALUES (@document_id, @heading, @heading_level, @body, @chunk_index, @word_count)
  `);

  // ── Pass 2: Insert documents and chunks only ───────────────────────────────
  const seenPaths = new Set<string>();

  const ingestFile = db.transaction((doc: ParsedDocument) => {
    seenPaths.add(doc.file_path);
    const isNew = !existingPaths.has(doc.file_path);

    upsertDoc.run({
      path: doc.file_path,
      title: doc.title,
      status: doc.status,
      category: doc.category,
      word_count: doc.word_count,
      file_mtime: doc.file_mtime,
      ingested_at: now,
    });

    const docRow = getDocId.get(doc.file_path) as { id: number } | undefined;
    if (!docRow) return;
    const docId = docRow.id;

    deleteChunks.run(docId);

    for (const chunk of doc.chunks) {
      insertChunk.run({
        document_id: docId,
        heading: chunk.heading ?? null,
        heading_level: chunk.heading_level,
        body: chunk.body,
        chunk_index: chunk.chunk_index,
        word_count: chunk.word_count,
      });
    }

    if (isNew) stats.added++;
    else stats.updated++;
  });

  for (const doc of parsed) {
    try {
      ingestFile(doc);
    } catch (err) {
      console.error(`Error ingesting ${doc.file_path}:`, err);
    }
  }

  // Remove documents whose files no longer exist
  const allDocs = db.prepare('SELECT id, path FROM documents').all() as { id: number; path: string }[];
  const removeSmt = db.prepare('DELETE FROM documents WHERE id = ?');
  for (const doc of allDocs) {
    if (!seenPaths.has(doc.path)) {
      removeSmt.run(doc.id);
      stats.removed++;
    }
  }

  db.prepare(`
    INSERT INTO ingestion_runs (ran_at, docs_added, docs_updated, docs_removed)
    VALUES (?, ?, ?, ?)
  `).run(now, stats.added, stats.updated, stats.removed);

  // Record project metadata derived from the folder we were pointed at. This
  // is how the UI stays project-agnostic: there is no hardcoded project name.
  const projectName = deriveProjectName(docsRoot);
  db.prepare(`
    INSERT INTO project_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('project_name', projectName);
  db.prepare(`
    INSERT INTO project_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('docs_root', docsRoot);
  db.prepare(`
    INSERT INTO project_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('guidance_files', JSON.stringify(guidance.source_files));
  db.prepare(`
    INSERT INTO project_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('guidance_priority_terms', JSON.stringify(guidance.prioritize_terms));
  db.prepare(`
    INSERT INTO project_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('guidance_ignore_terms', JSON.stringify(guidance.ignore_terms));
  const mergedGuidanceNotes = [options.userGuidance?.trim(), guidance.notes?.trim()]
    .filter((piece): piece is string => Boolean(piece && piece.length))
    .join('\n\n');
  db.prepare(`
    INSERT INTO project_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('guidance_notes', mergedGuidanceNotes);
  db.prepare(`
    INSERT INTO project_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('corpus_signature', buildCorpusSignature(parsed));

  return stats;
}

function buildCorpusSignature(parsed: ParsedDocument[]): string {
  const total = parsed.length;
  const maxMtime = parsed.reduce((max, doc) => Math.max(max, doc.file_mtime), 0);
  const totalWords = parsed.reduce((sum, doc) => sum + doc.word_count, 0);
  return `${total}:${maxMtime}:${totalWords}`;
}
