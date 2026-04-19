// Session synthesis — "the archive gossiping about you".
//
// Given a reading session's participation events + the top attended concepts,
// ask the engine to write ONE short hypertext paragraph in a journal voice
// that names what the reader is circling without claiming to know them. The
// output is a Paragraph (spans with `known` refs into the live ontology), so
// every noun in the summary is itself a dialogue-tree branch back into the
// corpus.
//
// This is the "self-interpretation of attention" layer — the Journal
// panel's top card. It turns what the reader has been clicking into a
// short, linked paragraph they can walk back into.

import { parseParagraph } from './synthesize';
import { linkKnownEntities } from '../synthesis/spanify';
import { getAllEntitiesWithAliases, getProjectMeta, getEntityBySlug } from '../db/queries';
import {
  getEventCountForSession,
  getLatestSessionSynthesis,
  getTopAttendedConcepts,
  getTrail,
  insertSessionSynthesis,
  listWatchingCandidates,
  type SessionSynthesisRow,
} from '../db/participation';
import { getEngineForWorkspace, EngineError } from '../engine';
import type { Paragraph } from '../synthesis/types';

const TRAIL_LIMIT = 40;
const MIN_EVENTS_FOR_MEMESIS = 4;
const STALENESS_EVENT_DELTA = 6;

export interface MemesisResult {
  row: SessionSynthesisRow | null;
  reason?: 'insufficient-events' | 'fresh-cache' | 'ok';
}

/**
 * Generate (or return cached) session synthesis for the given session.
 * Cache is considered fresh while fewer than STALENESS_EVENT_DELTA new
 * events have landed since the last generation; callers can override with
 * `force`.
 */
export async function synthesizeSession(
  sessionId: string,
  options: { force?: boolean } = {}
): Promise<MemesisResult> {
  const eventCount = getEventCountForSession(sessionId);
  if (eventCount < MIN_EVENTS_FOR_MEMESIS) {
    return { row: null, reason: 'insufficient-events' };
  }

  const latest = getLatestSessionSynthesis(sessionId);
  if (
    !options.force &&
    latest &&
    eventCount - latest.event_count < STALENESS_EVENT_DELTA
  ) {
    return { row: latest, reason: 'fresh-cache' };
  }

  const trail = getTrail({ sessionId, limit: TRAIL_LIMIT });
  const top = getTopAttendedConcepts(sessionId, 8);
  const candidates = listWatchingCandidates(6);
  const meta = getProjectMeta();

  const prompt = buildMemesisPrompt({
    projectName: meta.project_name,
    trail: trail.map((t) => ({
      kind: t.kind,
      slug: t.slug,
      name: t.concept_name ?? t.slug ?? '',
      phrase: t.phrase,
      from: t.from_slug,
    })),
    top: top.map((t) => ({ slug: t.slug, name: t.name, type: t.type, clicks: t.clicks })),
    candidates: candidates.map((c) => ({
      slug: c.slug,
      phrase: c.phrase,
      clicks: c.clicks,
      impressions: c.impressions,
    })),
  });

  const engine = getEngineForWorkspace();
  const raw = await engine.generate({ prompt });
  const paragraph = parseParagraph(raw);
  if (!paragraph) {
    throw new EngineError(
      engine.provider,
      'empty-output',
      `${engine.provider} returned memesis output that could not be parsed`,
      raw.slice(0, 500)
    );
  }

  // Reconcile `known` refs against the live entity table — memesis should
  // never link to ghost slugs. Candidate spans are passed through so the
  // Journal card can still surface emergent phrases as clickable.
  const reconciled: Paragraph = paragraph.map((span) => {
    if (!('ref' in span)) return span;
    if (span.kind === 'known') {
      return getEntityBySlug(span.ref) ? span : { text: span.text };
    }
    return span;
  });

  // Auto-link any bare surface forms the model missed, same as dossiers.
  const aliasRows = getAllEntitiesWithAliases();
  const linked = linkKnownEntities(
    reconciled,
    aliasRows.map((r) => ({ slug: r.slug, name: r.name, aliases: r.aliases }))
  );

  const row = insertSessionSynthesis({
    sessionId,
    paragraph: linked,
    generator: engine.provider,
    model: engine.defaultModel ?? null,
    eventCount,
  });
  return { row, reason: 'ok' };
}

interface MemesisPromptInput {
  projectName: string;
  trail: Array<{
    kind: string;
    slug: string | null;
    name: string;
    phrase: string | null;
    from: string | null;
  }>;
  top: Array<{ slug: string; name: string; type: string; clicks: number }>;
  candidates: Array<{ slug: string; phrase: string; clicks: number; impressions: number }>;
}

function buildMemesisPrompt(input: MemesisPromptInput): string {
  const trailLines = input.trail
    .slice(0, 24)
    .map((t) => {
      if (t.kind === 'open_concept' && t.slug) {
        return `- open_concept ${t.slug}${t.from ? ` ← from ${t.from}` : ''}`;
      }
      if (t.kind === 'open_doc') return `- open_doc`;
      if (t.kind === 'impression' && t.phrase) return `- impression "${t.phrase}"`;
      if (t.kind === 'promote' && t.phrase) return `- promote "${t.phrase}" (emerged)`;
      if (t.kind === 'ask' && t.phrase) return `- ask "${t.phrase}"`;
      if (t.kind === 'search' && t.phrase) return `- search "${t.phrase}"`;
      return `- ${t.kind}`;
    })
    .join('\n');

  const topBlock = input.top
    .map((c) => `- ${c.slug} · ${c.name} (${c.type}) — ${c.clicks} opens`)
    .join('\n');

  const candidatesBlock = input.candidates.length
    ? input.candidates
        .map((c) => `- ${c.slug} · "${c.phrase}" — ${c.clicks} clicks / ${c.impressions} shown`)
        .join('\n')
    : '(none)';

  const knownSlugs = input.top.map((c) => c.slug).join(', ') || '(none)';

  return `You write ONE short journal-voiced paragraph that summarizes what a reader has been attending to in **${input.projectName}** during this reading session. Output is a JSON array of hypertext spans (see OUTPUT SHAPE). You are the archive speaking about the reader — quiet, observant, a little dry.

TONE
- Journal, not dashboard. "You keep circling…", "Today it was…", "The folder noticed you return to…".
- Do not list. Do not announce counts. Do not mention "session", "events", "tool", "click".
- Max 2 sentences, 40–80 words.

RECENT TRAIL (newest last):
${trailLines || '(empty)'}

MOST-ATTENDED CONCEPTS (use slugs for "known" spans):
${topBlock || '(none)'}

WATCHING (candidate phrases the reader has surfaced but not yet promoted):
${candidatesBlock}

KNOWN SLUGS available for "known" spans: ${knownSlugs}

OUTPUT SHAPE
Return ONLY a JSON array of spans. First character "[", last "]". No markdown fence.

Each span is one of:
  { "text": "<plain text>" }
  { "text": "<surface phrase>", "ref": "<slug-from-known-slugs>", "kind": "known" }
  { "text": "<surface phrase>", "ref": "<lowercase-hyphen-slug>", "kind": "candidate" }

RULES
- Mention 1–3 concepts by surface form and link them as "known" using slugs from the KNOWN SLUGS list.
- You MAY surface 1 candidate phrase from WATCHING as a "candidate" span if the reader seems to be circling it.
- Plain spans carry glue. Concatenating every span.text must equal the full paragraph exactly.
- No empty spans. No duplicate span refs. No quote marks around concept names in plain text.

Respond now with the JSON array only.`;
}
