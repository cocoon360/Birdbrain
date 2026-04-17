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

export const BRANCH_COLORS = {
  new: '#e74c9b',
  active: '#00b4d8',
  ready: '#00d68f',
  pending: '#f6c90e',
  idle: '#666666',
} as const;
