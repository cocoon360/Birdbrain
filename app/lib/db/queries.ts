import { getDb } from './database';
import type { Paragraph } from '../synthesis/types';
import { slugifyPhrase } from '../synthesis/spanify';

export interface DocumentRow {
  id: number;
  path: string;
  title: string;
  status: string;
  category: string;
  word_count: number;
  file_mtime: number;
  ingested_at: number;
}

export interface ChunkRow {
  id: number;
  document_id: number;
  heading: string | null;
  heading_level: number;
  body: string;
  chunk_index: number;
  word_count: number;
}

export interface SearchResult {
  chunk_id: number;
  document_id: number;
  doc_title: string;
  doc_path: string;
  doc_status: string;
  doc_category: string;
  heading: string | null;
  snippet: string;
  sort_score: number;
}

export interface EntityRow {
  id: number;
  slug: string;
  name: string;
  type: string;
  summary: string;
  mention_count: number;
  document_count: number;
  canon_docs: number;
  working_docs: number;
}

export interface EntityMentionRow {
  entity_slug: string;
  entity_name: string;
  match_count: number;
}

export interface EntityEvidenceRow {
  entity_slug: string;
  entity_name: string;
  entity_type: string;
  doc_id: number;
  doc_title: string;
  doc_path: string;
  doc_status: string;
  heading: string | null;
  body: string;
  match_count: number;
  file_mtime: number;
}

export interface AlertRow {
  kind: 'working-drift' | 'archive-shadow' | 'no-canon-anchor';
  title: string;
  description: string;
  entity_slug: string;
}

export interface EntityAliasRow {
  id: number;
  slug: string;
  name: string;
  type: string;
  aliases: string[];
}

// Lightweight variant of getEntities that returns parsed aliases — used by
// the brief route to infer which concepts a free-text query is about without
// any hardcoded concept list.
export function getAllEntitiesWithAliases(): EntityAliasRow[] {
  const rows = getDb()
    .prepare('SELECT id, slug, name, type, aliases_json FROM entities')
    .all() as Array<{ id: number; slug: string; name: string; type: string; aliases_json: string }>;
  return rows.map((r) => {
    let aliases: string[] = [];
    try {
      const parsed = JSON.parse(r.aliases_json);
      if (Array.isArray(parsed)) aliases = parsed.filter((a) => typeof a === 'string');
    } catch {
      // ignore
    }
    return { id: r.id, slug: r.slug, name: r.name, type: r.type, aliases };
  });
}

export function getEntitiesByType(type: string): EntityRow[] {
  return getEntities(type, 500);
}

function buildMatchQuery(query: string): string {
  const cleaned = query
    .trim()
    .replace(/[^\w\s"-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  const quoted = cleaned.includes('"') ? cleaned : `"${cleaned}"`;
  const tokenized = cleaned
    .split(' ')
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(' OR ');

  return `${quoted} OR ${tokenized}`;
}

function statusPrioritySql(): string {
  return `
    CASE d.status
      WHEN 'canon' THEN 0
      WHEN 'working' THEN 1
      WHEN 'active' THEN 2
      WHEN 'reference' THEN 3
      WHEN 'brainstorm' THEN 4
      WHEN 'archive' THEN 5
      ELSE 6
    END
  `;
}

// ── Documents ────────────────────────────────────────────────────────────────

export function getAllDocuments(status?: string): DocumentRow[] {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM documents WHERE status = ? ORDER BY file_mtime DESC')
      .all(status) as DocumentRow[];
  }
  return db.prepare('SELECT * FROM documents ORDER BY file_mtime DESC').all() as DocumentRow[];
}

export function getDocument(id: number): DocumentRow | undefined {
  return getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
}

export function getChunksForDocument(documentId: number): ChunkRow[] {
  return getDb()
    .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index')
    .all(documentId) as ChunkRow[];
}

export function getCanonDocuments(): DocumentRow[] {
  return getAllDocuments('canon');
}

export function getTimeline(limit = 30): DocumentRow[] {
  return getDb()
    .prepare('SELECT * FROM documents ORDER BY file_mtime DESC LIMIT ?')
    .all(limit) as DocumentRow[];
}

// ── Search + retrieval ───────────────────────────────────────────────────────

export function searchChunks(query: string, limit = 20, status?: string): SearchResult[] {
  return searchRelevantChunks(query, { limit, status });
}

export function searchRelevantChunks(
  query: string,
  options: { limit?: number; status?: string; documentIds?: number[] } = {}
): SearchResult[] {
  const db = getDb();
  const matchQuery = buildMatchQuery(query);
  if (!matchQuery) return [];

  const params: Array<string | number> = [matchQuery];
  let sql = `
    SELECT
      c.id AS chunk_id,
      c.document_id,
      d.title AS doc_title,
      d.path AS doc_path,
      d.status AS doc_status,
      d.category AS doc_category,
      c.heading,
      snippet(chunks_fts, 0, '<mark>', '</mark>', '…', 24) AS snippet,
      (${statusPrioritySql()} * 10.0 + bm25(chunks_fts)) AS sort_score
    FROM chunks_fts
    JOIN chunks c ON c.id = chunks_fts.rowid
    JOIN documents d ON d.id = c.document_id
    WHERE chunks_fts MATCH ?
  `;

  if (options.status) {
    sql += ' AND d.status = ?';
    params.push(options.status);
  }

  if (options.documentIds?.length) {
    sql += ` AND d.id IN (${options.documentIds.map(() => '?').join(',')})`;
    params.push(...options.documentIds);
  }

  sql += ' ORDER BY sort_score ASC, d.file_mtime DESC LIMIT ?';
  params.push(options.limit ?? 12);

  return db.prepare(sql).all(...params) as SearchResult[];
}

// ── Entities ─────────────────────────────────────────────────────────────────

export function getEntities(type?: string, limit = 24): EntityRow[] {
  const db = getDb();
  const params: Array<string | number> = [];
  let sql = `
    SELECT
      e.id,
      e.slug,
      e.name,
      e.type,
      e.summary,
      COALESCE(SUM(em.match_count), 0) AS mention_count,
      COUNT(DISTINCT em.document_id) AS document_count,
      COUNT(DISTINCT CASE WHEN d.status = 'canon' THEN em.document_id END) AS canon_docs,
      COUNT(DISTINCT CASE WHEN d.status = 'working' THEN em.document_id END) AS working_docs
    FROM entities e
    LEFT JOIN entity_mentions em ON em.entity_id = e.id
    LEFT JOIN documents d ON d.id = em.document_id
  `;

  if (type) {
    sql += ' WHERE e.type = ?';
    params.push(type);
  }

  sql += `
    GROUP BY e.id
    ORDER BY mention_count DESC, canon_docs DESC, e.name ASC
    LIMIT ?
  `;
  params.push(limit);

  return db.prepare(sql).all(...params) as EntityRow[];
}

export function getEntityBySlug(slug: string): EntityRow | undefined {
  const rows = getEntities(undefined, 500);
  return rows.find((row) => row.slug === slug);
}

export function getEntityMentions(slug: string, limit = 18): EntityEvidenceRow[] {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT
        e.slug AS entity_slug,
        e.name AS entity_name,
        e.type AS entity_type,
        d.id AS doc_id,
        d.title AS doc_title,
        d.path AS doc_path,
        d.status AS doc_status,
        c.heading,
        c.body,
        em.match_count,
        d.file_mtime
      FROM entity_mentions em
      JOIN entities e ON e.id = em.entity_id
      JOIN documents d ON d.id = em.document_id
      JOIN chunks c ON c.id = em.chunk_id
      WHERE e.slug = ?
      ORDER BY ${statusPrioritySql()} ASC, em.match_count DESC, d.file_mtime DESC
      LIMIT ?
    `
    )
    .all(slug, limit) as EntityEvidenceRow[];
}

export function getDocumentEntityMentions(documentId: number): EntityMentionRow[] {
  return getDb()
    .prepare(
      `
      SELECT
        e.slug AS entity_slug,
        e.name AS entity_name,
        SUM(em.match_count) AS match_count
      FROM entity_mentions em
      JOIN entities e ON e.id = em.entity_id
      WHERE em.document_id = ?
      GROUP BY e.id
      ORDER BY match_count DESC, e.name ASC
    `
    )
    .all(documentId) as EntityMentionRow[];
}

export function getRelatedEntities(slug: string, limit = 8): EntityRow[] {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT
        e2.id,
        e2.slug,
        e2.name,
        e2.type,
        e2.summary,
        SUM(em2.match_count) AS mention_count,
        COUNT(DISTINCT em2.document_id) AS document_count,
        COUNT(DISTINCT CASE WHEN d.status = 'canon' THEN em2.document_id END) AS canon_docs,
        COUNT(DISTINCT CASE WHEN d.status = 'working' THEN em2.document_id END) AS working_docs
      FROM entities e1
      JOIN entity_mentions em1 ON em1.entity_id = e1.id
      JOIN entity_mentions em2 ON em2.document_id = em1.document_id AND em2.entity_id != em1.entity_id
      JOIN entities e2 ON e2.id = em2.entity_id
      JOIN documents d ON d.id = em2.document_id
      WHERE e1.slug = ?
      GROUP BY e2.id
      ORDER BY
        canon_docs DESC,
        working_docs DESC,
        document_count DESC,
        mention_count DESC,
        MAX(d.file_mtime) DESC
      LIMIT ?
    `
    )
    .all(slug, limit) as EntityRow[];
}

export function getAlerts(limit = 12): AlertRow[] {
  const rows = getEntities(undefined, 200);
  const alerts: AlertRow[] = [];

  for (const row of rows) {
    if (row.working_docs > 0 && row.canon_docs === 0) {
      alerts.push({
        kind: 'no-canon-anchor',
        entity_slug: row.slug,
        title: `${row.name} has working activity but no canon anchor`,
        description: 'This concept appears in working material but is not grounded in canon docs yet.',
      });
    } else if (row.working_docs >= 2 && row.canon_docs >= 1) {
      alerts.push({
        kind: 'working-drift',
        entity_slug: row.slug,
        title: `${row.name} is actively evolving`,
        description: 'This concept appears in both canon and working docs, so it may need explicit comparison.',
      });
    } else if (row.document_count >= 6 && row.canon_docs <= 1) {
      alerts.push({
        kind: 'archive-shadow',
        entity_slug: row.slug,
        title: `${row.name} has lots of history but weak current grounding`,
        description: 'The concept is spread across many documents, but little of that weight is in canon.',
      });
    }
  }

  return alerts.slice(0, limit);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export interface CorpusStats {
  total_docs: number;
  canon_docs: number;
  working_docs: number;
  archive_docs: number;
  total_chunks: number;
  total_entities: number;
  last_ingested: number | null;
}

export interface ProjectMeta {
  project_name: string;
  docs_root: string;
  guidance_notes: string;
  guidance_files: string[];
  corpus_signature: string;
  engine_provider: string;
  engine_model: string;
  engine_endpoint: string;
  engine_api_key_env: string;
}

export function getProjectMeta(): ProjectMeta {
  const rows = getDb()
    .prepare('SELECT key, value FROM project_meta')
    .all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    project_name: map.get('project_name') ?? 'Bird Brain',
    docs_root: map.get('docs_root') ?? '',
    guidance_notes: map.get('guidance_notes') ?? '',
    guidance_files: safeJsonArray(map.get('guidance_files') ?? '[]'),
    corpus_signature: map.get('corpus_signature') ?? '',
    engine_provider: map.get('engine_provider') ?? 'cursor-cli',
    engine_model: map.get('engine_model') ?? '',
    engine_endpoint: map.get('engine_endpoint') ?? '',
    engine_api_key_env: map.get('engine_api_key_env') ?? '',
  };
}

export function setProjectMetaValue(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO project_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export interface ProjectEngineConfig {
  provider: string;
  model?: string | null;
  endpoint?: string | null;
  apiKeyEnvVar?: string | null;
}

export function setProjectEngineConfig(config: ProjectEngineConfig) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO project_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  const tx = db.transaction(() => {
    stmt.run('engine_provider', config.provider);
    stmt.run('engine_model', config.model ?? '');
    stmt.run('engine_endpoint', config.endpoint ?? '');
    stmt.run('engine_api_key_env', config.apiKeyEnvVar ?? '');
  });
  tx();
}

export interface OntologyRunRow {
  id: number;
  corpus_signature: string;
  startup_mode: string;
  status: string;
  overview_json: string | null;
  summary_text: string | null;
  error_text: string | null;
  started_at: number;
  completed_at: number | null;
}

export interface StartupStatus {
  ready: boolean;
  running: boolean;
  stale: boolean;
  failed: boolean;
  missing: boolean;
  current_corpus_signature: string;
  ontology_corpus_signature: string | null;
  latest_run: OntologyRunRow | null;
}

export function getLatestOntologyRun(): OntologyRunRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, corpus_signature, startup_mode, status, overview_json, summary_text,
                error_text, started_at, completed_at
         FROM ontology_runs
         ORDER BY started_at DESC
         LIMIT 1`
      )
      .get() as OntologyRunRow | undefined) ?? null
  );
}

export function getStartupStatus(): StartupStatus {
  const meta = getProjectMeta();
  const latest = getLatestOntologyRun();
  const current = meta.corpus_signature;
  const latestSig = latest?.corpus_signature ?? null;
  const missing = !latest;
  const running = latest?.status === 'running';
  const failed = latest?.status === 'failed';
  const stale = Boolean(latestSig && current && latestSig !== current);
  const ready = Boolean(latest?.status === 'ready' && !stale);
  return {
    ready,
    running,
    stale,
    failed,
    missing,
    current_corpus_signature: current,
    ontology_corpus_signature: latestSig,
    latest_run: latest,
  };
}

export function clearStaleGeneratedArtifacts(input: {
  currentCorpusSignature: string;
  ontologyCorpusSignature: string | null;
}) {
  const { currentCorpusSignature, ontologyCorpusSignature } = input;
  if (
    !currentCorpusSignature ||
    !ontologyCorpusSignature ||
    currentCorpusSignature === ontologyCorpusSignature
  ) {
    return false;
  }

  const db = getDb();
  const markerKey = 'artifact_cleanup_signature';
  const existingMarker = db
    .prepare(`SELECT value FROM project_meta WHERE key = ?`)
    .get(markerKey) as { value: string } | undefined;
  if (existingMarker?.value === currentCorpusSignature) {
    return false;
  }

  db.transaction(() => {
    db.prepare(`DELETE FROM concept_synthesis_cache`).run();
    db.prepare(`DELETE FROM synthesis_queue`).run();
    db.prepare(
      `INSERT INTO project_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(markerKey, currentCorpusSignature);
  })();
  return true;
}

export function startOntologyRun(input: {
  corpusSignature: string;
  startupMode: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const result = getDb()
    .prepare(
      `INSERT INTO ontology_runs
        (corpus_signature, startup_mode, status, started_at)
       VALUES (?, ?, 'running', ?)`
    )
    .run(input.corpusSignature, input.startupMode, now);
  return Number(result.lastInsertRowid);
}

export function completeOntologyRun(input: {
  runId: number;
  summaryText: string;
  overviewJson: string;
}) {
  getDb()
    .prepare(
      `UPDATE ontology_runs
       SET status = 'ready', summary_text = ?, overview_json = ?, error_text = NULL, completed_at = ?
       WHERE id = ?`
    )
    .run(input.summaryText, input.overviewJson, Math.floor(Date.now() / 1000), input.runId);
}

export function failOntologyRun(runId: number, errorText: string) {
  getDb()
    .prepare(
      `UPDATE ontology_runs
       SET status = 'failed', error_text = ?, completed_at = ?
       WHERE id = ?`
    )
    .run(errorText, Math.floor(Date.now() / 1000), runId);
}

export interface OntologyConceptRow {
  slug: string;
  name: string;
  type: string;
  aliases: string[];
  summary: string;
  rationale: string;
}

export interface StarterLensRow {
  concept_slug: string;
  title: string;
  description: string;
  order_index: number;
}

export function replaceOntologyArtifacts(input: {
  runId: number;
  concepts: OntologyConceptRow[];
  lenses: StarterLensRow[];
}) {
  const db = getDb();
  const insertConcept = db.prepare(
    `INSERT INTO ontology_concepts
      (run_id, slug, name, type, aliases_json, summary, rationale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       run_id = excluded.run_id,
       name = excluded.name,
       type = excluded.type,
       aliases_json = excluded.aliases_json,
       summary = excluded.summary,
       rationale = excluded.rationale,
       created_at = excluded.created_at`
  );
  const insertLens = db.prepare(
    `INSERT INTO ontology_lenses (run_id, concept_slug, title, description, order_index)
     VALUES (?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.prepare('DELETE FROM ontology_concepts').run();
    db.prepare('DELETE FROM ontology_lenses').run();
    const now = Math.floor(Date.now() / 1000);
    for (const concept of input.concepts) {
      insertConcept.run(
        input.runId,
        concept.slug,
        concept.name,
        concept.type,
        JSON.stringify(concept.aliases),
        concept.summary,
        concept.rationale,
        now
      );
    }
    input.lenses.forEach((lens, index) => {
      insertLens.run(input.runId, lens.concept_slug, lens.title, lens.description, lens.order_index ?? index);
    });
  })();
}

export function getOntologyConcepts(type?: string, limit = 60): EntityAliasRow[] {
  const db = getDb();
  const params: Array<string | number> = [];
  let sql = `
    SELECT oc.slug, oc.name, oc.type, oc.aliases_json, oc.id
    FROM ontology_concepts oc
  `;
  if (type) {
    sql += ' WHERE oc.type = ?';
    params.push(type);
  }
  sql += ' ORDER BY oc.name ASC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Array<{
    id: number;
    slug: string;
    name: string;
    type: string;
    aliases_json: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    type: r.type,
    aliases: safeJsonArray(r.aliases_json),
  }));
}

export function getStarterLenses(limit = 8): Array<StarterLensRow & { concept_name: string; concept_type: string }> {
  return getDb()
    .prepare(
      `SELECT ol.concept_slug, ol.title, ol.description, ol.order_index,
              oc.name as concept_name, oc.type as concept_type
       FROM ontology_lenses ol
       JOIN ontology_concepts oc ON oc.slug = ol.concept_slug
       ORDER BY ol.order_index ASC, ol.id ASC
       LIMIT ?`
    )
    .all(limit) as Array<StarterLensRow & { concept_name: string; concept_type: string }>;
}

export function getStarterLensConcepts(
  limit = 8
): Array<{
  slug: string;
  name: string;
  type: string;
  summary: string;
  mention_count: number;
  canon_docs: number;
  working_docs: number;
  document_count: number;
  lens_title: string;
  lens_description: string;
  order_index: number;
}> {
  return getDb()
    .prepare(
      `SELECT
         e.slug,
         e.name,
         e.type,
         COALESCE(oc.summary, e.summary, '') AS summary,
         COALESCE(SUM(em.match_count), 0) AS mention_count,
         COUNT(DISTINCT CASE WHEN d.status = 'canon' THEN em.document_id END) AS canon_docs,
         COUNT(DISTINCT CASE WHEN d.status = 'working' THEN em.document_id END) AS working_docs,
         COUNT(DISTINCT em.document_id) AS document_count,
         ol.title AS lens_title,
         ol.description AS lens_description,
         ol.order_index
       FROM ontology_lenses ol
       JOIN ontology_concepts oc ON oc.slug = ol.concept_slug
       JOIN entities e ON e.slug = oc.slug
       LEFT JOIN entity_mentions em ON em.entity_id = e.id
       LEFT JOIN documents d ON d.id = em.document_id
       GROUP BY ol.id, e.id, oc.summary
       ORDER BY ol.order_index ASC, ol.id ASC
       LIMIT ?`
    )
    .all(limit) as Array<{
      slug: string;
      name: string;
      type: string;
      summary: string;
      mention_count: number;
      canon_docs: number;
      working_docs: number;
      document_count: number;
      lens_title: string;
      lens_description: string;
      order_index: number;
    }>;
}

export function getOntologyConceptRows(type?: string, limit = 100): EntityRow[] {
  const params: Array<string | number> = [];
  let sql = `
    SELECT
      e.id,
      e.slug,
      e.name,
      e.type,
      COALESCE(oc.summary, e.summary, '') AS summary,
      COALESCE(SUM(em.match_count), 0) AS mention_count,
      COUNT(DISTINCT em.document_id) AS document_count,
      COUNT(DISTINCT CASE WHEN d.status = 'canon' THEN em.document_id END) AS canon_docs,
      COUNT(DISTINCT CASE WHEN d.status = 'working' THEN em.document_id END) AS working_docs
    FROM ontology_concepts oc
    JOIN entities e ON e.slug = oc.slug
    LEFT JOIN entity_mentions em ON em.entity_id = e.id
    LEFT JOIN documents d ON d.id = em.document_id
  `;
  if (type) {
    sql += ' WHERE e.type = ?';
    params.push(type);
  }
  sql += ' GROUP BY e.id, oc.summary ORDER BY mention_count DESC, canon_docs DESC, e.name ASC LIMIT ?';
  params.push(limit);
  return getDb().prepare(sql).all(...params) as EntityRow[];
}

// ── Synthesis ────────────────────────────────────────────────────────────────

export interface SynthesisRow {
  entity_id: number;
  profile: string;
  paragraph: Paragraph;
  generator: string;
  model: string | null;
  generated_at: number;
}

export function getSynthesisForSlug(slug: string, profile = 'live'): SynthesisRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cs.entity_id, cs.profile, cs.paragraph_json, cs.generator, cs.model, cs.generated_at
       FROM concept_synthesis_cache cs
       JOIN entities e ON e.id = cs.entity_id
       WHERE e.slug = ? AND cs.profile = ?`
    )
    .get(slug, profile) as
    | {
        entity_id: number;
        profile: string;
        paragraph_json: string;
        generator: string;
        model: string | null;
        generated_at: number;
      }
    | undefined;
  if (!row) return null;
  let paragraph: Paragraph = [];
  try {
    const parsed = JSON.parse(row.paragraph_json);
    if (Array.isArray(parsed)) paragraph = parsed as Paragraph;
  } catch {
    return null;
  }
  return {
    entity_id: row.entity_id,
    profile: row.profile,
    paragraph,
    generator: row.generator,
    model: row.model,
    generated_at: row.generated_at,
  };
}

export function upsertSynthesis(input: {
  entityId: number;
  profile?: string;
  paragraph: Paragraph;
  generator: string;
  model?: string | null;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO concept_synthesis_cache (entity_id, profile, paragraph_json, generator, model, generated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_id, profile) DO UPDATE SET
       paragraph_json = excluded.paragraph_json,
       generator = excluded.generator,
       model = excluded.model,
       generated_at = excluded.generated_at`
  ).run(
    input.entityId,
    input.profile ?? 'live',
    JSON.stringify(input.paragraph),
    input.generator,
    input.model ?? null,
    Math.floor(Date.now() / 1000)
  );
}

export interface QueueEntry {
  id: number;
  entity_id: number;
  slug: string;
  name: string;
  type: string;
  context_slug: string | null;
  root_slug: string | null;
  profile: string;
  requested_at: number;
  status: string;
}

export function enqueueSynthesis(input: {
  entityId: number;
  contextSlug: string | null;
  rootSlug?: string | null;
  profile?: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO synthesis_queue (entity_id, context_slug, root_slug, profile, requested_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')
       ON CONFLICT(entity_id) DO UPDATE SET
         context_slug = COALESCE(synthesis_queue.context_slug, excluded.context_slug),
         root_slug = COALESCE(excluded.root_slug, synthesis_queue.root_slug),
         profile = excluded.profile,
         status = CASE WHEN synthesis_queue.status = 'done' THEN 'pending' ELSE synthesis_queue.status END`
    )
    .run(
      input.entityId,
      input.contextSlug,
      input.rootSlug ?? null,
      input.profile ?? 'queued',
      Math.floor(Date.now() / 1000)
    );
}

export function getPendingQueue(limit = 50, profile?: string): QueueEntry[] {
  const params: Array<number | string> = [];
  let sql = `
    SELECT q.id, q.entity_id, q.context_slug, q.root_slug, q.profile, q.requested_at, q.status,
            e.slug, e.name, e.type
     FROM synthesis_queue q
     JOIN entities e ON e.id = q.entity_id
     WHERE q.status = 'pending'
  `;
  if (profile) {
    sql += ' AND q.profile = ?';
    params.push(profile);
  }
  sql += ' ORDER BY q.requested_at ASC LIMIT ?';
  params.push(limit);
  return getDb()
    .prepare(sql)
    .all(...params) as QueueEntry[];
}

export function claimPendingQueue(limit = 1, profile = 'queued'): QueueEntry[] {
  const db = getDb();
  return db.transaction(() => {
    const rows = getPendingQueue(limit, profile);
    const claim = db.prepare(
      `UPDATE synthesis_queue SET status = 'processing' WHERE entity_id = ? AND profile = ?`
    );
    const claimed: QueueEntry[] = [];
    for (const row of rows) {
      claim.run(row.entity_id, row.profile);
      claimed.push({ ...row, status: 'processing' });
    }
    return claimed;
  })();
}

export function markQueueDone(entityId: number, profile = 'queued') {
  getDb()
    .prepare(`UPDATE synthesis_queue SET status = 'done' WHERE entity_id = ? AND profile = ?`)
    .run(entityId, profile);
}

export function markQueuePending(entityId: number, profile = 'queued') {
  getDb()
    .prepare(`UPDATE synthesis_queue SET status = 'pending' WHERE entity_id = ? AND profile = ?`)
    .run(entityId, profile);
}

export interface QueueStats {
  pending: number;
  processing: number;
}

export function getQueueStats(profile = 'queued'): QueueStats {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) as n
       FROM synthesis_queue
       WHERE profile = ?
       GROUP BY status`
    )
    .all(profile) as Array<{ status: string; n: number }>;
  const map = new Map(rows.map((r) => [r.status, r.n]));
  return {
    pending: map.get('pending') ?? 0,
    processing: map.get('processing') ?? 0,
  };
}

// Promote (or return existing) an entity from a free-text phrase. Used when
// a user clicks a `candidate` span. If a seeded entity already matches, returns
// it; otherwise creates a new entity with source='emerged'.
export function promoteCandidate(phrase: string, contextSlug: string | null): EntityRow {
  const db = getDb();
  const trimmed = phrase.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new Error('Empty phrase');
  const slug = slugifyPhrase(trimmed);
  if (!slug) throw new Error('Could not derive slug from phrase');

  const existing = db
    .prepare('SELECT id FROM entities WHERE slug = ?')
    .get(slug) as { id: number } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO entities (slug, name, type, aliases_json, summary, source, emerged_from, created_at)
       VALUES (?, ?, 'concept', '[]', '', 'emerged', ?, ?)`
    ).run(slug, trimmed, contextSlug, Math.floor(Date.now() / 1000));
  }
  const row = getEntityBySlug(slug);
  if (!row) throw new Error('Failed to promote candidate');
  return row;
}

export interface EmergedRow {
  slug: string;
  name: string;
  type: string;
  emerged_from: string | null;
  created_at: number | null;
  has_synthesis: number;
}

export function getEmergedEntities(limit = 12, profile = 'live'): EmergedRow[] {
  return getDb()
    .prepare(
      `SELECT e.slug, e.name, e.type, e.emerged_from, e.created_at,
              CASE WHEN cs.entity_id IS NULL THEN 0 ELSE 1 END AS has_synthesis
       FROM entities e
       LEFT JOIN concept_synthesis_cache cs ON cs.entity_id = e.id AND cs.profile = ?
       WHERE e.source = 'emerged'
       ORDER BY COALESCE(e.created_at, 0) DESC
       LIMIT ?`
    )
    .all(profile, limit) as EmergedRow[];
}

export function getCorpusStats(): CorpusStats {
  const db = getDb();
  const total_docs = (db.prepare('SELECT COUNT(*) as n FROM documents').get() as { n: number }).n;
  const canon_docs = (db.prepare("SELECT COUNT(*) as n FROM documents WHERE status='canon'").get() as { n: number }).n;
  const working_docs = (db.prepare("SELECT COUNT(*) as n FROM documents WHERE status='working'").get() as { n: number }).n;
  const archive_docs = (db.prepare("SELECT COUNT(*) as n FROM documents WHERE status='archive'").get() as { n: number }).n;
  const total_chunks = (db.prepare('SELECT COUNT(*) as n FROM chunks').get() as { n: number }).n;
  const total_entities = (db.prepare('SELECT COUNT(*) as n FROM entities').get() as { n: number }).n;
  const last_run = db.prepare('SELECT MAX(ran_at) as t FROM ingestion_runs').get() as { t: number | null };
  return {
    total_docs,
    canon_docs,
    working_docs,
    archive_docs,
    total_chunks,
    total_entities,
    last_ingested: last_run.t,
  };
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
