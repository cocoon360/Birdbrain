'use server';

import {
  getEntityBySlug,
  getEntityMentions,
  getLatestOntologyRun,
  getPrecontextForSlug,
  getProjectMeta,
  getRelatedEntities,
  upsertPrecontext,
} from '../db/queries';
import { getEngineForWorkspace, EngineError } from '../engine';

interface OverviewSnapshot {
  project_summary: string;
  builder_purpose: string;
  newcomer_purpose: string;
  product_purpose: string;
  ontology_rules: string[];
}

export interface PrecontextResult {
  entity_id: number;
  corpus_signature: string;
  plain_definition: string;
  project_role: string;
  study_relevance: string;
  related_concepts: string[];
  precontext_text: string;
  generator: string;
  model: string | null;
  generated_at: number;
}

export async function synthesizePrecontextForSlug(slug: string): Promise<PrecontextResult> {
  const cached = getPrecontextForSlug(slug);
  if (cached) return cached;

  const entity = getEntityBySlug(slug);
  if (!entity) throw new Error(`Concept "${slug}" not found`);

  const meta = getProjectMeta();
  const corpusSignature = meta.corpus_signature;
  if (!corpusSignature) throw new Error('Corpus signature missing; ingest before generating precontext.');

  const overview = getOverviewSnapshot();
  const evidence = getEntityMentions(slug, 5);
  const related = getRelatedEntities(slug, 6);
  if (meta.engine_provider === 'local') {
    return synthesizeLocalPrecontext({
      slug,
      entity,
      meta,
      corpusSignature,
      evidence,
      related,
      overview,
    });
  }
  const prompt = buildPrecontextPrompt({
    projectName: meta.project_name,
    guidanceNotes: meta.guidance_notes,
    entity,
    overview,
    evidence,
    related,
  });

  const engine = getEngineForWorkspace();
  const model = engine.defaultModel;
  const raw = await engine.generate({ prompt });
  const parsed = parseJsonObject(raw) as Partial<{
    plain_definition: string;
    project_role: string;
    study_relevance: string;
    related_concepts: string[];
    precontext_text: string;
  }> | null;

  if (!parsed) {
    throw new EngineError(
      engine.provider,
      'empty-output',
      `${engine.provider} returned output that could not be parsed as concept precontext JSON`,
      raw.slice(0, 500)
    );
  }

  const allowedRelated = new Set(related.map((row) => row.slug));
  const plainDefinition = cleanSentence(parsed.plain_definition) || cleanSentence(entity.summary) || entity.name;
  const projectRole =
    cleanSentence(parsed.project_role) ||
    cleanSentence(entity.summary) ||
    `${entity.name} is a recurring ${entity.type} in ${meta.project_name}.`;
  const studyRelevance =
    cleanSentence(parsed.study_relevance) ||
    cleanSentence(overview.project_summary) ||
    `${entity.name} helps explain what ${meta.project_name} is trying to understand or build.`;
  const relatedConcepts = Array.from(
    new Set(
      (Array.isArray(parsed.related_concepts) ? parsed.related_concepts : []).filter(
        (value): value is string => typeof value === 'string' && allowedRelated.has(value)
      )
    )
  ).slice(0, 4);
  const precontextText =
    cleanParagraph(parsed.precontext_text) ||
    [plainDefinition, projectRole, studyRelevance].filter(Boolean).join(' ');

  upsertPrecontext({
    entityId: entity.id,
    corpusSignature,
    plainDefinition,
    projectRole,
    studyRelevance,
    relatedConcepts,
    precontextText,
    generator: engine.provider,
    model: model ?? null,
  });

  return (
    getPrecontextForSlug(slug) ?? {
      entity_id: entity.id,
      corpus_signature: corpusSignature,
      plain_definition: plainDefinition,
      project_role: projectRole,
      study_relevance: studyRelevance,
      related_concepts: relatedConcepts,
      precontext_text: precontextText,
      generator: engine.provider,
      model: model ?? null,
      generated_at: Math.floor(Date.now() / 1000),
    }
  );
}

function synthesizeLocalPrecontext(input: {
  slug: string;
  entity: NonNullable<ReturnType<typeof getEntityBySlug>>;
  meta: ReturnType<typeof getProjectMeta>;
  corpusSignature: string;
  evidence: ReturnType<typeof getEntityMentions>;
  related: ReturnType<typeof getRelatedEntities>;
  overview: OverviewSnapshot;
}): PrecontextResult {
  const { slug, entity, meta, corpusSignature, evidence, related, overview } = input;
  const firstSnippet = evidence[0]?.body.replace(/\s+/g, ' ').trim();
  const plainDefinition =
    cleanSentence(entity.summary) ||
    (firstSnippet ? cleanSentence(firstSnippet) : '') ||
    `${entity.name} is a recurring ${entity.type} in ${meta.project_name}.`;
  const projectRole =
    evidence.length > 0
      ? `${entity.name} is grounded in ${evidence.length} source passage${evidence.length === 1 ? '' : 's'} from the ingested folder.`
      : `${entity.name} appears in the local concept map for ${meta.project_name}.`;
  const studyRelevance =
    related.length > 0
      ? `${entity.name} connects to ${related.slice(0, 3).map((row) => row.name).join(', ')}.`
      : overview.project_summary || `${entity.name} helps orient the project archive.`;
  const relatedConcepts = related.slice(0, 4).map((row) => row.slug);
  const precontextText = [plainDefinition, projectRole, studyRelevance].filter(Boolean).join(' ');

  upsertPrecontext({
    entityId: entity.id,
    corpusSignature,
    plainDefinition,
    projectRole,
    studyRelevance,
    relatedConcepts,
    precontextText,
    generator: 'local',
    model: 'no-ai',
  });

  return (
    getPrecontextForSlug(slug) ?? {
      entity_id: entity.id,
      corpus_signature: corpusSignature,
      plain_definition: plainDefinition,
      project_role: projectRole,
      study_relevance: studyRelevance,
      related_concepts: relatedConcepts,
      precontext_text: precontextText,
      generator: 'local',
      model: 'no-ai',
      generated_at: Math.floor(Date.now() / 1000),
    }
  );
}

function buildPrecontextPrompt(input: {
  projectName: string;
  guidanceNotes: string;
  entity: NonNullable<ReturnType<typeof getEntityBySlug>>;
  overview: OverviewSnapshot;
  evidence: ReturnType<typeof getEntityMentions>;
  related: ReturnType<typeof getRelatedEntities>;
}) {
  const { projectName, guidanceNotes, entity, overview, evidence, related } = input;
  const evidenceBlock =
    evidence.length > 0
      ? evidence
          .map((row, index) => {
            const loc = `${row.doc_title}${row.heading ? ` · ${row.heading}` : ''} (${row.doc_status})`;
            return `[${index + 1}] ${loc}\n${row.body.replace(/\s+/g, ' ').slice(0, 600)}`;
          })
          .join('\n\n')
      : '(No direct snippets were retrieved for this concept.)';
  const authorityBlock = `SOURCE AUTHORITY
- Treat canon, working, and active evidence as the current project truth.
- Treat reference as background context.
- Treat brainstorm and archive evidence as exploratory or older unless current evidence confirms it.
- If older/exploratory/background evidence disagrees with current evidence, follow the current evidence and do not repeat the older claim as true.
- Be especially careful with capability/structure claims such as who is playable, who is a POV character, what has been scrapped, what is locked, or what is no longer true. Only state those claims when current evidence supports them.
- If evidence says something was scrapped, removed, no longer true, replaced, or old, preserve that negation. Do not revive the older version.`;
  const relatedBlock =
    related.length > 0
      ? related
          .map((row) => `- ${row.slug} | ${row.name} | ${row.type} | ${row.summary}`)
          .join('\n')
      : '(none)';

  return `You are writing a short, reusable briefing for one concept in a real project.

Write for a single reader: someone trying to understand ${entity.name} better right now. Do not assume they have read anything else in ${projectName}. Do not split your voice between a "new reader" and an "insider reader" — there is only one reader.

PROJECT: ${projectName}
CONCEPT: ${entity.name}
TYPE: ${entity.type}
ONTOLOGY SEED:
${entity.summary || '(none)'}

PROJECT OVERVIEW:
- Project summary: ${overview.project_summary || '(none)'}
- Builder purpose: ${overview.builder_purpose || '(none)'}
- Newcomer purpose: ${overview.newcomer_purpose || '(none)'}
- Product purpose: ${overview.product_purpose || '(none)'}
- Ontology rules:
${overview.ontology_rules.map((rule) => `  - ${rule}`).join('\n') || '  - (none)'}

GUIDANCE NOTES:
${guidanceNotes.trim() || '(none)'}

RELATED CONCEPTS (you may only choose slugs from this list in related_concepts):
${relatedBlock}

PROJECT EVIDENCE:
${evidenceBlock}

${authorityBlock}

Return ONLY valid JSON with this shape:
{
  "plain_definition": "string",
  "project_role": "string",
  "study_relevance": "string",
  "related_concepts": ["slug"],
  "precontext_text": "string"
}

What each field is:
- "plain_definition": one sentence naming what ${entity.name} is, in ordinary language. Not a glossary line. If the term is universally familiar (fire, friend, room), keep it very light and pivot fast to what makes it specific here.
- "project_role": one sentence on what ${projectName} actually does with it, grounded in the evidence.
- "study_relevance": one sentence on why this concept matters to the larger inquiry — what would be missing without it.
- "precontext_text": 2–4 sentences that read as a single paragraph, answering in order: what it is, what it does here, why it matters.
- "related_concepts": 0–4 slugs, chosen only from the list above.

Writing rules (apply to every field):
- One voice throughout. Plain, specific, smooth. The reader should feel like a thoughtful collaborator is briefing them, not like they are reading a status doc or a dictionary.
- Skip textbook phrasing ("X is a…", "refers to…", "can be understood as…") unless the concept is genuinely obscure.
- First mention of any proper noun, character name, place, artifact, or internal system name must carry enough context in the same sentence for a cold reader to know what it is. Do not reference "the sabotage", "the antagonist", "the incident", or a character by name as if the reader already knows.
- Do not use these words unless you rewrite them into ordinary language: lane, tier, status, artifact, framework, integration (as a system noun), mechanic (as a noun), operationalize, locked.
- Describe the thing, never its footprint in the files. No "appears in", "is mentioned in", "the document describes".
- When evidence conflicts, write the current version plainly; do not summarize both versions unless the conflict itself is important to understanding ${entity.name}.
- Do not talk about the app, the tool, snippets, or how the briefing was made.
- No markdown fence. Raw JSON only.`;
}

function getOverviewSnapshot(): OverviewSnapshot {
  const latest = getLatestOntologyRun();
  const parsed = latest?.overview_json ? (parseJsonObject(latest.overview_json) as Partial<OverviewSnapshot> | null) : null;
  return {
    project_summary: typeof parsed?.project_summary === 'string' ? parsed.project_summary : latest?.summary_text ?? '',
    builder_purpose: typeof parsed?.builder_purpose === 'string' ? parsed.builder_purpose : '',
    newcomer_purpose: typeof parsed?.newcomer_purpose === 'string' ? parsed.newcomer_purpose : '',
    product_purpose: typeof parsed?.product_purpose === 'string' ? parsed.product_purpose : '',
    ontology_rules: Array.isArray(parsed?.ontology_rules)
      ? parsed.ontology_rules.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) candidates.push(fenceMatch[1].trim());
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // keep trying
    }
  }
  return null;
}

function cleanSentence(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function cleanParagraph(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}
