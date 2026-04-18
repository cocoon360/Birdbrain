export const STATUS_COLORS: Record<string, string> = {
  canon: '#00d68f',
  working: '#f6c90e',
  active: '#00b4d8',
  reference: '#4a90d9',
  brainstorm: '#9b59b6',
  archive: '#666666',
  unknown: '#444444',
};

export const TYPE_COLORS: Record<string, string> = {
  character: '#00b4d8',
  location: '#00d68f',
  event: '#f6c90e',
  theme: '#e74c9b',
  system: '#9b59b6',
  organization: '#4a90d9',
  concept: '#888888',
};

export const LINK_COLORS = {
  known: '#00b4d8',
  candidate: '#e74c9b',
} as const;

export const MODE_COLORS: Record<'live' | 'queued', string> = {
  live: '#00b4d8',
  queued: '#f6c90e',
};

/**
 * Human-readable names for `documents.status` (inferred from folder paths like
 * `canon/`, `working/`, etc.). Internal DB values stay unchanged; this is only
 * for UI copy so the app does not read like a fiction writers' room.
 */
export function documentStatusBadgeLabel(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s === '') return 'ALL';
  const map: Record<string, string> = {
    canon: 'PRIMARY',
    working: 'IN PROGRESS',
    active: 'ACTIVE',
    reference: 'REFERENCE',
    brainstorm: 'EXPLORATORY',
    archive: 'OLDER',
    general: 'GENERAL',
    unknown: 'OTHER',
  };
  return map[s] ?? (raw ? raw.toUpperCase() : 'OTHER');
}

/** Sentence-case label for inline helper text (not all-caps). */
export function documentStatusUiLabel(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s === '') return 'all';
  const map: Record<string, string> = {
    canon: 'primary',
    working: 'in progress',
    active: 'active',
    reference: 'reference',
    brainstorm: 'exploratory',
    archive: 'older',
    general: 'general',
    unknown: 'unclassified',
  };
  return map[s] ?? raw;
}

export const BRANCH_COLORS = {
  new: '#e74c9b',
  active: '#00b4d8',
  ready: '#00d68f',
  pending: '#f6c90e',
  idle: '#666666',
} as const;
