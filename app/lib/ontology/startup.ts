import { getDb } from '../db/database';
import {
  clearGeneratedArtifacts,
  clearStaleGeneratedArtifacts,
  completeOntologyRun,
  enqueueSynthesis,
  failOntologyRun,
  getEntities,
  getEntityBySlug,
  getProjectMeta,
  getStartupStatus,
  replaceOntologyArtifacts,
  setProjectMetaValue,
  startOntologyRun,
  type OntologyConceptRow,
  type StarterLensRow,
} from '../db/queries';
import { getEngineForWorkspace } from '../engine';
import { slugifyPhrase } from '../synthesis/spanify';

type StartupMode = 'automatic-cached' | 'always-fresh' | 'manual';

interface OverviewPass {
  project_summary: string;
  builder_purpose: string;
  newcomer_purpose: string;
  product_purpose: string;
  ontology_rules: string[];
  ignore_terms: string[];
  preferred_types: string[];
}

interface ConceptDraft {
  slug?: string;
  name: string;
  type: string;
  aliases?: string[];
  summary: string;
  rationale?: string;
}

interface LensDraft {
  title: string;
  concept_slug: string;
  description: string;
  order_index?: number;
}

export async function rebuildOntology(
  startupMode: StartupMode,
  options: { clearGenerated?: boolean } = {}
) {
  const meta = getProjectMeta();
  const corpusSignature = meta.corpus_signature;
  if (!corpusSignature) {
    throw new Error('Corpus not ingested yet. Run ingest before rebuilding ontology.');
  }

  const runId = startOntologyRun({
    corpusSignature,
    startupMode,
  });

  try {
    if (options.clearGenerated) {
      clearGeneratedArtifacts(corpusSignature);
    } else {
      clearStaleGeneratedArtifacts({
        currentCorpusSignature: corpusSignature,
        ontologyCorpusSignature: getStartupStatus().ontology_corpus_signature,
      });
    }
    if (meta.engine_provider === 'local') {
      const local = buildLocalOntology(meta);
      replaceOntologyArtifacts({
        runId,
        concepts: local.concepts,
        lenses: local.lenses,
      });
      syncRuntimeOntologyConcepts(local.concepts);
      completeOntologyRun({
        runId,
        summaryText: local.overview.project_summary,
        overviewJson: JSON.stringify(local.overview),
      });
      setProjectMetaValue('ontology_last_success_signature', corpusSignature);
      return { runId, overview: local.overview, concepts: local.concepts, lenses: local.lenses };
    }

    const packet = buildCorpusPacket();
    const shape = describeCorpusShape(packet, meta);
    const overview = await runOverviewPass(packet, meta, shape);
    const concepts = await runConceptPass(packet, meta, overview, shape);
    const lenses = await runLensPass(packet, meta, overview, concepts);

    replaceOntologyArtifacts({
      runId,
      concepts,
      lenses,
    });
    syncRuntimeOntologyConcepts(concepts);
    completeOntologyRun({
      runId,
      summaryText: overview.project_summary,
      overviewJson: JSON.stringify(overview),
    });
    queueStarterLensWarmup(lenses);
    setProjectMetaValue('ontology_last_success_signature', corpusSignature);
    return { runId, overview, concepts, lenses };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ontology rebuild error';
    failOntologyRun(runId, message);
    throw error;
  }
}

export async function ensureOntologyReady(startupMode: StartupMode) {
  const status = getStartupStatus();
  clearStaleGeneratedArtifacts({
    currentCorpusSignature: status.current_corpus_signature,
    ontologyCorpusSignature: status.ontology_corpus_signature,
  });
  if (startupMode === 'manual') return status;
  if (startupMode === 'always-fresh' || status.missing || status.stale || status.failed) {
    await rebuildOntology(startupMode);
  }
  return getStartupStatus();
}

function buildLocalOntology(meta: ReturnType<typeof getProjectMeta>): {
  overview: OverviewPass;
  concepts: OntologyConceptRow[];
  lenses: StarterLensRow[];
} {
  const entities = getEntities(undefined, 40);
  const localEntities = entities.length > 0 ? entities : deriveLocalConceptsFromCorpus();
  const concepts = entities.map((entity) => ({
    slug: entity.slug,
    name: entity.name,
    type: normalizeConceptType(entity.type),
    aliases: [entity.name],
    summary:
      entity.summary?.trim() ||
      `${entity.name} is a recurring ${entity.type || 'concept'} in ${meta.project_name}.`,
    rationale: `Demo mode promoted this from the ingested files without calling an AI model.`,
  }));
  if (concepts.length === 0) {
    concepts.push(...localEntities.map((entity) => ({
      slug: entity.slug,
      name: entity.name,
      type: normalizeConceptType(entity.type),
      aliases: [entity.name],
      summary: entity.summary,
      rationale: 'Demo mode derived this topic from filenames, headings, and repeated phrases.',
    })));
  }
  const lenses = concepts.slice(0, 9).map((concept, index) => ({
    concept_slug: concept.slug,
    title: concept.name,
    description: concept.summary,
    order_index: index,
  }));
  const overview: OverviewPass = {
    project_summary:
      concepts.length > 0
        ? `${meta.project_name} has ${concepts.length} locally derived concept${concepts.length === 1 ? '' : 's'} from the ingested folder.`
        : `${meta.project_name} has been ingested, but no strong concepts were derived yet.`,
    builder_purpose: 'Explore the local file index, source evidence, and derived concepts without an AI provider.',
    newcomer_purpose: 'Give a first-pass map of the project from filenames, headings, and repeated terms.',
    product_purpose: 'Demonstrate Bird Brain as a local project-reading console even before AI is configured.',
    ontology_rules: [
      'Demo mode uses deterministic concept derivation from the ingested corpus.',
      'AI-generated interpretation can be enabled later from Engine settings.',
    ],
    ignore_terms: [],
    preferred_types: Array.from(new Set(concepts.map((concept) => concept.type))).slice(0, 8),
  };
  return { overview, concepts, lenses };
}

function deriveLocalConceptsFromCorpus(): Array<{ slug: string; name: string; type: string; summary: string }> {
  const db = getDb();
  const candidates = new Map<string, { name: string; type: string; score: number; examples: Set<string> }>();
  const add = (rawName: string, type: string, score: number, example: string) => {
    const name = cleanLocalConceptName(rawName);
    if (!name) return;
    const slug = slugifyPhrase(name);
    if (!slug) return;
    const existing = candidates.get(slug);
    if (existing) {
      existing.score += score;
      existing.examples.add(example);
      if (existing.type === 'concept') existing.type = type;
    } else {
      candidates.set(slug, {
        name,
        type,
        score,
        examples: new Set([example]),
      });
    }
  };

  const docs = db
    .prepare(
      `SELECT title, category, status, word_count
       FROM documents
       ORDER BY
         CASE status
           WHEN 'canon' THEN 0
           WHEN 'working' THEN 1
           WHEN 'active' THEN 2
           WHEN 'reference' THEN 3
           WHEN 'brainstorm' THEN 4
           WHEN 'archive' THEN 5
           ELSE 6
         END,
         file_mtime DESC
       LIMIT 80`
    )
    .all() as Array<{ title: string; category: string; status: string; word_count: number }>;
  for (const doc of docs) {
    add(doc.title, inferLocalType(`${doc.category} ${doc.title}`), 8 + Math.min(8, doc.word_count / 300), doc.title);
  }

  const chunks = db
    .prepare(
      `SELECT c.heading, substr(c.body, 1, 1200) AS body, d.title AS doc_title, d.category
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       ORDER BY d.file_mtime DESC, c.word_count DESC
       LIMIT 160`
    )
    .all() as Array<{ heading: string | null; body: string; doc_title: string; category: string }>;
  for (const chunk of chunks) {
    if (chunk.heading) add(chunk.heading, inferLocalType(`${chunk.category} ${chunk.heading}`), 10, chunk.doc_title);
    for (const phrase of extractCapitalizedPhrases(chunk.body).slice(0, 6)) {
      add(phrase, inferLocalType(`${chunk.category} ${phrase}`), 3, chunk.doc_title);
    }
  }

  return Array.from(candidates.entries())
    .sort((a, b) => b[1].score - a[1].score || a[1].name.localeCompare(b[1].name))
    .slice(0, 36)
    .map(([slug, candidate]) => {
      const examples = Array.from(candidate.examples).slice(0, 2);
      return {
        slug,
        name: candidate.name,
        type: candidate.type,
        summary: `${candidate.name} is a locally derived topic from ${examples.join(', ')}.`,
      };
    });
}

function cleanLocalConceptName(value: string): string | null {
  const cleaned = value
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 3 || cleaned.length > 72) return null;
  if (/^\d+$/.test(cleaned)) return null;
  if (/^(readme|index|overview|notes?|draft|final|untitled)$/i.test(cleaned)) return null;
  return cleaned
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractCapitalizedPhrases(body: string): string[] {
  const matches = body.match(/\b[A-Z][a-zA-Z0-9’']+(?:\s+[A-Z][a-zA-Z0-9’']+){0,3}\b/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of matches) {
    const cleaned = cleanLocalConceptName(match);
    if (!cleaned || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    out.push(cleaned);
  }
  return out;
}

function inferLocalType(label: string): string {
  const lower = label.toLowerCase();
  if (/character|cast|protagonist|person|people/.test(lower)) return 'character';
  if (/place|location|setting|world|town|city|campus|map/.test(lower)) return 'place';
  if (/event|incident|scene|moment|timeline/.test(lower)) return 'event';
  if (/system|mechanic|loop|workflow|architecture|api|engine/.test(lower)) return 'system';
  if (/theme|motif|question|idea/.test(lower)) return 'theme';
  if (/team|group|org|faction|company/.test(lower)) return 'organization';
  return 'concept';
}

function buildCorpusPacket() {
  const db = getDb();
  // Status buckets (canon / working / active / reference / brainstorm / archive)
  // come out of parsed file metadata and are generic across projects.
  // Within each bucket we just order by recency + size; no project-specific
  // category bias.
  const docs = db
    .prepare(
      `WITH ranked_docs AS (
         SELECT
           title,
           path,
           status,
           category,
           word_count,
           file_mtime,
           ROW_NUMBER() OVER (
             PARTITION BY status
             ORDER BY file_mtime DESC, word_count DESC
           ) AS status_rank
         FROM documents
       )
       SELECT title, path, status, category, word_count, file_mtime
       FROM ranked_docs
       WHERE
         (status = 'canon' AND status_rank <= 16) OR
         (status = 'working' AND status_rank <= 12) OR
         (status = 'active' AND status_rank <= 10) OR
         (status = 'reference' AND status_rank <= 6) OR
         (status = 'brainstorm' AND status_rank <= 4) OR
         (status = 'archive' AND status_rank <= 2) OR
         (status NOT IN ('canon','working','active','reference','brainstorm','archive')
           AND status_rank <= 14)
       ORDER BY
         CASE status
           WHEN 'canon' THEN 0
           WHEN 'working' THEN 1
           WHEN 'active' THEN 2
           WHEN 'reference' THEN 3
           WHEN 'brainstorm' THEN 4
           WHEN 'archive' THEN 5
           ELSE 6
         END ASC,
         file_mtime DESC
       LIMIT 56`
    )
    .all() as Array<{
      title: string;
      path: string;
      status: string;
      category: string;
      word_count: number;
      file_mtime: number;
    }>;
  const chunks = db
    .prepare(
      `WITH ranked_chunks AS (
         SELECT
           d.title as doc_title,
           d.status as doc_status,
           d.category as doc_category,
           d.file_mtime,
           c.heading,
           substr(c.body, 1, 900) as body,
           ROW_NUMBER() OVER (
             PARTITION BY d.status
             ORDER BY d.file_mtime DESC, c.word_count DESC
           ) AS status_rank
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
       )
       SELECT doc_title, doc_status, doc_category, heading, body
       FROM ranked_chunks
       WHERE
         (doc_status = 'canon' AND status_rank <= 14) OR
         (doc_status = 'working' AND status_rank <= 10) OR
         (doc_status = 'active' AND status_rank <= 8) OR
         (doc_status = 'reference' AND status_rank <= 4) OR
         (doc_status = 'brainstorm' AND status_rank <= 3) OR
         (doc_status = 'archive' AND status_rank <= 2) OR
         (doc_status NOT IN ('canon','working','active','reference','brainstorm','archive')
           AND status_rank <= 12)
       ORDER BY
         CASE doc_status
           WHEN 'canon' THEN 0
           WHEN 'working' THEN 1
           WHEN 'active' THEN 2
           WHEN 'reference' THEN 3
           WHEN 'brainstorm' THEN 4
           WHEN 'archive' THEN 5
           ELSE 6
         END ASC,
         file_mtime DESC
       LIMIT 40`
    )
    .all() as Array<{
      doc_title: string;
      doc_status: string;
      doc_category: string;
      heading: string | null;
      body: string;
    }>;
  return { docs, chunks };
}

interface CorpusShape {
  doc_count: number;
  avg_words: number;
  median_words: number;
  size_class: 'tiny' | 'small' | 'medium' | 'large';
  shape_class: 'notes' | 'essays' | 'mixed' | 'structured';
  has_guidance: boolean;
}

function describeCorpusShape(
  packet: ReturnType<typeof buildCorpusPacket>,
  meta: ReturnType<typeof getProjectMeta>
): CorpusShape {
  const db = getDb();
  const stat = db
    .prepare(
      `SELECT
         COUNT(*) as doc_count,
         COALESCE(AVG(word_count), 0) as avg_words
       FROM documents`
    )
    .get() as { doc_count: number; avg_words: number };
  const medianRow = db
    .prepare(
      `SELECT word_count
       FROM documents
       ORDER BY word_count
       LIMIT 1 OFFSET (SELECT COUNT(*) FROM documents) / 2`
    )
    .get() as { word_count: number } | undefined;
  const doc_count = stat?.doc_count ?? packet.docs.length;
  const avg_words = Math.round(stat?.avg_words ?? 0);
  const median_words = medianRow?.word_count ?? avg_words;

  const size_class: CorpusShape['size_class'] =
    doc_count < 10 ? 'tiny' : doc_count < 40 ? 'small' : doc_count < 120 ? 'medium' : 'large';

  const shape_class: CorpusShape['shape_class'] =
    median_words < 150
      ? 'notes'
      : median_words < 500
        ? 'mixed'
        : median_words < 1500
          ? 'essays'
          : 'structured';

  return {
    doc_count,
    avg_words,
    median_words,
    size_class,
    shape_class,
    has_guidance: Boolean(meta.guidance_notes?.trim().length),
  };
}

function describeShapeForPrompt(shape: CorpusShape): string {
  const size =
    shape.size_class === 'tiny'
      ? `tiny corpus (${shape.doc_count} docs)`
      : shape.size_class === 'small'
        ? `small corpus (${shape.doc_count} docs)`
        : shape.size_class === 'medium'
          ? `medium corpus (${shape.doc_count} docs)`
          : `large corpus (${shape.doc_count} docs)`;
  const shapeLabel =
    shape.shape_class === 'notes'
      ? 'short journal-style notes'
      : shape.shape_class === 'mixed'
        ? 'mix of short notes and longer writeups'
        : shape.shape_class === 'essays'
          ? 'essay-length writeups'
          : 'long structured documents';
  return `${size}, ${shapeLabel} (median ${shape.median_words} words/doc)`;
}

async function runOverviewPass(
  packet: ReturnType<typeof buildCorpusPacket>,
  meta: ReturnType<typeof getProjectMeta>,
  shape: CorpusShape
) {
  const prompt = `You are building the startup ontology overview for Bird Brain, a local-first project intelligence console. Bird Brain runs over an arbitrary folder of readable files — markdown, text, HTML, SVG, structured data, and source code. It could be a game design archive, a research notebook, a daily journal, a company wiki, a codebase, or anything else. Infer the project's nature from the actual corpus; do not assume a default genre.

Project name: ${meta.project_name}
Corpus shape: ${describeShapeForPrompt(shape)}
Guidance notes (from the user — treat as authoritative about what this project is):
${meta.guidance_notes?.trim() || '(none — infer purely from the corpus below)'}

Representative documents:
${packet.docs
  .map(
    (doc, index) =>
      `[${index + 1}] ${doc.title} | ${doc.status} | ${doc.category} | ${doc.path} | ${doc.word_count} words`
  )
  .join('\n')}

Representative chunks:
${packet.chunks
  .map(
    (chunk, index) =>
      `[${index + 1}] ${chunk.doc_title} | ${chunk.doc_status} | ${chunk.doc_category}${
        chunk.heading ? ` | ${chunk.heading}` : ''
      }\n${chunk.body}`
  )
  .join('\n\n')}

Return ONLY valid JSON with this shape:
{
  "project_summary": "string",
  "builder_purpose": "string",
  "newcomer_purpose": "string",
  "product_purpose": "string",
  "ontology_rules": ["string"],
  "ignore_terms": ["string"],
  "preferred_types": ["string"]
}

Rules:
- Be specific to the actual corpus. Do not default to fiction/game vocabulary unless the corpus is clearly that.
- The three purposes must align with: active builders, newcomers, reusable product.
- ignore_terms should list generic junk or filler words that would pollute the HUD (e.g. "thing", "stuff", "note", "idea").
- preferred_types are the ontology categories that actually fit THIS corpus. Choose from: person, place, event, theme, practice, system, organization, artifact, concept, state, work. Pick only the ones that fit; add at most one extra if truly needed.
- No markdown fences.`;

  const raw = await getEngineForWorkspace().generate({ prompt });
  const parsed = parseJsonObject(raw) as Partial<OverviewPass> | null;
  if (
    !parsed ||
    typeof parsed.project_summary !== 'string' ||
    !Array.isArray(parsed.ontology_rules) ||
    !Array.isArray(parsed.ignore_terms) ||
    !Array.isArray(parsed.preferred_types)
  ) {
    throw new Error('Overview pass returned malformed JSON.');
  }
  return {
    project_summary: parsed.project_summary,
    builder_purpose: typeof parsed.builder_purpose === 'string' ? parsed.builder_purpose : '',
    newcomer_purpose: typeof parsed.newcomer_purpose === 'string' ? parsed.newcomer_purpose : '',
    product_purpose: typeof parsed.product_purpose === 'string' ? parsed.product_purpose : '',
    ontology_rules: parsed.ontology_rules.filter((item): item is string => typeof item === 'string'),
    ignore_terms: parsed.ignore_terms.filter((item): item is string => typeof item === 'string'),
    preferred_types: parsed.preferred_types.filter((item): item is string => typeof item === 'string'),
  };
}

function conceptQuotaForShape(shape: CorpusShape): { min: number; max: number } {
  switch (shape.size_class) {
    case 'tiny':
      return { min: 6, max: 14 };
    case 'small':
      return { min: 8, max: 20 };
    case 'medium':
      return { min: 10, max: 24 };
    case 'large':
    default:
      return { min: 12, max: 28 };
  }
}

function buildConceptPrompt(
  packet: ReturnType<typeof buildCorpusPacket>,
  meta: ReturnType<typeof getProjectMeta>,
  overview: OverviewPass,
  shape: CorpusShape,
  mode: 'strict' | 'inclusive'
) {
  const { min, max } = conceptQuotaForShape(shape);
  const inclusiveHint =
    mode === 'inclusive'
      ? `\nFIRST PASS RETURNED TOO FEW CONCEPTS. Be more inclusive this time:\n- Accept recurring themes, practices, mental/emotional states, and motifs as concepts if they are clearly load-bearing in the corpus.\n- Do NOT pad with generic nouns — but DO lean in on anything the author returns to repeatedly.\n`
      : '';
  const preferred =
    overview.preferred_types.length > 0
      ? overview.preferred_types.join(', ')
      : 'person, place, event, theme, practice, system, organization, artifact, concept, state, work';
  return `You are extracting the startup ontology for Bird Brain over an arbitrary readable-file corpus. The corpus could be any kind of project; infer the right ontology from what you actually see.
${inclusiveHint}
Project: ${meta.project_name}
Corpus shape: ${describeShapeForPrompt(shape)}
Project summary: ${overview.project_summary}
Builder purpose: ${overview.builder_purpose}
Newcomer purpose: ${overview.newcomer_purpose}
Product purpose: ${overview.product_purpose}
Guidance notes from the user (authoritative about what this project is):
${meta.guidance_notes?.trim() || '(none)'}
Ontology rules:
${overview.ontology_rules.map((rule) => `- ${rule}`).join('\n') || '(none)'}
Ignore terms (do not return these):
${overview.ignore_terms.map((term) => `- ${term}`).join('\n') || '(none)'}
Preferred concept types for this corpus:
${preferred}

Representative documents:
${packet.docs
  .map(
    (doc, index) =>
      `[${index + 1}] ${doc.title} | ${doc.status} | ${doc.category} | ${doc.path}`
  )
  .join('\n')}

Representative chunks:
${packet.chunks
  .map(
    (chunk, index) =>
      `[${index + 1}] ${chunk.doc_title} | ${chunk.doc_status}${chunk.heading ? ` | ${chunk.heading}` : ''}\n${chunk.body}`
  )
  .join('\n\n')}

Return ONLY valid JSON with this shape:
{
  "concepts": [
    {
      "name": "string",
      "slug": "string",
      "type": "one of the preferred concept types above",
      "aliases": ["string"],
      "summary": "string",
      "rationale": "string"
    }
  ]
}

Rules:
- Produce ${min} to ${max} concepts, tuned to how much signal is actually in the corpus.
- Pick concepts specific to THIS project. Never pad with generic rhetorical words ("idea", "thought", "example") or literary structure words ("introduction", "conclusion").
- Fiction/game categories like "character" only apply if this is clearly fiction or a game. Otherwise prefer the types listed above.
- Summaries must define each concept in plain language for someone new to the project, in 1–2 sentences.
- rationale: one short sentence on why the concept belongs in the ontology.
- Every slug must be lowercase-hyphenated and stable.
- No markdown fences. Raw JSON only.`;
}

function extractConcepts(raw: string): OntologyConceptRow[] {
  const parsed = parseJsonObject(raw) as { concepts?: ConceptDraft[] } | null;
  if (!parsed || !Array.isArray(parsed.concepts)) return [];
  const seen = new Set<string>();
  const concepts: OntologyConceptRow[] = [];
  for (const draft of parsed.concepts) {
    if (!draft || typeof draft.name !== 'string' || typeof draft.summary !== 'string') continue;
    const slug = slugifyPhrase(draft.slug || draft.name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const aliases = Array.from(
      new Set(
        [
          draft.name,
          ...(Array.isArray(draft.aliases)
            ? draft.aliases.filter((alias): alias is string => typeof alias === 'string')
            : []),
        ].filter(Boolean)
      )
    );
    concepts.push({
      slug,
      name: draft.name.trim(),
      type: normalizeConceptType(draft.type),
      aliases,
      summary: draft.summary.trim(),
      rationale: typeof draft.rationale === 'string' ? draft.rationale.trim() : '',
    });
  }
  return concepts;
}

async function runConceptPass(
  packet: ReturnType<typeof buildCorpusPacket>,
  meta: ReturnType<typeof getProjectMeta>,
  overview: OverviewPass,
  shape: CorpusShape
): Promise<OntologyConceptRow[]> {
  const { min } = conceptQuotaForShape(shape);
  const engine = getEngineForWorkspace();

  const firstRaw = await engine.generate({ prompt: buildConceptPrompt(packet, meta, overview, shape, 'strict') });
  let concepts = extractConcepts(firstRaw);

  // Retry with a more inclusive prompt if the first pass is empty or clearly
  // underdelivered (less than half the floor). This protects small / sparse
  // corpora where one strict pass can return nothing usable.
  if (concepts.length < Math.ceil(min / 2)) {
    const retryRaw = await engine.generate({
      prompt: buildConceptPrompt(packet, meta, overview, shape, 'inclusive'),
    });
    const retry = extractConcepts(retryRaw);
    if (retry.length > concepts.length) concepts = retry;
  }

  if (!concepts.length) throw new Error('Ontology concept pass produced no valid concepts.');
  return concepts;
}

async function runLensPass(
  packet: ReturnType<typeof buildCorpusPacket>,
  meta: ReturnType<typeof getProjectMeta>,
  overview: OverviewPass,
  concepts: OntologyConceptRow[]
): Promise<StarterLensRow[]> {
  const prompt = `You are choosing the startup lenses for Bird Brain.

Project: ${meta.project_name}
Project summary: ${overview.project_summary}

Ontology concepts:
${concepts
  .map((concept) => `- ${concept.slug} | ${concept.name} | ${concept.type} | ${concept.summary}`)
  .join('\n')}

Return ONLY valid JSON with this shape:
{
  "lenses": [
    {
      "title": "string",
      "concept_slug": "string",
      "description": "string",
      "order_index": 0
    }
  ]
}

Rules:
- Produce 5 to 8 starter lenses.
- Each lens should feel like a strong place for a user to begin exploring the project.
- concept_slug must come from the ontology concepts list.
- description should work for both newcomers and active builders.
- No markdown fences.`;

  const raw = await getEngineForWorkspace().generate({ prompt });
  const parsed = parseJsonObject(raw) as { lenses?: LensDraft[] } | null;
  if (!parsed || !Array.isArray(parsed.lenses) || !parsed.lenses.length) {
    throw new Error('Starter lens pass returned no lenses.');
  }
  const validSlugs = new Set(concepts.map((concept) => concept.slug));
  const lenses = parsed.lenses
    .filter(
      (lens): lens is LensDraft =>
        Boolean(
          lens &&
            typeof lens.title === 'string' &&
            typeof lens.concept_slug === 'string' &&
            typeof lens.description === 'string'
        )
    )
    .filter((lens) => validSlugs.has(lens.concept_slug))
    .slice(0, 8)
    .map((lens, index) => ({
      concept_slug: lens.concept_slug,
      title: lens.title.trim(),
      description: lens.description.trim(),
      order_index: typeof lens.order_index === 'number' ? lens.order_index : index,
    }));
  if (!lenses.length) throw new Error('Starter lens pass produced no valid lenses.');
  return lenses;
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

function normalizeConceptType(value: string) {
  const allowed = new Set([
    'person',
    'character',
    'place',
    'location',
    'event',
    'theme',
    'practice',
    'system',
    'organization',
    'artifact',
    'concept',
    'state',
    'work',
  ]);
  const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (allowed.has(clean)) return clean;
  // Tolerate close variants before falling through to "concept".
  if (clean === 'people' || clean === 'individual') return 'person';
  if (clean === 'location' || clean === 'setting') return 'place';
  if (clean === 'topic' || clean === 'idea') return 'concept';
  return 'concept';
}

function syncRuntimeOntologyConcepts(concepts: OntologyConceptRow[]) {
  const db = getDb();
  const upsertEntity = db.prepare(
    `INSERT INTO entities (slug, name, type, aliases_json, summary, source, created_at)
     VALUES (?, ?, ?, ?, ?, 'ontology', ?)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       type = excluded.type,
       aliases_json = excluded.aliases_json,
       summary = excluded.summary,
       source = 'ontology',
       created_at = excluded.created_at`
  );
  const deleteStaleOntologyEntities = db.prepare(`DELETE FROM entities WHERE source = 'ontology' AND slug = ?`);
  const insertMention = db.prepare(
    `INSERT INTO entity_mentions (entity_id, document_id, chunk_id, match_count)
     VALUES (?, ?, ?, ?)`
  );

  db.transaction(() => {
    db.prepare(`DELETE FROM entities WHERE source = 'seeded'`).run();
    for (const concept of concepts) {
      upsertEntity.run(
        concept.slug,
        concept.name,
        concept.type,
        JSON.stringify(concept.aliases),
        concept.summary,
        Math.floor(Date.now() / 1000)
      );
    }

    const keep = new Set(concepts.map((concept) => concept.slug));
    const stale = db
      .prepare(`SELECT slug FROM entities WHERE source = 'ontology'`)
      .all() as Array<{ slug: string }>;
    for (const row of stale) {
      if (!keep.has(row.slug)) deleteStaleOntologyEntities.run(row.slug);
    }

    db.prepare(`DELETE FROM entity_mentions`).run();
    db.prepare(`DELETE FROM concept_precontext_cache`).run();
    db.prepare(`DELETE FROM concept_synthesis_cache`).run();
    db.prepare(`DELETE FROM synthesis_queue`).run();
    db.prepare(
      `INSERT INTO project_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run('artifact_cleanup_signature', getProjectMeta().corpus_signature);

    const entityRows = db
      .prepare(`SELECT id, slug, aliases_json FROM entities WHERE source = 'ontology' OR source = 'emerged'`)
      .all() as Array<{ id: number; slug: string; aliases_json: string }>;
    const chunks = db
      .prepare(`SELECT id, document_id, heading, body FROM chunks`)
      .all() as Array<{ id: number; document_id: number; heading: string | null; body: string }>;
    for (const entity of entityRows) {
      const aliases = safeJsonArray(entity.aliases_json);
      if (!aliases.length) continue;
      for (const chunk of chunks) {
        const searchText = [chunk.heading ?? '', chunk.body].join('\n');
        let matchCount = 0;
        for (const alias of aliases) {
          matchCount += countAliasMatches(searchText, alias);
        }
        if (matchCount > 0) {
          insertMention.run(entity.id, chunk.document_id, chunk.id, matchCount);
        }
      }
    }
  })();
}

function queueStarterLensWarmup(lenses: StarterLensRow[]) {
  const seen = new Set<string>();
  for (const lens of lenses) {
    if (seen.has(lens.concept_slug)) continue;
    seen.add(lens.concept_slug);
    const entity = getEntityBySlug(lens.concept_slug);
    if (!entity) continue;
    // Warm the queued lane for first-stop concepts so their precontext +
    // dossier prose can be backfilled without waiting for a manual regenerate.
    enqueueSynthesis({
      entityId: entity.id,
      contextSlug: null,
      rootSlug: entity.slug,
      profile: 'queued',
    });
  }
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function countAliasMatches(text: string, alias: string): number {
  if (!alias || alias.length < 2) return 0;
  const matches = text.match(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'gi'));
  return matches?.length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
