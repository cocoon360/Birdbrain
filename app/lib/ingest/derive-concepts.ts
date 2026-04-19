// Derive seeded concepts from the corpus itself.
//
// The engine knows nothing about any particular project. Pointed at a folder
// of markdown, it stacks signals (filenames, headings, proper-noun tokens in
// body text) and promotes candidates that cross thresholds into seeded
// entities. This is the same machinery that will later promote candidates
// from participation events — the only difference is the trigger.

import type { ParsedDocument, ParsedChunk } from './parse';
import type { ProjectGuidance } from './project-guidance';

export interface ConceptEvidence {
  filename_hits: number;
  heading_hits: number;
  body_doc_hits: number;
  total_body_mentions: number;
  score: number;
  dominant_category: string;
}

export interface DerivedConcept {
  slug: string;
  name: string;
  type: string;
  aliases: string[];
  summary: string;
  evidence: ConceptEvidence;
}

// Stopwords for single-token candidates. We keep multi-word phrases (bigrams)
// since those are almost always meaningful even when the individual words are
// common — "Opening Incident" is meaningful even though "Opening" is not. The
// list below covers pronouns, auxiliary verbs, common adverbs/adjectives, and
// document-structure words that surface as Title-case only because they start
// a sentence in body text.
const STOPWORDS = new Set([
  // negations & minor particles
  'not', 'no', 'yes', 'nor', 'nope', 'yep',
  // pronouns
  'she', 'he', 'her', 'him', 'his', 'hers', 'they', 'them', 'their', 'theirs',
  'it', 'its', 'itself', 'we', 'us', 'our', 'ours', 'you', 'your', 'yours',
  'i', 'me', 'my', 'mine', 'myself', 'yourself', 'yourselves', 'themselves',
  'who', 'whom', 'whose', 'which', 'what', 'whoever', 'whatever', 'whichever',
  // auxiliaries, common verbs
  'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'does', 'did',
  'do', 'doing', 'done', 'can', 'could', 'should', 'would', 'will', 'may',
  'might', 'must', 'shall', 'let', 'get', 'got', 'make', 'made', 'said',
  'say', 'says', 'take', 'took', 'taken', 'put', 'keep', 'kept', 'seem',
  'seems', 'seemed', 'feel', 'feels', 'felt', 'find', 'found', 'give',
  'given', 'go', 'goes', 'gone', 'know', 'knows', 'knew', 'known',
  // articles, conjunctions, prepositions
  'the', 'a', 'an', 'and', 'or', 'but', 'nor', 'for', 'yet', 'so', 'if',
  'then', 'than', 'because', 'since', 'though', 'although', 'while', 'when',
  'where', 'why', 'how', 'whether', 'with', 'without', 'within', 'into',
  'onto', 'upon', 'from', 'to', 'at', 'by', 'of', 'on', 'in', 'out',
  'over', 'under', 'through', 'during', 'between', 'against', 'before',
  'after', 'above', 'below', 'about', 'across', 'around', 'toward',
  // indefinite / quantifier words
  'this', 'that', 'these', 'those', 'here', 'there', 'everywhere',
  'something', 'someone', 'somebody', 'somewhere', 'anything', 'anyone',
  'anybody', 'anywhere', 'nothing', 'nobody', 'no one', 'everything',
  'everyone', 'everybody', 'all', 'any', 'some', 'none', 'each', 'every',
  'both', 'either', 'neither', 'other', 'others', 'another', 'such',
  'same', 'own', 'only', 'just', 'also', 'too', 'very', 'much', 'many',
  'more', 'most', 'less', 'least', 'few', 'little', 'lot', 'lots',
  // adjectives/adverbs that commonly sentence-open
  'different', 'real', 'good', 'bad', 'better', 'best', 'worst', 'right',
  'wrong', 'true', 'false', 'new', 'old', 'big', 'small', 'great', 'long',
  'short', 'high', 'low', 'hard', 'easy', 'simple', 'complex', 'whole',
  'next', 'last', 'first', 'second', 'early', 'late', 'later', 'early',
  'now', 'today', 'tomorrow', 'yesterday', 'soon', 'always', 'never',
  'often', 'sometimes', 'usually', 'maybe', 'perhaps', 'probably',
  'because', 'therefore', 'however', 'meanwhile', 'thus', 'hence',
  'instead', 'rather', 'actually', 'really', 'especially', 'particularly',
  // numbers and degree
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'hundred', 'thousand', 'once', 'twice', 'lots', 'several',
  // document / structural
  'part', 'parts', 'section', 'note', 'notes', 'page', 'chapter', 'readme',
  'index', 'overview', 'summary', 'final', 'locked', 'revised', 'archive',
  'archived', 'draft', 'working', 'reference', 'example', 'examples',
  'option', 'options', 'item', 'items', 'list', 'step', 'steps', 'idea',
  'ideas', 'thing', 'things', 'way', 'ways', 'kind', 'type', 'types',
  'case', 'cases', 'point', 'points', 'level', 'version', 'versions',
  'use', 'used', 'using', 'need', 'needs', 'needed', 'want', 'wanted',
  'wants', 'say', 'says', 'said', 'see', 'seen', 'saw', 'look',
  'end', 'start', 'begin', 'began', 'begun', 'finish', 'finished',
  'add', 'added', 'remove', 'removed', 'change', 'changed',
]);

// Tokens that commonly appear Title-cased because they start sentences but
// are almost never legitimate concept names. This supplements STOPWORDS for
// single-token body-text matches.
const COMMON_SENTENCE_STARTS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'here', 'there',
  'she', 'he', 'it', 'they', 'we', 'you', 'i', 'who', 'what', 'when',
  'where', 'why', 'how', 'if', 'but', 'and', 'or', 'so', 'yet',
  'because', 'since', 'though', 'although', 'while', 'whenever',
  'does', 'do', 'did', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
  'can', 'could', 'should', 'would', 'will', 'may', 'might', 'must',
  'some', 'any', 'many', 'much', 'most', 'all', 'every', 'each',
  'even', 'also', 'only', 'just', 'still', 'now', 'then', 'later',
  'something', 'someone', 'anything', 'anyone', 'nothing', 'nobody',
  'everything', 'everyone', 'perhaps', 'maybe', 'rather', 'instead',
  'however', 'moreover', 'therefore', 'thus', 'hence', 'first',
  'second', 'third', 'next', 'last', 'different', 'real', 'same',
  'other', 'another', 'such', 'own', 'true', 'false', 'new', 'old',
  'good', 'bad', 'better', 'best', 'yes', 'no', 'ok', 'okay',
]);

// Folder-name → entity-type hints. Generic across projects: any folder whose
// lowercase name contains one of these tokens biases its concepts toward that
// type. If none match, the concept keeps the default 'concept' type.
const CATEGORY_TYPE_HINTS: Array<{ match: RegExp; type: string }> = [
  { match: /character|cast|protagonist|npc/i, type: 'character' },
  { match: /world|place|location|setting|map|area/i, type: 'location' },
  { match: /incident|event|scene|moment/i, type: 'event' },
  { match: /theme|motif|idea/i, type: 'theme' },
  { match: /system|mechanic|loop|gameplay/i, type: 'system' },
  { match: /org|faction|group|crew/i, type: 'organization' },
];

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Split a filename stem like "PROJECT_OVERVIEW" or "Core_Concepts_v2"
// into tokens, filtering empties.
function tokenizeStem(stem: string): string[] {
  return stem
    .replace(/\.md$/i, '')
    .split(/[_\-\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

function inferTypeFromLabel(label: string): string {
  const lower = label.toLowerCase();
  for (const hint of CATEGORY_TYPE_HINTS) {
    if (hint.match.test(lower)) return hint.type;
  }
  return 'concept';
}

// Weighted type selection. We sum each candidate's category weights into
// type buckets and pick the strongest specific (non-concept) type if it
// carries ≥15% of the total weight. This lets an entity that lives mostly
// in one kind of folder (e.g. `characters/`, `api/`) be classified by that
// category even when body mentions span many other folders.
function chooseType(categoryWeight: Map<string, number>, candidateName: string): string {
  const typeWeight = new Map<string, number>();
  let total = 0;
  for (const [cat, weight] of categoryWeight) {
    const t = inferTypeFromLabel(cat);
    typeWeight.set(t, (typeWeight.get(t) ?? 0) + weight);
    total += weight;
  }

  let bestSpecificType = '';
  let bestWeight = 0;
  for (const [t, w] of typeWeight) {
    if (t === 'concept') continue;
    if (w > bestWeight) {
      bestWeight = w;
      bestSpecificType = t;
    }
  }
  if (total > 0 && bestSpecificType && bestWeight / total >= 0.15) {
    return bestSpecificType;
  }
  // Fallback: classify by the candidate's own name (e.g., a candidate named
  // "Opening Incident" looks like an event even if categories are ambiguous).
  return inferTypeFromLabel(candidateName);
}

// Build a candidate map. Each candidate is keyed by its normalized slug and
// accrues signal from every source. We record which categories the candidate
// appears under so we can infer a type from the dominant one.
interface CandidateAccumulator {
  displayName: string;
  aliases: Set<string>;
  filename_hits: number;
  heading_hits: number;
  body_doc_hits: Set<number>;
  total_body_mentions: number;
  // category counts weighted by signal source so filename-in-character-folder
  // beats body-in-canon-folder for type classification.
  category_weight: Map<string, number>;
}

function bump(
  candidates: Map<string, CandidateAccumulator>,
  rawName: string,
  category: string,
  kind: 'filename' | 'heading' | 'body',
  opts: { docId?: number; mentions?: number } = {},
  filters?: { ignoreSlugs: Set<string> }
): void {
  const normalized = rawName.trim();
  if (!normalized) return;
  if (normalized.length < 3) return;

  const lower = normalized.toLowerCase();
  const isMultiToken = /\s/.test(normalized);
  // Stopword filter applies fully to single-token candidates. For multi-word
  // phrases we skip this filter, since phrases like "Opening Incident" are
  // meaningful even if individual words appear common.
  if (!isMultiToken && STOPWORDS.has(lower)) return;
  // Body-text candidates face an extra filter: common sentence-starters like
  // "She"/"Does"/"Different" get Title-cased by position, not by properness.
  if (!isMultiToken && kind === 'body' && COMMON_SENTENCE_STARTS.has(lower)) return;

  const slug = toSlug(normalized);
  if (!slug) return;
  if (filters?.ignoreSlugs.has(slug)) return;

  let entry = candidates.get(slug);
  if (!entry) {
    entry = {
      displayName: titleCase(normalized),
      aliases: new Set(),
      filename_hits: 0,
      heading_hits: 0,
      body_doc_hits: new Set<number>(),
      total_body_mentions: 0,
      category_weight: new Map(),
    };
    candidates.set(slug, entry);
  }

  entry.aliases.add(normalized);
  // Signal-specific category weights: filename >> heading > body.
  const categoryBoost = kind === 'filename' ? 8 : kind === 'heading' ? 3 : 1;

  if (kind === 'filename') entry.filename_hits += 1;
  if (kind === 'heading') entry.heading_hits += 1;
  if (kind === 'body') {
    if (opts.docId !== undefined) entry.body_doc_hits.add(opts.docId);
    entry.total_body_mentions += opts.mentions ?? 0;
  }

  // Only filename and heading signals contribute to type-inference category
  // weights. Body-text presence alone is not evidence of type — generic
  // English nouns ("Community", "People") body-match everywhere and would
  // otherwise inherit the type of whatever folder they appear most in.
  if (category && kind !== 'body') {
    entry.category_weight.set(
      category,
      (entry.category_weight.get(category) ?? 0) + categoryBoost
    );
  }
}

// Proper-noun-ish tokens in body text: Title-case tokens or Title-case bigrams
// that aren't sentence-opening "The/And/Etc.". We also catch all-caps tokens
// (3+ chars) because design docs often yell names.
function extractProperNounMentions(body: string): Map<string, number> {
  // Strip contraction suffixes before tokenizing so "Doesn't" → "Does",
  // "Alex's" → "Alex", "They'd" → "They". This prevents dangling
  // fragments like "Doesn" from entering the concept table.
  const cleaned = body
    // Full "n't" contractions: doesn't → does, isn't → is, won't → wo (length-filtered)
    .replace(/n['’]t\b/gi, '')
    // Remaining common suffix contractions: 's, 'd, 'll, 're, 've, 'm, 't, 'em
    .replace(/['’](s|d|ll|re|ve|m|t|em)\b/gi, '');

  const counts = new Map<string, number>();
  // Single Title-case or ALL-CAPS tokens.
  const singleRe = /\b([A-Z][a-z]{2,}|[A-Z]{3,})\b/g;
  // Two-word Title-case phrases (e.g., "Inventory System", "Core Loop").
  const bigramRe = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\b/g;

  const seenPositions = new Set<number>();
  let m: RegExpExecArray | null;

  while ((m = bigramRe.exec(cleaned))) {
    const phrase = m[1];
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    seenPositions.add(m.index);
    seenPositions.add(m.index + m[1].indexOf(' ') + 1);
  }

  while ((m = singleRe.exec(cleaned))) {
    if (seenPositions.has(m.index)) continue;
    const token = m[1];
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function deriveConcepts(
  parsedDocs: ParsedDocument[],
  guidance?: ProjectGuidance
): DerivedConcept[] {
  const candidates = new Map<string, CandidateAccumulator>();
  const filters = {
    ignoreSlugs: new Set((guidance?.ignore_terms ?? []).map((term) => toSlug(term)).filter(Boolean)),
  };
  const prioritySlugs = new Set(
    (guidance?.prioritize_terms ?? []).map((term) => toSlug(term)).filter(Boolean)
  );

  // Index each parsed doc with a synthetic id so body-doc-hits can be unique.
  parsedDocs.forEach((doc, docId) => {
    const category = doc.category;

    // ── Filename signal ────────────────────────────────────────────────────
    const stem = doc.file_path.split('/').pop()?.replace(/\.md$/i, '') ?? '';
    const filenameTokens = tokenizeStem(stem);
    for (const tok of filenameTokens) {
      bump(candidates, tok, category, 'filename', {}, filters);
    }
    // Also consider the whole stem (as a phrase, if multi-token)
    if (filenameTokens.length > 1) {
      const phrase = filenameTokens.join(' ');
      bump(candidates, phrase, category, 'filename', {}, filters);
    }
    // H1 / document title
    if (doc.title) {
      bump(candidates, doc.title, category, 'heading', {}, filters);
      // Also tokens from the title
      for (const tok of tokenizeStem(doc.title)) {
        bump(candidates, tok, category, 'heading', {}, filters);
      }
    }

    // ── Heading signal (H1, H2 only — deeper headings are usually structural) ──
    for (const chunk of doc.chunks as ParsedChunk[]) {
      if (chunk.heading && chunk.heading_level <= 2) {
        bump(candidates, chunk.heading, category, 'heading', {}, filters);
      }
    }

    // ── Body proper-noun signal ────────────────────────────────────────────
    const bodyText = doc.chunks.map((c) => c.body).join('\n');
    const mentions = extractProperNounMentions(bodyText);
    for (const [phrase, count] of mentions) {
      bump(candidates, phrase, category, 'body', { docId, mentions: count }, filters);
    }
  });

  // Score and filter.
  const derived: DerivedConcept[] = [];
  for (const [slug, entry] of candidates) {
    const bodyDocHits = entry.body_doc_hits.size;
    // Weighted score: filename signals are strongest, then headings, then body.
    const score =
      entry.filename_hits * 4 +
      entry.heading_hits * 2 +
      bodyDocHits * 1 +
      Math.min(entry.total_body_mentions, 100) * 0.1 +
      (prioritySlugs.has(slug) ? 6 : 0);

    // Promotion rules:
    //   • Score ≥ 6 AND appears in ≥2 distinct signals (anti-noise) OR
    //   • Filename hits ≥ 2 (strong filename pattern alone is enough)
    const distinctSignals =
      (entry.filename_hits > 0 ? 1 : 0) +
      (entry.heading_hits > 0 ? 1 : 0) +
      (bodyDocHits > 0 ? 1 : 0);

    const qualifies =
      entry.filename_hits >= 2 ||
      (score >= 6 && distinctSignals >= 2) ||
      (bodyDocHits >= 4 && entry.total_body_mentions >= 12);

    if (!qualifies) continue;

    // Dominant category for type inference (filename-weighted so a concept
    // that lives in a character folder by filename beats generic canon mentions).
    let dominantCategory = '';
    let dominantCount = 0;
    for (const [cat, weight] of entry.category_weight) {
      if (weight > dominantCount) {
        dominantCount = weight;
        dominantCategory = cat;
      }
    }

    const type = chooseType(entry.category_weight, entry.displayName);

    derived.push({
      slug,
      name: entry.displayName,
      type,
      aliases: Array.from(entry.aliases),
      summary: '', // populated later by the synthesis layer
      evidence: {
        filename_hits: entry.filename_hits,
        heading_hits: entry.heading_hits,
        body_doc_hits: bodyDocHits,
        total_body_mentions: entry.total_body_mentions,
        score,
        dominant_category: dominantCategory,
      },
    });
  }

  // Highest signal first so the entities table is ordered meaningfully.
  derived.sort((a, b) => b.evidence.score - a.evidence.score);
  return derived;
}
