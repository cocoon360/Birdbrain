import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import {
  insertEvent,
  recordCandidate,
  type EventKind,
} from '@/lib/db/participation';

interface EventBody {
  sessionId: string;
  kind: EventKind;
  slug?: string | null;
  fromSlug?: string | null;
  phrase?: string | null;
  docId?: number | null;
  source?: string | null;
}

const ALLOWED_KINDS: EventKind[] = [
  'open_concept',
  'open_doc',
  'impression',
  'promote',
  'dismiss',
  'ask',
  'search',
  'reset',
  'memesis',
];

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: EventBody;
    try {
      body = (await req.json()) as EventBody;
    } catch {
      return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
    }
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }
    if (!ALLOWED_KINDS.includes(body.kind)) {
      return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
    }

    try {
      const event = insertEvent({
        sessionId: body.sessionId,
        kind: body.kind,
        slug: body.slug,
        fromSlug: body.fromSlug,
        phrase: body.phrase,
        docId: body.docId,
        source: body.source,
      });

      // Candidate bookkeeping is a side effect of impression/promote/dismiss
      // events, not a separate API contract. Keeps clients from having to
      // know about two endpoints.
      if (body.phrase) {
        if (body.kind === 'impression') {
          recordCandidate({
            phrase: body.phrase,
            sessionId: body.sessionId,
            contextSlug: body.fromSlug ?? null,
            kind: 'impression',
          });
        } else if (body.kind === 'promote') {
          recordCandidate({
            phrase: body.phrase,
            sessionId: body.sessionId,
            contextSlug: body.fromSlug ?? null,
            kind: 'click',
          });
        }
      }

      return NextResponse.json({ ok: true, event });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
