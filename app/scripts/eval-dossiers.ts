#!/usr/bin/env tsx
/**
 * Bird Brain dossier evaluation harness
 *
 * Runs `synthesizeForSlug` for a batch of concepts and writes a small report
 * you can eyeball (and diff across prompt changes) before claiming the
 * retrieval pipeline got "better." This is the honest counterweight to the
 * "just regenerate and see if it reads nice" loop.
 *
 * Usage:
 *   npm run ingest                        # (prereq) workspace + ontology ready
 *   DOCS_PATH=/path/to/folder \
 *   WORKSPACE_FOLDER=/path/to/folder \
 *   npx tsx scripts/eval-dossiers.ts            # top-12 concepts by mention
 *
 *   EVAL_SLUGS=slug-one,slug-two,slug-three \
 *   npx tsx scripts/eval-dossiers.ts            # explicit slug list
 *
 *   EVAL_LIMIT=6 EVAL_PROFILE=queued \
 *   npx tsx scripts/eval-dossiers.ts            # tune batch + profile
 *
 * Output: data/eval/dossiers-<timestamp>.{json,md}
 *
 * The markdown report is what you skim by eye. The JSON file is what you diff
 * between prompt revisions.
 */

import fs from 'fs';
import path from 'path';
import {
  adoptLegacyWorkspace,
  addWorkspace,
  getWorkspace,
  getWorkspaceByFolder,
} from '../lib/workspaces/registry';
import { withWorkspaceId } from '../lib/workspaces/context';
import { getEntities, deleteSynthesisCacheForSlug, type EntityRow } from '../lib/db/queries';
import { synthesizeForSlug } from '../lib/ai/synthesize';
import type { Paragraph } from '../lib/synthesis/types';

// Phrases we explicitly forbid when evidence exists. Matches the "BANNED"
// block in the synthesis prompt; if the model ignored it, that shows up here.
const BANNED_PHRASES = [
  'not enough',
  'no information',
  'limited information',
  "the snippets don't",
  'no specific',
  'cannot determine',
  "i don't have",
  'insufficient',
  'no details',
];

interface PerSlotReport {
  slug: string;
  name: string;
  type: string;
  mention_count: number;
  document_count: number;
  profile: 'live' | 'queued';
  ok: boolean;
  error?: string;
  duration_ms?: number;
  prompt_chars?: number;
  precontext_words?: number;
  precontext_preview?: string;
  paragraph_words?: number;
  paragraph_links?: number;
  paragraph_link_rate?: number;
  banned_hits?: string[];
  paragraph_preview?: string;
}

async function resolveWorkspaceId(): Promise<string> {
  adoptLegacyWorkspace();
  if (process.env.WORKSPACE_ID) return process.env.WORKSPACE_ID;
  if (process.env.WORKSPACE_FOLDER) {
    const folder = path.resolve(process.env.WORKSPACE_FOLDER);
    const existing = getWorkspaceByFolder(folder);
    return (existing ?? addWorkspace({ folderPath: folder })).id;
  }
  // Fall back: if a legacy DB was adopted it will be the first workspace.
  throw new Error(
    'Set WORKSPACE_ID or WORKSPACE_FOLDER before running eval-dossiers. ' +
      'Easiest path: export the same WORKSPACE_FOLDER you used for ingest.'
  );
}

function pickSlugs(all: EntityRow[]): string[] {
  const raw = process.env.EVAL_SLUGS?.trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const limit = Number(process.env.EVAL_LIMIT ?? 12);
  return [...all]
    .sort((a, b) => b.mention_count - a.mention_count)
    .slice(0, limit)
    .map((e) => e.slug);
}

function paragraphStats(p: Paragraph) {
  let words = 0;
  let links = 0;
  const plain: string[] = [];
  for (const span of p) {
    if ('ref' in span) {
      links += 1;
      words += span.text.trim().split(/\s+/).filter(Boolean).length;
    } else {
      words += span.text.trim().split(/\s+/).filter(Boolean).length;
    }
    plain.push(span.text);
  }
  const text = plain.join('').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const banned_hits = BANNED_PHRASES.filter((p) => lower.includes(p));
  return {
    words,
    links,
    link_rate: words > 0 ? +(links / words).toFixed(3) : 0,
    preview: text.slice(0, 280),
    banned_hits,
  };
}

function textStats(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return {
    words: clean ? clean.split(/\s+/).filter(Boolean).length : 0,
    preview: clean.slice(0, 280),
  };
}

async function main() {
  const workspaceId = await resolveWorkspaceId();
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
  const profile = (process.env.EVAL_PROFILE === 'queued' ? 'queued' : 'live') as
    | 'live'
    | 'queued';
  const keepCache = process.env.EVAL_KEEP_CACHE === '1';

  const reports: PerSlotReport[] = [];

  await withWorkspaceId(workspace.id, async () => {
    const all = getEntities(undefined, 500);
    const entityBySlug = new Map(all.map((e) => [e.slug, e]));
    const slugs = pickSlugs(all);

    console.log(
      `[eval] workspace=${workspace.name} profile=${profile} slugs=${slugs.length}` +
        `${keepCache ? ' keep_cache=1' : ''}`
    );

    for (const slug of slugs) {
      const entity = entityBySlug.get(slug);
      if (!entity) {
        reports.push({
          slug,
          name: slug,
          type: 'unknown',
          mention_count: 0,
          document_count: 0,
          profile,
          ok: false,
          error: 'entity-not-found',
        });
        continue;
      }
      if (!keepCache) deleteSynthesisCacheForSlug(slug, profile);
      const started = Date.now();
      try {
        const result = await synthesizeForSlug(slug, { profile });
        const stats = paragraphStats(result.paragraph);
        const precontextStats = textStats(result.precontext.precontext_text);
        reports.push({
          slug,
          name: entity.name,
          type: entity.type,
          mention_count: entity.mention_count,
          document_count: entity.document_count,
          profile,
          ok: true,
          duration_ms: Date.now() - started,
          prompt_chars: result.promptChars,
          precontext_words: precontextStats.words,
          precontext_preview: precontextStats.preview,
          paragraph_words: stats.words,
          paragraph_links: stats.links,
          paragraph_link_rate: stats.link_rate,
          banned_hits: stats.banned_hits,
          paragraph_preview: stats.preview,
        });
      } catch (err) {
        reports.push({
          slug,
          name: entity.name,
          type: entity.type,
          mention_count: entity.mention_count,
          document_count: entity.document_count,
          profile,
          ok: false,
          duration_ms: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  const summary = summarise(reports);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.cwd(), '..', 'data', 'eval');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `dossiers-${stamp}.json`);
  const mdPath = path.join(outDir, `dossiers-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify({ summary, reports }, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(summary, reports, workspace.name, profile));
  console.log(`[eval] wrote ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`[eval] wrote ${path.relative(process.cwd(), mdPath)}`);
  console.log(
    `[eval] ok=${summary.ok}/${summary.total} avg_prompt_chars=${summary.avg_prompt_chars} ` +
      `avg_words=${summary.avg_words} avg_links=${summary.avg_links} ` +
      `banned=${summary.with_banned} avg_ms=${summary.avg_ms}`
  );
}

function summarise(reports: PerSlotReport[]) {
  const ok = reports.filter((r) => r.ok);
  const avg = (xs: number[]) =>
    xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
  return {
    total: reports.length,
    ok: ok.length,
    failed: reports.length - ok.length,
    with_banned: ok.filter((r) => (r.banned_hits ?? []).length > 0).length,
    avg_prompt_chars: Math.round(avg(ok.map((r) => r.prompt_chars ?? 0))),
    avg_precontext_words: avg(ok.map((r) => r.precontext_words ?? 0)),
    avg_words: avg(ok.map((r) => r.paragraph_words ?? 0)),
    avg_links: avg(ok.map((r) => r.paragraph_links ?? 0)),
    avg_link_rate: avg(ok.map((r) => r.paragraph_link_rate ?? 0)),
    avg_ms: Math.round(avg(ok.map((r) => r.duration_ms ?? 0))),
  };
}

function renderMarkdown(
  summary: ReturnType<typeof summarise>,
  reports: PerSlotReport[],
  workspaceName: string,
  profile: 'live' | 'queued'
) {
  const lines: string[] = [];
  lines.push(`# Dossier eval — ${workspaceName}`);
  lines.push('');
  lines.push(`- profile: \`${profile}\``);
  lines.push(`- generated: ${new Date().toISOString()}`);
  lines.push(
    `- ok: ${summary.ok}/${summary.total} · failed: ${summary.failed} · banned-phrase hits: ${summary.with_banned}`
  );
  lines.push(
    `- avg: prompt_chars=${summary.avg_prompt_chars} · precontext_words=${summary.avg_precontext_words} · words=${summary.avg_words} · links=${summary.avg_links} · link_rate=${summary.avg_link_rate} · latency=${summary.avg_ms}ms`
  );
  lines.push('');
  lines.push('## Manual rubric');
  lines.push('');
  lines.push('- Definition beat present: does it clearly say what the concept is?');
  lines.push('- Project beat present: does it clearly say what the concept is here?');
  lines.push('- Study beat present: does it connect the concept back to the broader archive/project inquiry?');
  lines.push('- Readable: does it read like explanation rather than retrieval reportage?');
  lines.push('');
  lines.push('## Per-slug');
  lines.push('');
  lines.push('| slug | prompt chars | precontext words | words | links | banned | ms | ok |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|:---:|');
  for (const r of reports) {
    lines.push(
      `| \`${r.slug}\` | ${r.prompt_chars ?? '-'} | ${r.precontext_words ?? '-'} | ${r.paragraph_words ?? '-'} | ${r.paragraph_links ?? '-'} | ${(r.banned_hits ?? []).length} | ${r.duration_ms ?? '-'} | ${r.ok ? '✓' : '✗'} |`
    );
  }
  lines.push('');
  lines.push('## Previews');
  lines.push('');
  for (const r of reports) {
    lines.push(`### ${r.name} (${r.type})`);
    if (!r.ok) {
      lines.push(`> _error: ${r.error ?? 'unknown'}_`);
    } else {
      if ((r.banned_hits ?? []).length > 0) {
        lines.push(`> _banned-phrase hits: ${(r.banned_hits ?? []).join(', ')}_`);
      }
      lines.push('');
      if (r.precontext_preview) {
        lines.push(`Precontext: ${r.precontext_preview}`);
        lines.push('');
      }
      lines.push(r.paragraph_preview ?? '');
      lines.push('');
      lines.push('- manual checks: [ ] definition  [ ] project role  [ ] study relevance  [ ] readable');
    }
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
