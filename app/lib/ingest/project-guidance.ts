import fs from 'fs';
import path from 'path';

export interface ProjectGuidance {
  source_files: string[];
  prioritize_terms: string[];
  ignore_terms: string[];
  preferred_types: string[];
  notes: string;
}

const GUIDANCE_NAME_PATTERNS = [
  /^birdbrain[-_ ]?(guidance|context)\.(md|txt)$/i,
  /^project[-_ ]?(guidance|context)\.(md|txt)$/i,
  /^(glossary|ontology)\.(md|txt)$/i,
];

const TYPE_HINTS = [
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
];

export function splitGuidanceFiles(files: string[], docsRoot: string) {
  const guidance = files.filter((file) => isGuidanceFile(file, docsRoot));
  const content = files.filter((file) => !guidance.includes(file));
  return { guidance, content };
}

export function loadProjectGuidance(files: string[], docsRoot: string): ProjectGuidance {
  const relativeFiles = files.map((file) => path.relative(docsRoot, file));
  const notes: string[] = [];
  const prioritize = new Set<string>();
  const ignore = new Set<string>();
  const preferredTypes = new Set<string>();

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    notes.push(raw.trim());
    harvestTerms(raw, /(prioritize|priority|include|focus)/i, prioritize);
    harvestTerms(raw, /(ignore|exclude|avoid|de[- ]emphasize)/i, ignore);
    for (const hint of TYPE_HINTS) {
      if (new RegExp(`\\b${hint}s?\\b`, 'i').test(raw)) preferredTypes.add(hint);
    }
  }

  return {
    source_files: relativeFiles,
    prioritize_terms: Array.from(prioritize),
    ignore_terms: Array.from(ignore),
    preferred_types: Array.from(preferredTypes),
    notes: notes.join('\n\n').trim(),
  };
}

function isGuidanceFile(absPath: string, docsRoot: string) {
  const rel = path.relative(docsRoot, absPath).replace(/\\/g, '/');
  const depth = rel.split('/').length;
  if (depth > 2) return false;
  const base = path.basename(absPath);
  return GUIDANCE_NAME_PATTERNS.some((pattern) => pattern.test(base));
}

function harvestTerms(raw: string, headingMatch: RegExp, out: Set<string>) {
  const lines = raw.split('\n');
  let active = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      active = headingMatch.test(heading[1]);
      continue;
    }
    if (!active) {
      const inline = line.match(/^(prioritize|priority|include|focus|ignore|exclude|avoid)\s*:\s*(.+)$/i);
      if (inline) {
        for (const term of splitTerms(inline[2])) out.add(term);
      }
      continue;
    }
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const source = bullet ? bullet[1] : line;
    for (const term of splitTerms(source)) out.add(term);
  }
}

function splitTerms(source: string) {
  return source
    .split(/[,;/]| and /i)
    .map((term) => term.trim().replace(/^["'`]+|["'`]+$/g, ''))
    .filter((term) => term.length >= 2);
}
