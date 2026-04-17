// Writes data/synthesis/prep.json containing top-N un-synthesized entities
// with the evidence and known-concept index needed for the cursor agent to
// produce hypertext paragraphs.

import fs from 'fs';
import path from 'path';

import {
  getEntities,
  getEntityMentions,
  getAllEntitiesWithAliases,
  getProjectMeta,
  type EntityAliasRow,
  type EntityRow,
} from '../lib/db/queries';
import { getDb } from '../lib/db/database';
import type { SynthesisPrep, SynthesisPrepEntity } from '../lib/synthesis/types';

const TOP_N = Number(process.env.SYNTHESIZE_TOP ?? 30);
const EVIDENCE_PER_ENTITY = 8;

const OUT_DIR = path.resolve(process.cwd(), '..', 'data', 'synthesis');
const OUT_FILE = path.join(OUT_DIR, 'prep.json');

function unsynthesizedTop(limit: number): EntityRow[] {
  const db = getDb();
  const synthesizedIds = new Set(
    (db.prepare('SELECT entity_id FROM concept_synthesis').all() as { entity_id: number }[]).map(
      (r) => r.entity_id
    )
  );
  const all = getEntities(undefined, 500);
  return all.filter((e) => !synthesizedIds.has(e.id)).slice(0, limit);
}

function buildEntityPrep(
  entity: EntityRow,
  aliasIndex: Map<string, EntityAliasRow>
): SynthesisPrepEntity {
  const rows = getEntityMentions(entity.slug, EVIDENCE_PER_ENTITY);
  const alias = aliasIndex.get(entity.slug);
  const knownConcepts = Array.from(aliasIndex.values())
    .filter((k) => k.slug !== entity.slug)
    .map((k) => ({ slug: k.slug, name: k.name, type: k.type }));

  return {
    slug: entity.slug,
    name: entity.name,
    type: entity.type,
    aliases: alias?.aliases ?? [],
    mention_count: entity.mention_count,
    document_count: entity.document_count,
    known_concepts: knownConcepts,
    evidence: rows.map((r) => ({
      doc_title: r.doc_title,
      doc_status: r.doc_status,
      heading: r.heading,
      body: r.body.replace(/\s+/g, ' ').slice(0, 900),
    })),
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const meta = getProjectMeta();
  const entities = unsynthesizedTop(TOP_N);
  const aliasRows = getAllEntitiesWithAliases();
  const aliasIndex = new Map(aliasRows.map((r) => [r.slug, r]));

  const prep: SynthesisPrep = {
    generated_at: Math.floor(Date.now() / 1000),
    project_name: meta.project_name,
    entities: entities.map((e) => buildEntityPrep(e, aliasIndex)),
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(prep, null, 2));
  console.log(
    `Prepared ${prep.entities.length} entities for synthesis → ${path.relative(
      process.cwd(),
      OUT_FILE
    )}`
  );
}

main();
