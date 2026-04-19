// Participation / memesis layer queries.
//
// Clients fire-and-forget POST to /api/participation/event on every click.
// That endpoint calls ensureSession() + insertEvent() here. All reads for
// the Journal panel (trail, emerging candidates, drift) also land here.
//
// The tables all live in the same per-workspace SQLite DB so a reader's
// session is scoped to the workspace it happened in, never leaking across.

import { getDb } from './database';
import type { Paragraph } from '../synthesis/types';
import { slugifyPhrase } from '../synthesis/spanify';

// ── Sessions ─────────────────────────────────────────────────────────────────

export interface ParticipationSession {
  id: string;
  started_at: number;
  last_at: number;
}

/** Upsert a session row and bump last_at. Idempotent. */
export function touchSession(sessionId: string): ParticipationSession {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO participation_sessions (id, started_at, last_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_at = excluded.last_at`
  ).run(sessionId, now, now);
  return db
    .prepare('SELECT id, started_at, last_at FROM participation_sessions WHERE id = ?')
    .get(sessionId) as ParticipationSession;
}

// ── Events ───────────────────────────────────────────────────────────────────

export type EventKind =
  | 'open_concept'
  | 'open_doc'
  | 'impression'
  | 'promote'
  | 'dismiss'
  | 'ask'
  | 'search'
  | 'reset'
  | 'memesis';

export interface ParticipationEvent {
  id: number;
  session_id: string;
  at: number;
  kind: EventKind;
  slug: string | null;
  from_slug: string | null;
  phrase: string | null;
  doc_id: number | null;
  source: string | null;
}

export interface InsertEventInput {
  sessionId: string;
  kind: EventKind;
  slug?: string | null;
  fromSlug?: string | null;
  phrase?: string | null;
  docId?: number | null;
  source?: string | null;
}

export function insertEvent(input: InsertEventInput): ParticipationEvent {
  touchSession(input.sessionId);
  const db = getDb();
  const at = Math.floor(Date.now() / 1000);
  const info = db
    .prepare(
      `INSERT INTO participation_events
         (session_id, at, kind, slug, from_slug, phrase, doc_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sessionId,
      at,
      input.kind,
      input.slug ?? null,
      input.fromSlug ?? null,
      input.phrase ?? null,
      input.docId ?? null,
      input.source ?? null
    );
  return db
    .prepare(
      `SELECT id, session_id, at, kind, slug, from_slug, phrase, doc_id, source
       FROM participation_events WHERE id = ?`
    )
    .get(info.lastInsertRowid) as ParticipationEvent;
}

/**
 * Trail read: the last N events, newest first, optionally scoped to one
 * session. Enriched with entity names when slug is a known concept so the UI
 * never has to round-trip for labels.
 */
export interface TrailRow extends ParticipationEvent {
  concept_name: string | null;
  concept_type: string | null;
  doc_title: string | null;
}

export function getTrail(options: { sessionId?: string | null; limit?: number } = {}): TrailRow[] {
  const db = getDb();
  const limit = options.limit ?? 40;
  const params: Array<string | number> = [];
  let sql = `
    SELECT
      e.id, e.session_id, e.at, e.kind, e.slug, e.from_slug, e.phrase, e.doc_id, e.source,
      ent.name AS concept_name, ent.type AS concept_type,
      d.title AS doc_title
    FROM participation_events e
    LEFT JOIN entities ent ON ent.slug = e.slug
    LEFT JOIN documents d ON d.id = e.doc_id
  `;
  if (options.sessionId) {
    sql += ' WHERE e.session_id = ?';
    params.push(options.sessionId);
  }
  sql += ' ORDER BY e.at DESC, e.id DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params) as TrailRow[];
}

export function getEventCountForSession(sessionId: string): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM participation_events WHERE session_id = ?')
    .get(sessionId) as { n: number };
  return row.n;
}

// ── Candidate concepts ───────────────────────────────────────────────────────

export interface CandidateConceptRow {
  slug: string;
  phrase: string;
  first_seen: number;
  last_seen: number;
  impressions: number;
  clicks: number;
  distinct_sessions: number;
  co_concepts: string[];
  status: 'watching' | 'promoted' | 'dismissed';
}

interface CandidateRaw {
  slug: string;
  phrase: string;
  first_seen: number;
  last_seen: number;
  impressions: number;
  clicks: number;
  distinct_sessions: number;
  session_ids_json: string;
  co_concepts_json: string;
  status: 'watching' | 'promoted' | 'dismissed';
}

function parseStringArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function hydrateCandidate(raw: CandidateRaw): CandidateConceptRow {
  return {
    slug: raw.slug,
    phrase: raw.phrase,
    first_seen: raw.first_seen,
    last_seen: raw.last_seen,
    impressions: raw.impressions,
    clicks: raw.clicks,
    distinct_sessions: raw.distinct_sessions,
    co_concepts: parseStringArray(raw.co_concepts_json),
    status: raw.status,
  };
}

/**
 * Called on candidate span impression AND click. Upserts the candidate row,
 * tracks distinct sessions + co-occurring concepts. When kind='click' we
 * also bump the click counter.
 */
export function recordCandidate(input: {
  phrase: string;
  sessionId: string;
  contextSlug: string | null;
  kind: 'impression' | 'click';
}): CandidateConceptRow | null {
  const trimmed = input.phrase.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const slug = slugifyPhrase(trimmed);
  if (!slug) return null;

  const db = getDb();
  const existingEntity = db.prepare('SELECT id FROM entities WHERE slug = ?').get(slug) as
    | { id: number }
    | undefined;
  if (existingEntity) return null; // Already a real entity — don't shadow it.

  const now = Math.floor(Date.now() / 1000);
  const existing = db
    .prepare(
      `SELECT slug, phrase, first_seen, last_seen, impressions, clicks,
              distinct_sessions, session_ids_json, co_concepts_json, status
       FROM candidate_concepts WHERE slug = ?`
    )
    .get(slug) as CandidateRaw | undefined;

  if (!existing) {
    const sessions = JSON.stringify([input.sessionId]);
    const co = JSON.stringify(input.contextSlug ? [input.contextSlug] : []);
    db.prepare(
      `INSERT INTO candidate_concepts
         (slug, phrase, first_seen, last_seen, impressions, clicks,
          distinct_sessions, session_ids_json, co_concepts_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'watching')`
    ).run(
      slug,
      trimmed,
      now,
      now,
      input.kind === 'impression' ? 1 : 0,
      input.kind === 'click' ? 1 : 0,
      1,
      sessions,
      co
    );
  } else {
    const sessions = parseStringArray(existing.session_ids_json);
    if (!sessions.includes(input.sessionId)) sessions.push(input.sessionId);
    const co = parseStringArray(existing.co_concepts_json);
    if (input.contextSlug && !co.includes(input.contextSlug)) co.push(input.contextSlug);
    db.prepare(
      `UPDATE candidate_concepts
       SET last_seen = ?,
           impressions = impressions + ?,
           clicks = clicks + ?,
           distinct_sessions = ?,
           session_ids_json = ?,
           co_concepts_json = ?
       WHERE slug = ?`
    ).run(
      now,
      input.kind === 'impression' ? 1 : 0,
      input.kind === 'click' ? 1 : 0,
      sessions.length,
      JSON.stringify(sessions),
      JSON.stringify(co),
      slug
    );
  }

  const after = db
    .prepare(
      `SELECT slug, phrase, first_seen, last_seen, impressions, clicks,
              distinct_sessions, session_ids_json, co_concepts_json, status
       FROM candidate_concepts WHERE slug = ?`
    )
    .get(slug) as CandidateRaw;
  return hydrateCandidate(after);
}

export function markCandidateStatus(
  slug: string,
  status: 'promoted' | 'dismissed' | 'watching'
) {
  getDb()
    .prepare('UPDATE candidate_concepts SET status = ? WHERE slug = ?')
    .run(status, slug);
}

/**
 * List candidates still worth watching. Ranked by a simple attention score
 * (clicks weigh much more than impressions; session breadth helps).
 */
export function listWatchingCandidates(limit = 12): CandidateConceptRow[] {
  const rows = getDb()
    .prepare(
      `SELECT slug, phrase, first_seen, last_seen, impressions, clicks,
              distinct_sessions, session_ids_json, co_concepts_json, status
       FROM candidate_concepts
       WHERE status = 'watching'
       ORDER BY (clicks * 4 + distinct_sessions * 2 + impressions) DESC,
                last_seen DESC
       LIMIT ?`
    )
    .all(limit) as CandidateRaw[];
  return rows.map(hydrateCandidate);
}

// ── Drift radar ──────────────────────────────────────────────────────────────
//
// "Which concepts are gaining mass vs fading?"  We compute two slices:
//   rising  — clicked a lot in the last window but thinly documented in canon
//   fading  — heavily represented in canon but untouched this window
//
// Both queries are pure SQL. No LLM involved; this is the quantitative layer.

export interface DriftRow {
  slug: string;
  name: string;
  type: string;
  clicks: number;
  canon_docs: number;
  working_docs: number;
  document_count: number;
  mention_count: number;
  signal: 'rising' | 'fading';
  ratio: number;
}

const DRIFT_WINDOW_SECONDS = 60 * 60 * 24 * 7; // last 7 days

export function getDriftRadar(limit = 6): DriftRow[] {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - DRIFT_WINDOW_SECONDS;

  const rising = db
    .prepare(
      `SELECT e.slug, e.name, e.type,
              COUNT(DISTINCT pe.id) AS clicks,
              COUNT(DISTINCT CASE WHEN d.status = 'canon' THEN em.document_id END) AS canon_docs,
              COUNT(DISTINCT CASE WHEN d.status = 'working' THEN em.document_id END) AS working_docs,
              COUNT(DISTINCT em.document_id) AS document_count,
              COALESCE(SUM(em.match_count), 0) AS mention_count
       FROM entities e
       JOIN participation_events pe
         ON pe.slug = e.slug AND pe.kind = 'open_concept' AND pe.at >= ?
       LEFT JOIN entity_mentions em ON em.entity_id = e.id
       LEFT JOIN documents d ON d.id = em.document_id
       GROUP BY e.id
       ORDER BY (clicks * 1.0) / (canon_docs + 1) DESC, clicks DESC
       LIMIT ?`
    )
    .all(cutoff, limit) as Array<Omit<DriftRow, 'signal' | 'ratio'>>;

  const fading = db
    .prepare(
      `SELECT e.slug, e.name, e.type,
              0 AS clicks,
              COUNT(DISTINCT CASE WHEN d.status = 'canon' THEN em.document_id END) AS canon_docs,
              COUNT(DISTINCT CASE WHEN d.status = 'working' THEN em.document_id END) AS working_docs,
              COUNT(DISTINCT em.document_id) AS document_count,
              COALESCE(SUM(em.match_count), 0) AS mention_count
       FROM entities e
       LEFT JOIN entity_mentions em ON em.entity_id = e.id
       LEFT JOIN documents d ON d.id = em.document_id
       WHERE NOT EXISTS (
         SELECT 1 FROM participation_events pe
         WHERE pe.slug = e.slug AND pe.kind = 'open_concept' AND pe.at >= ?
       )
       GROUP BY e.id
       HAVING canon_docs >= 2
       ORDER BY canon_docs DESC, mention_count DESC
       LIMIT ?`
    )
    .all(cutoff, limit) as Array<Omit<DriftRow, 'signal' | 'ratio'>>;

  const risingWithSignal: DriftRow[] = rising.map((r) => ({
    ...r,
    signal: 'rising',
    ratio: r.canon_docs > 0 ? +(r.clicks / r.canon_docs).toFixed(2) : r.clicks,
  }));
  const fadingWithSignal: DriftRow[] = fading.map((r) => ({
    ...r,
    signal: 'fading',
    ratio: r.canon_docs,
  }));
  return [...risingWithSignal, ...fadingWithSignal];
}

// ── Session synthesis (memesis) ──────────────────────────────────────────────

export interface SessionSynthesisRow {
  id: number;
  session_id: string;
  paragraph: Paragraph;
  generator: string;
  model: string | null;
  event_count: number;
  generated_at: number;
}

export function insertSessionSynthesis(input: {
  sessionId: string;
  paragraph: Paragraph;
  generator: string;
  model: string | null;
  eventCount: number;
}): SessionSynthesisRow {
  const db = getDb();
  const at = Math.floor(Date.now() / 1000);
  const info = db
    .prepare(
      `INSERT INTO session_synthesis
         (session_id, paragraph_json, generator, model, event_count, generated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sessionId,
      JSON.stringify(input.paragraph),
      input.generator,
      input.model,
      input.eventCount,
      at
    );
  return {
    id: Number(info.lastInsertRowid),
    session_id: input.sessionId,
    paragraph: input.paragraph,
    generator: input.generator,
    model: input.model,
    event_count: input.eventCount,
    generated_at: at,
  };
}

export function getLatestSessionSynthesis(sessionId: string): SessionSynthesisRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, session_id, paragraph_json, generator, model, event_count, generated_at
       FROM session_synthesis
       WHERE session_id = ?
       ORDER BY generated_at DESC
       LIMIT 1`
    )
    .get(sessionId) as
    | {
        id: number;
        session_id: string;
        paragraph_json: string;
        generator: string;
        model: string | null;
        event_count: number;
        generated_at: number;
      }
    | undefined;
  if (!row) return null;
  let paragraph: Paragraph;
  try {
    paragraph = JSON.parse(row.paragraph_json) as Paragraph;
  } catch {
    return null;
  }
  return {
    id: row.id,
    session_id: row.session_id,
    paragraph,
    generator: row.generator,
    model: row.model,
    event_count: row.event_count,
    generated_at: row.generated_at,
  };
}

/** Concepts the reader has been circling in this session, ranked by clicks. */
export interface AttendedConcept {
  slug: string;
  name: string;
  type: string;
  clicks: number;
}

export function getTopAttendedConcepts(sessionId: string, limit = 8): AttendedConcept[] {
  return getDb()
    .prepare(
      `SELECT e.slug, e.name, e.type, COUNT(*) AS clicks
       FROM participation_events pe
       JOIN entities e ON e.slug = pe.slug
       WHERE pe.session_id = ? AND pe.kind = 'open_concept'
       GROUP BY e.id
       ORDER BY clicks DESC, MAX(pe.at) DESC
       LIMIT ?`
    )
    .all(sessionId, limit) as AttendedConcept[];
}
