import {
  getPrecontextForSlug,
  getEntityBySlug,
  getEntityMentions,
  getNeighborChunksForSynthesis,
  searchChunksFtsForSynthesis,
  getAllEntitiesWithAliases,
  getProjectMeta,
  upsertSynthesis,
  markQueueDone,
  type ConceptPrecontextRow,
  type EntityAliasRow,
  type EntityRow,
  type EntityEvidenceRow,
} from '../db/queries';
import { slugifyPhrase } from '../synthesis/spanify';
import { coerceParagraph, linkKnownEntities } from '../synthesis/spanify';
import type { Paragraph } from '../synthesis/types';
import { getEngineForWorkspace, EngineError } from '../engine';
import { synthesizePrecontextForSlug } from './precontext';

// Live, on-demand concept synthesis. Called by the dossier API when a concept
// has no cached paragraph. The flow is:
//   1. Load the concept + best evidence + the known-concept index from SQLite.
//   2. Build a strict JSON-only prompt for the Cursor Agent CLI.
//   3. Parse and coerce the model's response into a Paragraph of spans.
//   4. Reconcile spans against the live entity table (dead `known` refs →
//      plain text, `candidate` refs → promoted emerged entities).
//   5. Auto-link any bare mentions of other known concepts we missed.
//   6. Cache into concept_synthesis and mark any pending queue entry done.

const LIVE_EVIDENCE_PER_ENTITY = 8;
const QUEUED_EVIDENCE_PER_ENTITY = 12;
const MAX_EVIDENCE_CHARS = 1000;
const MAX_EVIDENCE_CHARS_QUEUED = 1500;
const LIVE_KNOWN_CONCEPTS = 40;
const QUEUED_KNOWN_CONCEPTS = 70;

/** Extra retrieval beyond direct entity_mentions (neighbors / FTS / peer nav). */
const LIVE_NEIGHBOR_CAP = 4;
const QUEUED_NEIGHBOR_CAP = 6;
const LIVE_FTS_CAP = 3;
const QUEUED_FTS_CAP = 5;
const FROM_PEER_CAP = 2;
const NEIGHBOR_RADIAL = 1;
const TOTAL_EVIDENCE_CAP_LIVE = 12;
const TOTAL_EVIDENCE_CAP_QUEUED = 18;
const CURRENT_DOC_STATUSES = new Set(['canon', 'working', 'active']);

type EvidenceSource = 'direct' | 'neighbor' | 'fts_recall' | 'from_peer';

interface PromptEvidenceLine {
  source: EvidenceSource;
  doc_title: string;
  doc_status: string;
  heading: string | null;
  match_count: number;
  body: string;
}

export interface SynthesisResult {
  paragraph: Paragraph;
  precontext: ConceptPrecontextRow;
  generator: string;
  model: string | null;
  profile: string;
  promptChars: number;
}

export async function synthesizeForSlug(
  slug: string,
  options: {
    profile?: 'live' | 'queued';
    fromSlug?: string | null;
    rootSlug?: string | null;
  } = {}
): Promise<SynthesisResult> {
  const entity = getEntityBySlug(slug);
  if (!entity) throw new Error(`Concept "${slug}" not found`);
  const profile = options.profile ?? 'live';
  const evidenceLimit = profile === 'queued' ? QUEUED_EVIDENCE_PER_ENTITY : LIVE_EVIDENCE_PER_ENTITY;
  const knownLimit = profile === 'queued' ? QUEUED_KNOWN_CONCEPTS : LIVE_KNOWN_CONCEPTS;
  const maxChars = profile === 'queued' ? MAX_EVIDENCE_CHARS_QUEUED : MAX_EVIDENCE_CHARS;

  const aliasRows = getAllEntitiesWithAliases();
  const aliasIndex = new Map(aliasRows.map((r) => [r.slug, r]));
  const selfAliases = aliasIndex.get(slug)?.aliases ?? [];
  const directRows = getEntityMentions(slug, evidenceLimit);
  const meta = getProjectMeta();
  const precontext = (getPrecontextForSlug(slug) ?? (await synthesizePrecontextForSlug(slug))) as ConceptPrecontextRow;

  const mergedEvidence = mergeSynthesisEvidence({
    slug,
    profile,
    maxChars,
    directRows,
    selfAliases,
    entityName: entity.name,
    fromSlug: options.fromSlug ?? null,
  });

  const prompt = buildPrompt({
    projectName: meta.project_name,
    profile,
    entity,
    entitySummary: entity.summary?.trim() ?? '',
    aliases: selfAliases,
    fromSlug: options.fromSlug ?? null,
    rootSlug: options.rootSlug ?? null,
    projectGuidance: meta.guidance_notes,
    precontext,
    evidence: mergedEvidence,
    knownConcepts: pickKnownConcepts(aliasRows, slug, knownLimit),
  });

  const engine = getEngineForWorkspace();
  const model = engine.defaultModel;
  const generateStart = Date.now();
  const raw = await engine.generate({ prompt });
  const generateMs = Date.now() - generateStart;
  const paragraph = parseParagraph(raw);
  if (!paragraph) {
    throw new EngineError(
      engine.provider,
      'empty-output',
      `${engine.provider} returned output that could not be parsed as a paragraph`,
      raw.slice(0, 500)
    );
  }

  const reconciled = reconcileSpans(paragraph, slug);
  const linked = linkKnownEntities(
    reconciled,
    aliasRows.map((r) => ({ slug: r.slug, name: r.name, aliases: r.aliases }))
  );

  upsertSynthesis({
    entityId: entity.id,
    profile,
    paragraph: linked,
    generator: engine.provider,
    model: model ?? null,
  });
  markQueueDone(entity.id, profile);

  logSynthesisTelemetry({
    slug,
    profile,
    provider: engine.provider,
    model: model ?? null,
    precontext,
    evidence: mergedEvidence,
    promptChars: prompt.length,
    generateMs,
    paragraph: linked,
  });

  return {
    paragraph: linked,
    precontext,
    generator: engine.provider,
    model: model ?? null,
    profile,
    promptChars: prompt.length,
  };
}

/**
 * Single-line retrieval telemetry per synthesis. Kept small on purpose so it
 * is useful in terminal tails AND parseable by the eval harness in
 * scripts/eval-dossiers.ts (which reads these lines from stderr/stdout).
 */
function logSynthesisTelemetry(args: {
  slug: string;
  profile: 'live' | 'queued';
  provider: string;
  model: string | null;
  precontext: ConceptPrecontextRow;
  evidence: PromptEvidenceLine[];
  promptChars: number;
  generateMs: number;
  paragraph: Paragraph;
}) {
  const bySource = { direct: 0, neighbor: 0, fts_recall: 0, from_peer: 0 } as Record<
    EvidenceSource,
    number
  >;
  for (const line of args.evidence) bySource[line.source] += 1;
  let words = 0;
  let links = 0;
  for (const span of args.paragraph) {
    if ('ref' in span) {
      links += 1;
      words += span.text.trim().split(/\s+/).filter(Boolean).length;
    } else {
      words += span.text.trim().split(/\s+/).filter(Boolean).length;
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `[synthesize] slug=${args.slug} profile=${args.profile} provider=${args.provider}` +
      `${args.model ? ` model=${args.model}` : ''}` +
      ` evidence=direct:${bySource.direct},neighbor:${bySource.neighbor},` +
      `fts:${bySource.fts_recall},peer:${bySource.from_peer}` +
      ` precontext_chars=${args.precontext.precontext_text.length}` +
      ` prompt_chars=${args.promptChars} gen_ms=${args.generateMs}` +
      ` para_words=${words} para_links=${links}`
  );
}

function mergeSynthesisEvidence(args: {
  slug: string;
  profile: 'live' | 'queued';
  maxChars: number;
  directRows: EntityEvidenceRow[];
  selfAliases: string[];
  entityName: string;
  fromSlug: string | null;
}): PromptEvidenceLine[] {
  const { slug, profile, maxChars, directRows, selfAliases, entityName, fromSlug } = args;
  const capTotal = profile === 'queued' ? TOTAL_EVIDENCE_CAP_QUEUED : TOTAL_EVIDENCE_CAP_LIVE;
  const neighborCap = profile === 'queued' ? QUEUED_NEIGHBOR_CAP : LIVE_NEIGHBOR_CAP;
  const ftsCap = profile === 'queued' ? QUEUED_FTS_CAP : LIVE_FTS_CAP;

  const usedChunk = new Set<number>();
  const lines: PromptEvidenceLine[] = [];
  const preferredDirectRows = preferCurrentRows(directRows);

  const pushLine = (
    source: EvidenceSource,
    row: {
      doc_title: string;
      doc_status: string;
      heading: string | null;
      body: string;
      match_count?: number;
    },
    chunkId: number
  ) => {
    if (lines.length >= capTotal) return;
    if (usedChunk.has(chunkId)) return;
    usedChunk.add(chunkId);
    lines.push({
      source,
      doc_title: row.doc_title,
      doc_status: row.doc_status,
      heading: row.heading,
      match_count: row.match_count ?? 0,
      body: row.body.replace(/\s+/g, ' ').slice(0, maxChars),
    });
  };

  for (const r of preferredDirectRows) {
    pushLine('direct', r, r.chunk_id);
  }

  const seedIds = preferredDirectRows.map((r) => r.chunk_id);
  const neighbors = preferCurrentRows(getNeighborChunksForSynthesis(seedIds, usedChunk, NEIGHBOR_RADIAL));
  let nAdded = 0;
  for (const nb of neighbors) {
    if (nAdded >= neighborCap || lines.length >= capTotal) break;
    const before = lines.length;
    pushLine('neighbor', { ...nb, match_count: 0 }, nb.chunk_id);
    if (lines.length > before) nAdded++;
  }

  const ftsQuery =
    [entityName, ...selfAliases.slice(0, 2)]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ')
      .trim() || entityName;

  const docIdsFromDirect = [...new Set(preferredDirectRows.map((r) => r.doc_id))];
  let ftsRows = searchChunksFtsForSynthesis(ftsQuery, {
    limit: ftsCap,
    excludeChunkIds: usedChunk,
    documentIds: docIdsFromDirect.length > 0 ? docIdsFromDirect : undefined,
  });
  ftsRows = preferCurrentRows(ftsRows);

  if (ftsRows.length < ftsCap && docIdsFromDirect.length > 0) {
    const afterFirst = new Set(usedChunk);
    for (const ft of ftsRows) afterFirst.add(ft.chunk_id);
    const more = searchChunksFtsForSynthesis(ftsQuery, {
      limit: ftsCap - ftsRows.length,
      excludeChunkIds: afterFirst,
    });
    const seen = new Set(ftsRows.map((r) => r.chunk_id));
    ftsRows = [...ftsRows, ...preferCurrentRows(more).filter((r) => !seen.has(r.chunk_id))];
  }

  for (const ft of ftsRows) {
    if (lines.length >= capTotal) break;
    pushLine('fts_recall', { ...ft, match_count: 0 }, ft.chunk_id);
  }

  if (fromSlug && fromSlug !== slug) {
    const peerRows = preferCurrentRows(getEntityMentions(fromSlug, FROM_PEER_CAP));
    for (const p of peerRows) {
      if (lines.length >= capTotal) break;
      pushLine('from_peer', p, p.chunk_id);
    }
  }

  return lines;
}

// Pick the known-concept index we expose to the model. Capped to keep the
// prompt tight; prioritize distinct types for variety, then by name length
// (short names are easier anchor targets).
function pickKnownConcepts(rows: EntityAliasRow[], selfSlug: string, limit: number) {
  return rows
    .filter((r) => r.slug !== selfSlug)
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, limit)
    .map((r) => ({ slug: r.slug, name: r.name, type: r.type }));
}

interface PromptInput {
  projectName: string;
  profile: 'live' | 'queued';
  entity: EntityRow;
  entitySummary: string;
  aliases: string[];
  fromSlug: string | null;
  rootSlug: string | null;
  projectGuidance: string;
  precontext: ConceptPrecontextRow;
  evidence: PromptEvidenceLine[];
  knownConcepts: Array<{ slug: string; name: string; type: string }>;
}

function buildPrompt(input: PromptInput): string {
  const {
    projectName,
    profile,
    entity,
    entitySummary,
    aliases,
    fromSlug,
    rootSlug,
    projectGuidance,
    precontext,
    evidence,
    knownConcepts,
  } = input;
  const hasEvidence = evidence.length > 0;
  const aliasLine = aliases.length ? `Aliases: ${aliases.join(', ')}` : 'Aliases: (none)';
  const summaryBlock =
    entitySummary.length > 0
      ? `ONTOLOGY SEED (may be incomplete — if it disagrees with a numbered snippet, ignore the seed for that point):\n${entitySummary}`
      : 'ONTOLOGY SEED: (none)';
  const precontextBlock = `PRECONTEXT (already written for this concept — use as grounding, do not quote):
- Plain definition: ${precontext.plain_definition}
- Role in ${projectName}: ${precontext.project_role}
- Why it matters: ${precontext.study_relevance}
- Anchor relations: ${
    precontext.related_concepts.length > 0 ? precontext.related_concepts.join(', ') : '(none)'
  }
- Briefing paragraph: ${precontext.precontext_text}`;

  // Navigation metadata only — the model must not write about the app, branches,
  // queues, or "how Bird Brain works" unless those words appear in EVIDENCE.
  const contextBlock = [
    `INTERNAL (do not discuss in output): synthesis_profile=${profile}`,
    `INTERNAL: branch_root_slug=${rootSlug ?? 'none'}`,
    `INTERNAL: opened_from_slug=${fromSlug ?? 'direct'}`,
  ].join('\n');

  // BRIDGING BRIEF: when the reader navigated here from another concept, we
  // want the paragraph to land AS a bridge — "in relation to <peer>, this
  // concept…" — without the model narrating the navigation itself. This is
  // the LiS-style "the branch you just took recolors the beat you're in".
  const hasBridge = !!(fromSlug && fromSlug !== entity.slug);
  const bridgeBlock = hasBridge
    ? `BRIDGE (the reader arrived from "${fromSlug}"):
- Treat "${fromSlug}" as a known peer in ${projectName}. If a "from_peer" snippet is present it is secondary — do NOT retell ${fromSlug}.
- Your FIRST sentence should land **this** concept in a way that *implicitly* answers "what does this have to do with ${fromSlug}?".
- Mention ${fromSlug} ONCE, by surface form, and emit a "known" span with ref="${fromSlug}" when you do.
- Do not write "you just clicked", "from the previous concept", or any other navigation meta.`
    : '';

  const provenance = `PROVENANCE TAGS (each line starts with one):
- direct — chunk linked to this concept in the database (strongest).
- neighbor — same file, adjacent section; may explain context. Do not claim the concept is *defined* here unless those words appear in the text.
- fts_recall — lexical search hit; verify the concept is actually discussed, not a false match.
- from_peer — passage from the concept you navigated from; secondary context only.`;

  const evidenceBlock = hasEvidence
    ? evidence
        .map((e, i) => {
          const loc = `${e.doc_title}${e.heading ? ` · ${e.heading}` : ''} (${e.doc_status})`;
          const hits =
            e.source === 'direct' ? `, ${e.match_count} linked hits` : '';
          return `[${i + 1}] ${e.source.toUpperCase()} · ${loc}${hits}\n${e.body}`;
        })
        .join('\n\n')
    : '(There are ZERO ingested snippets for this concept — see TASK: NO SNIPPETS.)';

  const knownBlock = knownConcepts
    .map((k) => `- ${k.slug} · ${k.name} (${k.type})`)
    .join('\n');

  const wordTarget = profile === 'queued' ? '95–165' : '70–125';
  const sentenceTarget = profile === 'queued' ? '3–4' : '2–4';

  const taskWithEvidence = `TASK (${sentenceTarget} sentences, ~${wordTarget} words)
Write one paragraph about ${entity.name} for a reader who is trying to understand it better right now. Do not assume they have read anything else in ${projectName}.

Answer, in this order, in smooth prose — no headings, no labels, no scaffolding:
  1. What ${entity.name} is, in plain language.
  2. What it actually does inside ${projectName}, grounded in the numbered snippets below.
  3. Why it matters — what would be missing from ${projectName} without it.

Use PRECONTEXT for grounding; use the snippets for project-specific detail. Prefer direct snippets, then neighbor, then fts_recall / from_peer only when clearly on-topic. Touch at least one direct snippet. If snippets are thin or repetitive, say less with more precision — one grounded sentence beats three hedged ones.

INTERNAL routing lines may bias which snippet you foreground, but never explain navigation in prose.`;

  const taskNoEvidence = `TASK (exactly two short sentences, ≤45 words total)
Write one paragraph about ${entity.name} for a reader trying to understand it. Use PRECONTEXT only — do not invent file-local details.

Sentence 1: what ${entity.name} is, in plain language.
Sentence 2: what it seems to mean inside ${projectName}.

Do not hedge with "placeholder", "unconfirmed", "treat any", or apology language.`;

  const bannedWhenEvidence = `BANNED WHEN SNIPPETS EXIST (do not use these phrases or close paraphrases unless the exact words appear inside a snippet body):
- Hedges: "placeholder", "only a label", "not anchored", "corpus has not", "no supporting material", "treat … as unconfirmed", "until snippets", "has not yet", "purely speculative".
- Meta-reporting about the corpus: "appears in", "is mentioned in", "the files describe", "according to the document", "this concept shows up", "the project references". Describe the concept directly — not its footprint in the files.`;

  return `You write ONE hypertext paragraph about an ingested **project folder**. Output is a JSON array of clickable spans (OUTPUT SHAPE). Never write about the viewer app, vendors, queues, or "how the tool works" unless those words appear inside a numbered snippet.

PROJECT FOLDER: ${projectName}
CONCEPT: ${entity.name}
CONCEPT TYPE: ${entity.type}
${aliasLine}

${summaryBlock}
${precontextBlock}

${contextBlock}
${bridgeBlock ? `\n${bridgeBlock}\n` : ''}
AUTHOR / OWNER NOTES (optional lens — not about app UI):
${projectGuidance || '(none)'}

${provenance}

EVIDENCE FROM ${projectName} (numbered — ground truth for project-specific claims. The plain orienting line about what ${entity.name} is does NOT need to be traceable to a snippet):
${evidenceBlock}

${bannedWhenEvidence}

KNOWN CONCEPTS (slugs for "known" spans — describe them in-world for ${projectName}, not as software objects):
${knownBlock}

${hasEvidence ? taskWithEvidence : taskNoEvidence}

OUTPUT SHAPE
Return ONLY a JSON array of spans. No prose before or after. No markdown fence. The first character must be "[" and the last "]".

Each span is one of:
  { "text": "<plain text>" }
  { "text": "<surface phrase>", "ref": "<slug-from-known-list>", "kind": "known" }
  { "text": "<surface phrase>", "ref": "<lowercase-hyphen-slug>", "kind": "candidate" }

RULES
- One voice throughout. Plain, specific, smooth. The reader should feel like a thoughtful collaborator is briefing them, not like they are reading a system note or a dictionary.
- The first sentence orients — it should read like a person briefing someone in, not a glossary entry. Skip "X is a…", "refers to…", "can be understood as…" unless ${entity.name} is genuinely obscure.
- Every proper noun, character name, place, artifact, or internal system name must carry enough context in its own sentence for a cold reader to know what it is. Do not reference "the sabotage", "the antagonist", "the incident", or a character name as if the reader already knows.
- Do not use these words unless you rewrite them into ordinary language: lane, tier, status, artifact, framework, integration (as a system noun), mechanic (as a noun), operationalize, locked.
- If PRECONTEXT or snippets use internal or systematic wording, translate it — do not echo it.
- Prefer the project's own verbs and specifics over taxonomy labels.
- Describe ${entity.name}, never its footprint in the files. No "appears in", "is mentioned in", "the document describes".
- Do not mention the app, the tool, branches, queues, or how the paragraph was written.
- When you mention a KNOWN CONCEPT by surface form, emit a "known" span with the exact slug from the list.
- Emit 1–3 "candidate" spans (2–4 words) for strong in-world phrases not in the list; slug = lowercase hyphen words.
- Plain spans carry glue words and spaces. Concatenating every span.text must equal the full paragraph exactly.
- Do not link stopwords, dates, or generic verbs. No empty spans. No duplicate span refs.

Respond now with the JSON array only.`;
}

// Try to extract a Paragraph from the model's raw text output. Handles three
// cases: (a) pure JSON array, (b) JSON wrapped in a ```json fence, (c) JSON
// embedded inside explanatory prose (first "[" to matching "]").
export function parseParagraph(raw: string): Paragraph | null {
  const trimmed = raw.trim();
  const candidates: string[] = [];

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) candidates.push(fenceMatch[1].trim());

  candidates.push(trimmed);

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      const coerced = coerceParagraph(parsed);
      if (coerced && coerced.length > 0) return coerced;
    } catch {
      // try next candidate
    }
  }
  return null;
}

// Reconcile spans against the live entity table:
//   - `known` spans whose slug is missing fall back to plain text.
//   - `known` spans whose slug matches a live entity are kept.
//   - `candidate` spans are NOT promoted here — promotion happens at click
//     time via /api/dossier/queue so the user experiences the emergence.
//     We only normalize the ref to a clean slug for display stability, and
//     we downgrade a candidate to `known` if the LLM happened to describe an
//     already-seeded entity (dedup by slug match).
function reconcileSpans(paragraph: Paragraph, _contextSlug: string): Paragraph {
  return paragraph.map((span) => {
    if (!('ref' in span)) return span;
    if (span.kind === 'known') {
      if (getEntityBySlug(span.ref)) return span;
      return { text: span.text };
    }
    const cleanSlug = slugifyPhrase(span.text) || slugifyPhrase(span.ref);
    if (!cleanSlug) return { text: span.text };
    const existing = getEntityBySlug(cleanSlug);
    if (existing) return { text: span.text, ref: existing.slug, kind: 'known' };
    return { text: span.text, ref: cleanSlug, kind: 'candidate' };
  });
}

function preferCurrentRows<T extends { doc_status: string }>(rows: T[]): T[] {
  const current = rows.filter((row) => CURRENT_DOC_STATUSES.has(row.doc_status));
  return current.length > 0 ? current : rows;
}
