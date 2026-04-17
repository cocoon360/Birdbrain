// Reads data/synthesis/output.json, validates each paragraph, upserts them
// into concept_synthesis, and promotes any `candidate` spans into emerged
// entities. Any referenced 'known' span whose slug is missing in the DB is
// silently downgraded to a plain-text span.

import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db/database';
import {
  getEntityBySlug,
  promoteCandidate,
  upsertSynthesis,
  markQueueDone,
} from '../lib/db/queries';
import { coerceParagraph, linkKnownEntities } from '../lib/synthesis/spanify';
import type { Paragraph } from '../lib/synthesis/types';

const OUT_DIR = path.resolve(process.cwd(), '..', 'data', 'synthesis');
const OUTPUT_FILE = path.join(OUT_DIR, 'output.json');

interface OutputEntity {
  slug: string;
  paragraph: unknown;
  model?: string;
}

interface OutputFile {
  generator?: string;
  model?: string;
  entities: OutputEntity[];
}

function loadOutput(): OutputFile {
  if (!fs.existsSync(OUTPUT_FILE)) {
    throw new Error(`Missing ${OUTPUT_FILE} — write synthesis output first.`);
  }
  const raw = fs.readFileSync(OUTPUT_FILE, 'utf8');
  const parsed = JSON.parse(raw) as OutputFile;
  if (!Array.isArray(parsed.entities)) throw new Error('output.json.entities must be an array');
  return parsed;
}

// Reconcile the spans in a paragraph against the live entity table.
// - `known` spans whose ref doesn't exist → downgraded to plain text.
// - `candidate` spans → entity is promoted (or looked up) and becomes `known`.
function reconcileSpans(
  paragraph: Paragraph,
  contextSlug: string
): { paragraph: Paragraph; promotedSlugs: string[] } {
  const promoted: string[] = [];
  const out: Paragraph = paragraph.map((span) => {
    if (!('ref' in span)) return span;
    if (span.kind === 'known') {
      const exists = getEntityBySlug(span.ref);
      if (exists) return span;
      return { text: span.text };
    }
    // candidate → ensure entity exists, keep as known thereafter
    try {
      const entity = promoteCandidate(span.text, contextSlug);
      if (!promoted.includes(entity.slug)) promoted.push(entity.slug);
      return { text: span.text, ref: entity.slug, kind: 'known' };
    } catch {
      return { text: span.text };
    }
  });
  return { paragraph: out, promotedSlugs: promoted };
}

function main() {
  const output = loadOutput();
  const generator = output.generator ?? 'cursor-agent';
  const model = output.model ?? null;

  let committed = 0;
  let skipped = 0;
  const emerged: string[] = [];

  for (const item of output.entities) {
    const slug = item.slug;
    const entity = getEntityBySlug(slug);
    if (!entity) {
      console.warn(`  skip ${slug}: no entity in DB`);
      skipped += 1;
      continue;
    }
    const paragraph = coerceParagraph(item.paragraph);
    if (!paragraph) {
      console.warn(`  skip ${slug}: malformed paragraph`);
      skipped += 1;
      continue;
    }
    const { paragraph: reconciled, promotedSlugs } = reconcileSpans(paragraph, slug);
    for (const s of promotedSlugs) if (!emerged.includes(s)) emerged.push(s);

    // Bonus safety: auto-link any bare mentions of known concepts the LLM
    // didn't explicitly mark up. Uses longest-first word-boundary matching.
    const knownIndex = getDb()
      .prepare('SELECT slug, name, aliases_json FROM entities')
      .all() as Array<{ slug: string; name: string; aliases_json: string }>;
    const linked = linkKnownEntities(
      reconciled,
      knownIndex.map((k) => ({
        slug: k.slug,
        name: k.name,
        aliases: safeAliases(k.aliases_json),
      }))
    );

    upsertSynthesis({
      entityId: entity.id,
      paragraph: linked,
      generator,
      model,
    });
    markQueueDone(entity.id);
    committed += 1;
  }

  console.log('Synthesis commit complete:');
  console.log(`  committed         : ${committed}`);
  console.log(`  skipped           : ${skipped}`);
  console.log(`  emerged entities  : ${emerged.length}`);
  if (emerged.length) console.log('   → ' + emerged.join(', '));
}

function safeAliases(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x: unknown): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

main();
