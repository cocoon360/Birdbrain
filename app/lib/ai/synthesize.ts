import {
  getEntityBySlug,
  getEntityMentions,
  getAllEntitiesWithAliases,
  getProjectMeta,
  upsertSynthesis,
  markQueueDone,
  type EntityAliasRow,
  type EntityRow,
} from '../db/queries';
import { slugifyPhrase } from '../synthesis/spanify';
import { coerceParagraph, linkKnownEntities } from '../synthesis/spanify';
import type { Paragraph } from '../synthesis/types';
import { getEngineForWorkspace, EngineError } from '../engine';

// Live, on-demand concept synthesis. Called by the dossier API when a concept
// has no cached paragraph. The flow is:
//   1. Load the concept + best evidence + the known-concept index from SQLite.
//   2. Build a strict JSON-only prompt for the Cursor Agent CLI.
//   3. Parse and coerce the model's response into a Paragraph of spans.
//   4. Reconcile spans against the live entity table (dead `known` refs →
//      plain text, `candidate` refs → promoted emerged entities).
//   5. Auto-link any bare mentions of other known concepts we missed.
//   6. Cache into concept_synthesis and mark any pending queue entry done.

const LIVE_EVIDENCE_PER_ENTITY = 6;
const QUEUED_EVIDENCE_PER_ENTITY = 10;
const MAX_EVIDENCE_CHARS = 900;
const LIVE_KNOWN_CONCEPTS = 80;
const QUEUED_KNOWN_CONCEPTS = 120;

export interface SynthesisResult {
  paragraph: Paragraph;
  generator: string;
  model: string | null;
  profile: string;
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

  const aliasRows = getAllEntitiesWithAliases();
  const aliasIndex = new Map(aliasRows.map((r) => [r.slug, r]));
  const selfAliases = aliasIndex.get(slug)?.aliases ?? [];
  const evidenceRows = getEntityMentions(slug, evidenceLimit);
  const meta = getProjectMeta();

  const prompt = buildPrompt({
    projectName: meta.project_name,
    profile,
    entity,
    aliases: selfAliases,
    fromSlug: options.fromSlug ?? null,
    rootSlug: options.rootSlug ?? null,
    projectGuidance: meta.guidance_notes,
    evidence: evidenceRows.map((r) => ({
      doc_title: r.doc_title,
      doc_status: r.doc_status,
      heading: r.heading,
      body: r.body.replace(/\s+/g, ' ').slice(0, MAX_EVIDENCE_CHARS),
    })),
    knownConcepts: pickKnownConcepts(aliasRows, slug, knownLimit),
  });

  const engine = getEngineForWorkspace();
  const model = engine.defaultModel;
  const raw = await engine.generate({ prompt });
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

  return { paragraph: linked, generator: engine.provider, model: model ?? null, profile };
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
  aliases: string[];
  fromSlug: string | null;
  rootSlug: string | null;
  projectGuidance: string;
  evidence: Array<{
    doc_title: string;
    doc_status: string;
    heading: string | null;
    body: string;
  }>;
  knownConcepts: Array<{ slug: string; name: string; type: string }>;
}

function buildPrompt(input: PromptInput): string {
  const {
    projectName,
    profile,
    entity,
    aliases,
    fromSlug,
    rootSlug,
    projectGuidance,
    evidence,
    knownConcepts,
  } = input;
  const aliasLine = aliases.length ? `Aliases: ${aliases.join(', ')}` : 'Aliases: (none)';
  const contextBlock = [
    `SYNTHESIS PROFILE: ${profile.toUpperCase()}`,
    `CURRENT BRANCH ROOT: ${rootSlug ?? '(none)'}`,
    `ARRIVED FROM: ${fromSlug ?? '(opened directly)'}`,
  ].join('\n');
  const evidenceBlock = evidence.length
    ? evidence
        .map(
          (e, i) =>
            `[${i + 1}] ${e.doc_title}${e.heading ? ` § ${e.heading}` : ''} (${e.doc_status})\n${e.body}`
        )
        .join('\n\n')
    : '(no direct evidence — synthesize from the concept label alone, conservatively)';

  const knownBlock = knownConcepts
    .map((k) => `- ${k.slug} · ${k.name} (${k.type})`)
    .join('\n');

  return `You are generating one hypertext paragraph for a project intelligence console called Bird Brain. The paragraph will be rendered as an array of clickable text spans.

PROJECT: ${projectName}
CONCEPT: ${entity.name}
TYPE: ${entity.type}
${aliasLine}

BRANCH CONTEXT
${contextBlock}

PROJECT GUIDANCE
${projectGuidance || '(none)'}

EVIDENCE FROM THE CORPUS (use this as ground truth; do not invent facts):
${evidenceBlock}

KNOWN CONCEPTS (use these slugs for "known" spans):
${knownBlock}

TASK
Write a ${
    profile === 'queued' ? '3-4 sentence' : '2-3 sentence'
  } paragraph (${profile === 'queued' ? '80-150' : '50-110'} words) that does all three jobs Bird Brain needs:
1. define the concept clearly for a smart newcomer who does not already know this project,
2. explain why the concept matters for active project work right now,
3. preserve enough conceptual shape that Bird Brain still reads like a reusable project-intelligence product rather than a private memo.

If ARRIVED FROM is not "(opened directly)", explicitly explain why this concept emerges from that prior dossier path. If CURRENT BRANCH ROOT exists, keep the writing aware of that broader branch context. Ground every claim in the evidence above. If evidence is thin, be shorter and more tentative rather than speculating.

OUTPUT SHAPE
Return ONLY a JSON array of spans. No prose before or after. No markdown fence. The first character must be "[" and the last "]".

Each span is one of:
  { "text": "<plain text>" }
  { "text": "<surface phrase>", "ref": "<slug-from-known-list>", "kind": "known" }
  { "text": "<surface phrase>", "ref": "<lowercase-hyphen-slug>", "kind": "candidate" }

RULES
- Define before interpreting. The first clause should orient a newcomer before making any abstract claim.
- Avoid insider shorthand, unexplained proper nouns, and assuming the reader already understands this project.
- Prefer plain, vivid language over theoretical jargon unless the evidence itself is philosophical.
- When the paragraph mentions any concept from KNOWN CONCEPTS (by name, plural, or close surface form), emit a "known" span with the exact slug from the list.
- Emit 1-3 "candidate" spans for short noun phrases (2-4 words) that feel like strong concepts worth exploring next but are NOT already in the known list. Slugify the ref: lowercase, words joined by hyphens.
- Use plain spans for everything else. Concatenating every span.text must reproduce the paragraph exactly, including spaces and punctuation. Put connective spaces on the plain-text spans adjacent to linked spans (do not glue a space onto a "known" or "candidate" text).
- Do not link stopwords, dates, or generic verbs.
- No empty text spans. No duplicate span refs.

Respond now with the JSON array only.`;
}

// Try to extract a Paragraph from the model's raw text output. Handles three
// cases: (a) pure JSON array, (b) JSON wrapped in a ```json fence, (c) JSON
// embedded inside explanatory prose (first "[" to matching "]").
function parseParagraph(raw: string): Paragraph | null {
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
