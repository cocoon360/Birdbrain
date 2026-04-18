import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export type SourceKind = 'markdown' | 'text' | 'svg' | 'html' | 'code';

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
  source_kind: SourceKind;
  source_ext: string;      // lowercased file extension including the dot, e.g. '.md'
  chunks: ParsedChunk[];
}

export interface IngestableFile {
  path: string;   // absolute path
  kind: SourceKind;
  ext: string;    // lowercased, with leading dot
}

// ── File-type classification ──────────────────────────────────────────────────
//
// Tier 1.5: markdown / text / HTML / SVG always; source code is opt-in per
// workspace (`ingest_include_code` in project_meta) so a random repo checkout
// does not flood the ontology. Binary formats stay deferred.

const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdown']);
const TEXT_EXT = new Set([
  '.txt',
  '.rst',
  '.org',
  '.adoc',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv',
  '.log',
  '.ini',
  '.toml',
]);
const SVG_EXT = new Set(['.svg']);
const HTML_EXT = new Set(['.html', '.htm', '.xml']);

/** Opt-in only — see `walkIngestableFiles(..., { includeCode })`. */
const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hxx',
  '.cs',
  '.rb',
  '.php',
  '.vue',
  '.svelte',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.r',
  '.lua',
  '.dart',
  '.ex',
  '.exs',
  '.clj',
  '.cljs',
  '.hs',
  '.ml',
  '.elm',
  '.zig',
  '.v',
  '.gradle',
  '.groovy',
  '.scala',
  '.sc',
  '.fs',
  '.fsx',
]);

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.r': 'r',
  '.lua': 'lua',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.elm': 'elm',
  '.zig': 'zig',
  '.v': 'verilog',
  '.gradle': 'gradle',
  '.groovy': 'groovy',
  '.scala': 'scala',
  '.sc': 'scala',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
};

function langFromExt(ext: string): string {
  return LANG_BY_EXT[ext] ?? (ext.replace(/^\./, '') || 'text');
}

// Folders that are almost always build output, dependency caches, or VCS
// internals. We never recurse into these, regardless of the user's folder
// structure. Dot-folders are skipped separately.
const IGNORE_DIRS = new Set([
  'node_modules',
  '__pycache__',
  'venv',
  'env',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  'bundle',
  'tmp',
]);

function classifyFile(
  filename: string,
  opts: { includeCode: boolean }
): { kind: SourceKind; ext: string } | null {
  const ext = path.extname(filename).toLowerCase();
  if (MARKDOWN_EXT.has(ext)) return { kind: 'markdown', ext };
  if (TEXT_EXT.has(ext)) return { kind: 'text', ext };
  if (SVG_EXT.has(ext)) return { kind: 'svg', ext };
  if (HTML_EXT.has(ext)) return { kind: 'html', ext };
  if (opts.includeCode && CODE_EXT.has(ext)) return { kind: 'code', ext };
  return null;
}

const CODE_LINES_PER_CHUNK = 160;

function chunkSourceCode(content: string): ParsedChunk[] {
  const lines = content.split('\n');
  if (!lines.length) return [];
  const chunks: ParsedChunk[] = [];
  let chunkIndex = 0;
  for (let i = 0; i < lines.length; i += CODE_LINES_PER_CHUNK) {
    const slice = lines.slice(i, i + CODE_LINES_PER_CHUNK).join('\n').trimEnd();
    if (!slice.trim()) continue;
    chunks.push({
      heading: null,
      heading_level: 0,
      body: slice,
      chunk_index: chunkIndex++,
      word_count: countWords(slice),
    });
  }
  if (!chunks.length && content.trim()) {
    chunks.push({
      heading: null,
      heading_level: 0,
      body: content.trim(),
      chunk_index: 0,
      word_count: countWords(content),
    });
  }
  return chunks;
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
  for (let i = parts.length - 1; i >= 0; i--) {
    const clean = cleanFolderName(parts[i]);
    if (!clean) continue;
    const tokens = clean.split(/\s+/);
    if (tokens.every((t) => STATUS_TOKENS.has(t))) continue;
    return clean;
  }
  return 'general';
}

// ── Title extraction ──────────────────────────────────────────────────────────

function titleFromFilename(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractMarkdownTitle(content: string, filePath: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return titleFromFilename(filePath);
}

// ── Chunking by markdown heading ──────────────────────────────────────────────

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

// ── Plain-text chunker ────────────────────────────────────────────────────────
//
// Plain-text formats (.txt, .rst, .org, .adoc) don't have a universal heading
// convention we can rely on, so we split on blank-line runs into paragraphs
// and group them into chunks of roughly ~800 words. This keeps individual
// chunks retrieval-friendly without inventing fake headings.

function chunkPlainText(content: string): ParsedChunk[] {
  const paragraphs = content
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (!paragraphs.length) return [];

  const TARGET_WORDS = 800;
  const chunks: ParsedChunk[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;
  let index = 0;

  const flush = () => {
    if (!buffer.length) return;
    const body = buffer.join('\n\n');
    chunks.push({
      heading: null,
      heading_level: 0,
      body,
      chunk_index: index++,
      word_count: bufferWords,
    });
    buffer = [];
    bufferWords = 0;
  };

  for (const para of paragraphs) {
    const words = countWords(para);
    if (bufferWords && bufferWords + words > TARGET_WORDS) flush();
    buffer.push(para);
    bufferWords += words;
  }
  flush();
  return chunks;
}

// ── SVG content extractor ─────────────────────────────────────────────────────
//
// SVG is XML text. The parts that carry meaning for an ontology are: <title>
// (accessible name), <desc> (long description), and any <text> nodes (labels
// drawn on the canvas). We also surface the filename as implicit title. Uses
// a small regex/entity-decode pass instead of pulling in a full XML parser.

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(raw: string): string {
  return raw.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
}

function collectTagText(raw: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results: string[] = [];
  for (const match of raw.matchAll(re)) {
    const inner = match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const cleaned = decodeEntities(inner);
    if (cleaned) results.push(cleaned);
  }
  return results;
}

// ── HTML / XML content extractor ──────────────────────────────────────────────
//
// HTML is the noisiest structured text format most folders have. We strip it
// down to readable paragraphs so the existing chunker can handle it:
//   1. pull <title> (if any) for the document title
//   2. drop entire <script> / <style> / <noscript> / <template> blocks
//   3. drop comments
//   4. turn block-level open/close tags into newlines so paragraphs survive
//   5. strip the rest of the tags and decode entities
//
// Works fine on arbitrary XML too (steps 2–4 are no-ops for most XML).

function parseHtmlBody(raw: string, absPath: string): { title: string; body: string } {
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const explicitTitle = titleMatch
    ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    : '';

  let content = raw;
  content = content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  content = content.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  content = content.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  content = content.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ');
  content = content.replace(/<!--[\s\S]*?-->/g, ' ');

  // Block-level boundaries become paragraph breaks.
  content = content.replace(
    /<\/?(?:br|p|div|section|article|header|footer|nav|aside|main|h[1-6]|li|ul|ol|tr|td|th|table|thead|tbody|pre|blockquote|hr|dd|dt|dl|form|figure|figcaption)\b[^>]*>/gi,
    '\n'
  );

  content = content.replace(/<[^>]+>/g, ' ');
  content = decodeEntities(content);
  content = content
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const title = explicitTitle || titleFromFilename(absPath);
  return { title, body: content };
}

function extractSvgBody(raw: string, absPath: string): { title: string; body: string } {
  const titles = collectTagText(raw, 'title');
  const descs = collectTagText(raw, 'desc');
  const texts = collectTagText(raw, 'text');

  const displayTitle = titles[0] || titleFromFilename(absPath);
  const sections: string[] = [];
  sections.push(`SVG asset: ${path.basename(absPath)}`);
  if (titles.length) sections.push(`Title(s): ${titles.join(' · ')}`);
  if (descs.length) sections.push(`Description:\n${descs.join('\n')}`);
  if (texts.length) sections.push(`On-canvas text:\n${texts.join('\n')}`);
  if (sections.length === 1) {
    // No metadata in the SVG. We still keep a stub so the filename is
    // searchable; but the chunk will be short and filtered out by chunk-length
    // heuristics downstream unless we give it something.
    sections.push('(no embedded title, description, or text labels found)');
  }
  return { title: displayTitle, body: sections.join('\n\n') };
}

// ── Unified parser ────────────────────────────────────────────────────────────

export function parseIngestableFile(file: IngestableFile, docsRoot: string): ParsedDocument {
  const stat = fs.statSync(file.path);
  const relativePath = path.relative(docsRoot, file.path);
  const status = deriveStatus(relativePath);
  const category = deriveCategory(relativePath);
  const file_mtime = Math.floor(stat.mtimeMs / 1000);

  let title: string;
  let chunks: ParsedChunk[];
  let word_count: number;

  if (file.kind === 'markdown') {
    const raw = fs.readFileSync(file.path, 'utf-8');
    const { content } = matter(raw);
    title = extractMarkdownTitle(content, file.path);
    chunks = chunkByHeadings(content);
    word_count = countWords(content);
  } else if (file.kind === 'text') {
    const raw = fs.readFileSync(file.path, 'utf-8');
    // First non-empty line is a reasonable title guess, but fall back to the
    // filename if it's too short, too long, or mostly punctuation (which is
    // common for .json / .csv / .yaml where the first line is "{" or a header
    // row).
    const firstLine = raw.split('\n').find((l) => l.trim().length > 0)?.trim();
    const alphaNumCount = firstLine ? (firstLine.match(/[A-Za-z0-9]/g)?.length ?? 0) : 0;
    title =
      firstLine && firstLine.length < 120 && alphaNumCount >= 4
        ? firstLine.replace(/^#+\s*/, '')
        : titleFromFilename(file.path);
    chunks = chunkPlainText(raw);
    word_count = countWords(raw);
  } else if (file.kind === 'svg') {
    const raw = fs.readFileSync(file.path, 'utf-8');
    const { title: svgTitle, body } = extractSvgBody(raw, file.path);
    title = svgTitle;
    chunks = [
      {
        heading: null,
        heading_level: 0,
        body,
        chunk_index: 0,
        word_count: countWords(body),
      },
    ];
    word_count = chunks[0].word_count;
  } else if (file.kind === 'html') {
    const raw = fs.readFileSync(file.path, 'utf-8');
    const { title: htmlTitle, body } = parseHtmlBody(raw, file.path);
    title = htmlTitle;
    chunks = body ? chunkPlainText(body) : [];
    word_count = countWords(body);
    if (!chunks.length && word_count > 0) {
      // Short HTML page with no paragraph breaks — keep it as a single chunk
      // instead of dropping the whole document.
      chunks = [
        {
          heading: null,
          heading_level: 0,
          body,
          chunk_index: 0,
          word_count,
        },
      ];
    }
  } else {
    // code (opt-in extensions)
    const raw = fs.readFileSync(file.path, 'utf-8');
    const lang = langFromExt(file.ext);
    title = titleFromFilename(file.path);
    const header = `Source file: ${path.basename(file.path)} (language: ${lang})\n\n`;
    let bodyChunks = chunkSourceCode(raw);
    if (!bodyChunks.length) {
      bodyChunks = [
        {
          heading: null,
          heading_level: 0,
          body: '(empty source file)',
          chunk_index: 0,
          word_count: 2,
        },
      ];
    }
    chunks = bodyChunks.map((c, i) => ({
      ...c,
      chunk_index: i,
      body: i === 0 ? `${header}${c.body}` : c.body,
      word_count: countWords(i === 0 ? `${header}${c.body}` : c.body),
    }));
    word_count = countWords(raw);
  }

  return {
    file_path: relativePath,
    abs_path: file.path,
    title,
    status,
    category,
    word_count,
    file_mtime,
    source_kind: file.kind,
    source_ext: file.ext,
    chunks,
  };
}

// Backward-compatible wrapper for the one legacy caller that still uses the
// markdown-only shape.
export function parseMarkdownFile(absPath: string, docsRoot: string): ParsedDocument {
  return parseIngestableFile(
    { path: absPath, kind: 'markdown', ext: path.extname(absPath).toLowerCase() },
    docsRoot
  );
}

// ── Directory walker ──────────────────────────────────────────────────────────

export interface WalkIngestableOptions {
  /** When true, also collect common source-code extensions (see CODE_EXT). */
  includeCode?: boolean;
}

export function walkIngestableFiles(dir: string, options: WalkIngestableOptions = {}): IngestableFile[] {
  const includeCode = Boolean(options.includeCode);
  const results: IngestableFile[] = [];
  function walk(current: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        const classified = classifyFile(entry.name, { includeCode });
        if (classified) {
          results.push({ path: full, kind: classified.kind, ext: classified.ext });
        }
      }
    }
  }
  walk(dir);
  return results;
}

// Kept as a legacy alias for places that still expect only markdown paths.
export function walkMarkdownFiles(dir: string): string[] {
  return walkIngestableFiles(dir)
    .filter((f) => f.kind === 'markdown')
    .map((f) => f.path);
}
