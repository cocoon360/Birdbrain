import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface ParsedChunk {
  heading: string | null;
  heading_level: number;
  body: string;
  chunk_index: number;
  word_count: number;
}

export interface ParsedDocument {
  file_path: string;       // relative to docs root
  abs_path: string;        // absolute
  title: string;
  status: string;
  category: string;
  word_count: number;
  file_mtime: number;      // unix seconds
  chunks: ParsedChunk[];
}

// ── Status + category from path ───────────────────────────────────────────────
//
// Generic, convention-based derivation. The engine knows nothing about any
// specific project — it recognizes common folder-name tokens ("canon",
// "working", "archive", "brainstorm", "reference") and classifies accordingly.
// Category is derived from the most specific non-status folder in the path,
// stripped of numeric/underscore prefixes ("02_CHARACTER_WORK" → "character work").

const STATUS_PATTERNS: Array<{ status: string; match: RegExp }> = [
  { status: 'canon', match: /(^|\/)([0-9_]*canon)(\/|$)/i },
  { status: 'working', match: /(^|\/)([0-9_]*working)(\/|$)/i },
  { status: 'archive', match: /(^|\/)([0-9_]*archive)(\/|$)/i },
  { status: 'brainstorm', match: /(^|\/)([0-9_]*(brainstorm|scenario[-_ ]?ideas?|drafts?|experiments?))(\/|$)/i },
  { status: 'reference', match: /(^|\/)([0-9_]*reference)(\/|$)/i },
  { status: 'active', match: /(^|\/)(_?active)(\/|$)/i },
];

const STATUS_TOKENS = new Set([
  'canon',
  'working',
  'archive',
  'brainstorm',
  'reference',
  'active',
  'scenario',
  'ideas',
  'drafts',
]);

function cleanFolderName(name: string): string {
  // Strip leading numeric/underscore prefixes like "02_" or "_".
  return name.replace(/^[_\d]+/, '').replace(/[_-]+/g, ' ').trim().toLowerCase();
}

export function deriveStatus(filePath: string): string {
  const p = filePath.replace(/\\/g, '/').toLowerCase();
  for (const { status, match } of STATUS_PATTERNS) {
    if (match.test(p)) return status;
  }
  return 'general';
}

export function deriveCategory(filePath: string): string {
  const p = filePath.replace(/\\/g, '/');
  const parts = p.split('/').slice(0, -1); // drop filename
  // Walk from deepest folder outward and pick the first non-status folder.
  for (let i = parts.length - 1; i >= 0; i--) {
    const clean = cleanFolderName(parts[i]);
    if (!clean) continue;
    const tokens = clean.split(/\s+/);
    // Skip folders that are only status words.
    if (tokens.every((t) => STATUS_TOKENS.has(t))) continue;
    return clean;
  }
  return 'general';
}

// ── Title extraction ──────────────────────────────────────────────────────────

function extractTitle(content: string, filePath: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Chunking by heading ───────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function chunkByHeadings(content: string): ParsedChunk[] {
  const lines = content.split('\n');
  const chunks: ParsedChunk[] = [];
  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentLines: string[] = [];
  let chunkIndex = 0;

  function flush() {
    const body = currentLines.join('\n').trim();
    if (body.length > 10) {
      chunks.push({
        heading: currentHeading,
        heading_level: currentLevel,
        body,
        chunk_index: chunkIndex++,
        word_count: countWords(body),
      });
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return chunks;
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseMarkdownFile(absPath: string, docsRoot: string): ParsedDocument {
  const raw = fs.readFileSync(absPath, 'utf-8');
  const { content } = matter(raw);
  const stat = fs.statSync(absPath);
  const relativePath = path.relative(docsRoot, absPath);

  const title = extractTitle(content, absPath);
  const status = deriveStatus(relativePath);
  const category = deriveCategory(relativePath);
  const chunks = chunkByHeadings(content);
  const word_count = countWords(content);
  const file_mtime = Math.floor(stat.mtimeMs / 1000);

  return {
    file_path: relativePath,
    abs_path: absPath,
    title,
    status,
    category,
    word_count,
    file_mtime,
    chunks,
  };
}

// ── Walk directory ────────────────────────────────────────────────────────────

export function walkMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip dot-folders, build/dependency folders, and known non-content
        // asset folders. Project-specific exclusions can live in an optional
        // .birdbrainignore file later; this baseline keeps the engine generic.
        if (entry.name.startsWith('.')) continue;
        if (['node_modules', '__pycache__', 'dist', 'build', 'assets', 'textures', 'modeling', 'scripts'].includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}
