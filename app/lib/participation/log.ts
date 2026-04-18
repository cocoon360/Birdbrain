// Client-side participation logger.
//
// Every click that counts as "attention" fires a fire-and-forget POST to
// /api/participation/event. The API writes to participation_events (see
// lib/db/participation.ts). Failures are swallowed: the Datalog panel is
// the only consumer, and stale trail is strictly better than a broken UX.
//
// Sessions: one session id per browser, stored in localStorage, rotated
// after 30 minutes of idle. Scoped to workspace so switching projects
// starts a fresh session — a reading is a reading *of* a folder.

export type ParticipationKind =
  | 'open_concept'
  | 'open_doc'
  | 'impression'
  | 'promote'
  | 'dismiss'
  | 'ask'
  | 'search'
  | 'reset'
  | 'memesis';

export interface ParticipationPayload {
  kind: ParticipationKind;
  slug?: string | null;
  fromSlug?: string | null;
  phrase?: string | null;
  docId?: number | null;
  source?: string | null;
}

const IDLE_ROLLOVER_MS = 30 * 60 * 1000;

function sessionKey(workspaceId: string | null) {
  return workspaceId
    ? `birdbrain:${workspaceId}:participation-session`
    : 'birdbrain:participation-session';
}

interface SessionCell {
  id: string;
  last_at: number;
}

function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Resolve the current session id, rotating if idle too long. Writes the new
 * cell back to localStorage so the next call is cheap. Returns null in SSR.
 */
export function getSessionId(workspaceId: string | null): string | null {
  if (typeof window === 'undefined') return null;
  const key = sessionKey(workspaceId);
  const raw = window.localStorage.getItem(key);
  const now = Date.now();
  let cell: SessionCell | null = null;
  if (raw) {
    try {
      cell = JSON.parse(raw) as SessionCell;
    } catch {
      cell = null;
    }
  }
  if (!cell || now - cell.last_at > IDLE_ROLLOVER_MS) {
    cell = { id: newSessionId(), last_at: now };
  } else {
    cell = { id: cell.id, last_at: now };
  }
  window.localStorage.setItem(key, JSON.stringify(cell));
  return cell.id;
}

/**
 * Fire-and-forget participation log. Silently noops in SSR and silently
 * swallows network failures — this is telemetry, not a transaction.
 */
export function logParticipation(
  workspaceId: string | null,
  payload: ParticipationPayload
): void {
  if (typeof window === 'undefined') return;
  const sessionId = getSessionId(workspaceId);
  if (!sessionId) return;
  const body = JSON.stringify({ sessionId, ...payload });
  try {
    // `keepalive` lets the request survive across openConcept navigations
    // that would otherwise cancel in-flight fetches.
    void fetch('/api/participation/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      cache: 'no-store',
    }).catch(() => {
      // swallow
    });
  } catch {
    // swallow
  }
}
