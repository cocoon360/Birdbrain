import { NextRequest, NextResponse } from 'next/server';
import {
  searchRelevantChunks,
  getEntityMentions,
  getEntities,
  getEntitiesByType,
  getAllEntitiesWithAliases,
  type EntityEvidenceRow,
  type SearchResult,
  type EntityAliasRow,
  type EntityRow,
} from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import { getEngineForWorkspace, EngineError } from '@/lib/engine';

interface BriefEvidence {
  doc_id: number;
  chunk_id?: number;
  title: string;
  path: string;
  status: string;
  heading: string | null;
  snippet: string;
  match_count?: number;
  file_mtime?: number;
}

interface BriefBody {
  query?: string;
  entitySlug?: string;
  documentIds?: number[];
  mode?: 'retrieval' | 'entity';
}

function dedupeEvidence(evidence: BriefEvidence[]): BriefEvidence[] {
  const seen = new Set<string>();
  const out: BriefEvidence[] = [];
  for (const ev of evidence) {
    const key = `${ev.doc_id}:${ev.heading ?? ''}:${ev.snippet.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

function evidenceFromSearchHit(hit: SearchResult): BriefEvidence {
  return {
    doc_id: hit.document_id,
    chunk_id: hit.chunk_id,
    title: hit.doc_title,
    path: hit.doc_path,
    status: hit.doc_status,
    heading: hit.heading,
    snippet: hit.snippet.replace(/<\/?mark>/g, ''),
  };
}

function evidenceFromEntityRow(row: EntityEvidenceRow): BriefEvidence {
  const lines = row.body.split('\n').slice(0, 4);
  const compact = lines.join(' ').replace(/\s+/g, ' ').slice(0, 360);
  return {
    doc_id: row.doc_id,
    title: row.doc_title,
    path: row.doc_path,
    status: row.doc_status,
    heading: row.heading,
    snippet: compact,
    match_count: row.match_count,
    file_mtime: row.file_mtime,
  };
}

// Infer which concepts a free-text query is about by scanning the live entity
// table and testing each entity's aliases/name against the query text. No
// project-specific knowledge is baked in — if the DB doesn't know the concept,
// the query doesn't match it.
function inferConceptsFromQuery(query: string, entities: EntityAliasRow[]): EntityAliasRow[] {
  if (!query) return [];
  const hay = ` ${query.toLowerCase()} `;
  const matched: EntityAliasRow[] = [];
  for (const entity of entities) {
    const tokens = [entity.name, ...entity.aliases];
    const hit = tokens.some((t) => {
      if (!t) return false;
      const needle = ` ${t.toLowerCase()} `;
      return hay.includes(needle);
    });
    if (hit) matched.push(entity);
  }
  return matched;
}

// Detect "list all X" / "who are all the X" style queries and the entity type
// they're asking about. Generic — the types come from whatever is in the DB.
function detectListQuery(
  query: string,
  entities: EntityAliasRow[]
): string | null {
  const q = query.toLowerCase();
  const isListish =
    /\b(list|all|every|who are|what are|name the|names? of)\b/.test(q) &&
    !/\bonly\b/.test(q);
  if (!isListish) return null;

  const types = new Set<string>(entities.map((e) => e.type));
  for (const type of types) {
    const singular = type.toLowerCase();
    const plural = singular.endsWith('s') ? singular : `${singular}s`;
    const pattern = new RegExp(`\\b(${singular}|${plural})\\b`);
    if (pattern.test(q)) return type;
  }
  return null;
}

// Rank and threshold the list so deterministic answers surface entities that
// are actually significant in the corpus. Type inference is a heuristic and
// will over-tag; we filter the tail by mention count and document spread to
// keep lists useful without losing correctness.
function renderListFallback(type: string, rows: EntityRow[]): string {
  const sorted = [...rows].sort(
    (a, b) =>
      (b.mention_count ?? 0) - (a.mention_count ?? 0) ||
      (b.document_count ?? 0) - (a.document_count ?? 0)
  );

  // Significance filter: an entity is "real" for list purposes if it has
  // enough presence to merit being listed. These thresholds are conservative
  // and corpus-agnostic.
  const significant = sorted.filter(
    (e) => (e.mention_count ?? 0) >= 50 && (e.document_count ?? 0) >= 4
  );
  const pool = significant.length >= 3 ? significant : sorted.slice(0, 20);

  const heading = `**${pool.length} ${type}${pool.length === 1 ? '' : 's'} in this workspace:**`;
  const lines = pool.map(
    (e) => `- **${e.name}** — \`${e.slug}\` · ${e.mention_count} mentions across ${e.document_count} docs`
  );
  return `${heading}\n\n${lines.join('\n')}`;
}

function gatherEvidence(body: BriefBody): {
  evidence: BriefEvidence[];
  usedSlugs: string[];
  fallbackAnswer: string | null;
} {
  const query = (body.query ?? '').trim();
  const slug = body.entitySlug;
  const usedSlugs: string[] = [];
  let fallbackAnswer: string | null = null;

  const allEntities = getAllEntitiesWithAliases();

  // ── Deterministic "list all X" shortcut ────────────────────────────────────
  if (!slug && query) {
    const typeAsked = detectListQuery(query, allEntities);
    if (typeAsked) {
      const rows = getEntitiesByType(typeAsked);
      if (rows.length >= 2) {
        fallbackAnswer = renderListFallback(typeAsked, rows);
        for (const e of rows.slice(0, 8)) usedSlugs.push(e.slug);
      }
    }
  }

  const evidence: BriefEvidence[] = [];

  // ── Entity-centered retrieval (explicit slug) ──────────────────────────────
  if (slug) {
    const rows = getEntityMentions(slug, 10);
    usedSlugs.push(slug);
    for (const row of rows) evidence.push(evidenceFromEntityRow(row));
  }

  // ── Query-inferred entity retrieval ───────────────────────────────────────
  if (query) {
    const inferred = inferConceptsFromQuery(query, allEntities);
    for (const entity of inferred) {
      if (usedSlugs.includes(entity.slug)) continue;
      usedSlugs.push(entity.slug);
      const rows = getEntityMentions(entity.slug, 4);
      for (const row of rows) evidence.push(evidenceFromEntityRow(row));
    }
  }

  // ── Free-text retrieval across chunks ──────────────────────────────────────
  if (query) {
    const hits = searchRelevantChunks(query, {
      limit: 12,
      documentIds: body.documentIds?.length ? body.documentIds : undefined,
    });
    for (const hit of hits) evidence.push(evidenceFromSearchHit(hit));
  }

  // ── Last-resort fallback for open briefs with selected docs ───────────────
  // Use the DB's top concept names (not hardcoded keywords) to surface
  // something meaningful when the user hasn't asked anything specific.
  if (evidence.length === 0 && !query && !slug && body.documentIds?.length) {
    const topConcepts = getEntities(undefined, 3).map((c) => c.name);
    const fallbackQuery = topConcepts.join(' OR ') || 'summary';
    const hits = searchRelevantChunks(fallbackQuery, {
      limit: 10,
      documentIds: body.documentIds,
    });
    for (const hit of hits) evidence.push(evidenceFromSearchHit(hit));
  }

  return {
    evidence: dedupeEvidence(evidence).slice(0, 16),
    usedSlugs,
    fallbackAnswer,
  };
}

function renderEvidenceAsMarkdown(evidence: BriefEvidence[]): string {
  if (!evidence.length) return '_No evidence found in ingested files for this query._';
  return evidence
    .map((ev, i) => {
      const head = ev.heading ? ` · ${ev.heading}` : '';
      const status = `\`${ev.status}\``;
      return `**[${i + 1}] ${ev.title}**${head}  \n${status} — \`${ev.path}\`\n\n> ${ev.snippet}`;
    })
    .join('\n\n---\n\n');
}

function renderFallbackBrief(
  query: string,
  slug: string | undefined,
  evidence: BriefEvidence[],
  fallbackAnswer: string | null
): string {
  const header = slug
    ? `# Dossier: ${slug}`
    : query
      ? `# Brief for: ${query}`
      : `# Workspace brief`;

  const answerBlock = fallbackAnswer
    ? `## Answer (deterministic)\n\n${fallbackAnswer}\n\n`
    : '';

  const evidenceBlock = `## Evidence from ingested files\n\n${renderEvidenceAsMarkdown(evidence)}\n`;

  const footer =
    '\n\n---\n_Bird Brain returned evidence without calling the configured engine. Open Settings → Engine to verify the provider, model, and API key._';

  return `${header}\n\n${answerBlock}${evidenceBlock}${footer}`;
}

function buildPromptContext(evidence: BriefEvidence[]): string {
  return evidence
    .map((ev, i) => {
      const head = ev.heading ? ` · ${ev.heading}` : '';
      return `[${i + 1}] ${ev.title}${head} (${ev.status}) — ${ev.path}\n${ev.snippet}`;
    })
    .join('\n\n');
}

const SYSTEM_PROMPT = `You are Bird Brain, a project intelligence assistant.
Rules:
- Ground every claim in the numbered evidence snippets provided.
- When you use a snippet, cite it inline like [1], [2], matching the snippet numbers.
- Favor snippets from primary-folder and in-progress documents over older or exploratory material; note when primary-path evidence is missing.
- If the evidence cannot answer the question, say so and point to what IS known.
- Be concise. Structure the answer with short sections or bullet lists.
- Never invent facts that are not in the evidence.`;

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    return briefHandler(req);
  });
}

async function briefHandler(req: NextRequest) {
  const body = (await req.json()) as BriefBody;
  const query = (body.query ?? '').trim();
  const { evidence, usedSlugs, fallbackAnswer } = gatherEvidence(body);

  const wantsModel = body.query || body.entitySlug || (body.documentIds?.length ?? 0) > 0;
  if (!wantsModel || evidence.length === 0) {
    return NextResponse.json({
      brief: renderFallbackBrief(query, body.entitySlug, evidence, fallbackAnswer),
      evidence,
      used_slugs: usedSlugs,
      generated: false,
    });
  }

  const userPrompt = [
    SYSTEM_PROMPT,
    '',
    body.entitySlug ? `Write a concept dossier for: ${body.entitySlug}.` : null,
    query ? `Question: ${query}` : null,
    !body.entitySlug && !query
      ? `Write a short "current state" brief summarizing the selected material.`
      : null,
    '',
    'Evidence snippets (numbered):',
    buildPromptContext(evidence),
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const engine = getEngineForWorkspace();
    const brief = await engine.generate({ prompt: userPrompt });
    return NextResponse.json({
      brief,
      evidence,
      used_slugs: usedSlugs,
      generated: true,
      provider: engine.provider,
      model: engine.defaultModel,
    });
  } catch (err) {
    if (err instanceof EngineError) {
      return NextResponse.json(
        {
          brief: renderFallbackBrief(query, body.entitySlug, evidence, fallbackAnswer),
          evidence,
          used_slugs: usedSlugs,
          generated: false,
          engine_error: { code: err.code, provider: err.provider, message: err.message },
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: `AI request failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async () => {
    return NextResponse.json({ entities: getEntities(undefined, 24) });
  });
}
