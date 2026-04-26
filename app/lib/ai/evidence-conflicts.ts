import type { EntityEvidenceRow } from '../db/queries';

export interface EvidenceConflict {
  kind: string;
  summary: string;
  a: {
    doc_id: number;
    doc_path: string;
    doc_title: string;
    doc_status: string;
    heading: string | null;
    excerpt: string;
  };
  b: {
    doc_id: number;
    doc_path: string;
    doc_title: string;
    doc_status: string;
    heading: string | null;
    excerpt: string;
  };
}

const NEGATION_HINTS = [
  /\bno longer\b/i,
  /\bnot any more\b/i,
  /\bnot anymore\b/i,
  /\bdeprecated\b/i,
  /\bscrapped\b/i,
  /\bremoved\b/i,
  /\breplaced\b/i,
  /\bsuperseded\b/i,
  /\bold docs\b/i,
  /\bcurrent direction\b/i,
];

function norm(s: string) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function excerpt(text: string, max = 220) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function hasAny(hay: string, patterns: RegExp[]) {
  return patterns.some((re) => re.test(hay));
}

function statusRank(status: string): number {
  switch (status) {
    case 'canon':
      return 0;
    case 'working':
      return 1;
    case 'active':
      return 2;
    case 'reference':
      return 3;
    case 'brainstorm':
      return 4;
    case 'archive':
      return 5;
    default:
      return 6;
  }
}

type Rule = {
  kind: string;
  summary: string;
  a: RegExp;
  b: RegExp;
};

/**
 * Cheap, deterministic "possible conflict" finder across evidence snippets.
 * This is not a full semantic contradiction engine — it highlights common
 * design-doc drift patterns (especially POV / playability language).
 */
const RULES: Rule[] = [
  {
    kind: 'pov-single-vs-dual',
    summary: 'One passage reads single-POV / Oliver-only; another reads dual-POV.',
    a: /\b(single|one)[-\s]?(pov|point of view)\b|\boliver[-\s]?only\b|\bonly oliver\b|\bplayer is oliver\b|\bplay as oliver\b/i,
    b: /\bdual[-\s]?(pov|point of view)\b|\btwo[-\s]?(playable|pov)\b|\bplay as (both|each)\b|\bswitch(ing)? (between )?(oliver|hunter)\b/i,
  },
  {
    kind: 'playable-single-vs-dual',
    summary: 'One passage reads single playable protagonist; another reads two playable leads.',
    a: /\b(single|one|only)[-\s]?(playable|player|protagonist)\b|\bnot a second playable\b|\bwithout becoming a second playable\b/i,
    b: /\b(two|dual)[-\s]?(playable|protagonists?|leads?)\b|\bplay as (both|each)\b/i,
  },
];

function rowText(row: EntityEvidenceRow) {
  return norm(`${row.heading ?? ''} ${row.body}`);
}

function negationScore(row: EntityEvidenceRow) {
  const hay = `${row.heading ?? ''} ${row.body}`;
  return NEGATION_HINTS.reduce((acc, re) => acc + (re.test(hay) ? 1 : 0), 0);
}

function orderPair(r1: EntityEvidenceRow, r2: EntityEvidenceRow): [EntityEvidenceRow, EntityEvidenceRow] {
  const s1 = statusRank(r1.doc_status);
  const s2 = statusRank(r2.doc_status);
  if (s1 !== s2) return s1 <= s2 ? [r1, r2] : [r2, r1];

  const n1 = negationScore(r1);
  const n2 = negationScore(r2);
  if (n1 !== n2) return n1 >= n2 ? [r1, r2] : [r2, r1];

  if (r1.file_mtime !== r2.file_mtime) return r1.file_mtime >= r2.file_mtime ? [r1, r2] : [r2, r1];
  return r1.doc_title <= r2.doc_title ? [r1, r2] : [r2, r1];
}

export function findPossibleEvidenceConflicts(rows: EntityEvidenceRow[], limit = 3): EvidenceConflict[] {
  const out: EvidenceConflict[] = [];

  for (const rule of RULES) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const x = rows[i];
        const y = rows[j];
        const xt = rowText(x);
        const yt = rowText(y);

        const forward = rule.a.test(xt) && rule.b.test(yt);
        const backward = rule.a.test(yt) && rule.b.test(xt);
        if (!forward && !backward) continue;

        const [r1, r2] = forward ? orderPair(x, y) : orderPair(y, x);

        // If neither side looks like a correction and both are same bucket, skip as noise.
        const hasNeg =
          hasAny(r1.body, NEGATION_HINTS) ||
          hasAny(r2.body, NEGATION_HINTS) ||
          hasAny(r1.heading ?? '', NEGATION_HINTS) ||
          hasAny(r2.heading ?? '', NEGATION_HINTS);
        if (!hasNeg && r1.doc_status === r2.doc_status) continue;

        out.push({
          kind: rule.kind,
          summary: rule.summary,
          a: {
            doc_id: r1.doc_id,
            doc_path: r1.doc_path,
            doc_title: r1.doc_title,
            doc_status: r1.doc_status,
            heading: r1.heading,
            excerpt: excerpt(r1.body),
          },
          b: {
            doc_id: r2.doc_id,
            doc_path: r2.doc_path,
            doc_title: r2.doc_title,
            doc_status: r2.doc_status,
            heading: r2.heading,
            excerpt: excerpt(r2.body),
          },
        });
        if (out.length >= limit) return dedupe(out, limit);
      }
    }
  }

  return dedupe(out, limit);
}

function dedupe(items: EvidenceConflict[], limit: number) {
  const seen = new Set<string>();
  const out: EvidenceConflict[] = [];
  for (const it of items) {
    const key = `${it.kind}|${it.a.doc_id}|${it.b.doc_id}|${it.a.excerpt}|${it.b.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}
