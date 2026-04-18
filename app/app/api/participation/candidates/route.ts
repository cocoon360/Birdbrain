import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import {
  listWatchingCandidates,
  markCandidateStatus,
} from '@/lib/db/participation';
import { promoteCandidate } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const url = new URL(req.url);
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Math.min(50, Math.max(1, Number(limitRaw))) : 10;
    try {
      const candidates = listWatchingCandidates(limit);
      return NextResponse.json({ candidates });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

interface PostBody {
  action: 'promote' | 'dismiss';
  slug: string;
  phrase?: string;
  contextSlug?: string | null;
}

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: PostBody;
    try {
      body = (await req.json()) as PostBody;
    } catch {
      return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
    }
    if (!body.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

    try {
      if (body.action === 'dismiss') {
        markCandidateStatus(body.slug, 'dismissed');
        return NextResponse.json({ ok: true });
      }
      if (body.action === 'promote') {
        if (!body.phrase) {
          return NextResponse.json(
            { error: 'phrase required for promote' },
            { status: 400 }
          );
        }
        const entity = promoteCandidate(body.phrase, body.contextSlug ?? null);
        markCandidateStatus(body.slug, 'promoted');
        return NextResponse.json({ ok: true, entity });
      }
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
