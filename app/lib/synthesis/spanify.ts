import type { Paragraph, Span } from './types';

export interface KnownEntity {
  slug: string;
  name: string;
  aliases: string[];
}

// Slugify any free-text phrase into a stable identifier. Lowercase,
// alphanumeric + hyphens. Used when promoting candidate spans to entities.
export function slugifyPhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[\u2018\u2019'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Normalize a phrase for comparison (case-insensitive, collapsed whitespace).
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Walk a paragraph and, for any text span that contains the *whole word* of
// a known entity's name or alias, split it so that match becomes its own
// `known` span. Case-insensitive; first occurrence per span wins to avoid
// runaway splits. Leaves existing `known` / `candidate` spans untouched.
export function linkKnownEntities(paragraph: Paragraph, known: KnownEntity[]): Paragraph {
  if (!known.length) return paragraph;
  // Sort longest first so "Seaview College" wins over "Seaview".
  const tokens = known
    .flatMap((e) => [e.name, ...e.aliases].map((t) => ({ slug: e.slug, token: t })))
    .filter((t) => t.token && t.token.length >= 3)
    .sort((a, b) => b.token.length - a.token.length);

  const out: Paragraph = [];
  for (const span of paragraph) {
    if ('ref' in span) {
      out.push(span);
      continue;
    }
    out.push(...splitSpan(span.text, tokens));
  }
  return out;
}

function splitSpan(
  text: string,
  tokens: Array<{ slug: string; token: string }>
): Span[] {
  for (const { slug, token } of tokens) {
    const idx = findWordBoundary(text, token);
    if (idx === -1) continue;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + token.length);
    const after = text.slice(idx + token.length);
    const result: Span[] = [];
    if (before) result.push(...splitSpan(before, tokens));
    result.push({ text: match, ref: slug, kind: 'known' });
    if (after) result.push(...splitSpan(after, tokens));
    return result;
  }
  return [{ text }];
}

function findWordBoundary(haystack: string, needle: string): number {
  const h = haystack;
  const n = needle;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(n)}(?![A-Za-z0-9])`, 'i');
  const m = re.exec(h);
  return m ? m.index : -1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Validate a paragraph payload coming from JSON. Returns null if malformed.
export function coerceParagraph(value: unknown): Paragraph | null {
  if (!Array.isArray(value)) return null;
  const out: Paragraph = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === 'string' ? obj.text : null;
    if (text === null) return null;
    if ('ref' in obj) {
      const ref = typeof obj.ref === 'string' ? obj.ref : null;
      const kind = obj.kind === 'known' || obj.kind === 'candidate' ? obj.kind : null;
      if (!ref || !kind) return null;
      out.push({ text, ref, kind });
    } else {
      out.push({ text });
    }
  }
  return out;
}

export { norm as normalizePhrase };
