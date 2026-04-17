import { NextRequest, NextResponse } from 'next/server';
import { promoteCandidate, getSynthesisForSlug, getStartupStatus } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

interface QueueBody {
  phrase: string;
  contextSlug?: string;
}

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: QueueBody;
    try {
      body = (await req.json()) as QueueBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body.phrase || !body.phrase.trim()) {
      return NextResponse.json({ error: 'phrase required' }, { status: 400 });
    }
    if (!getStartupStatus().ready) {
      return NextResponse.json(
        { error: 'Startup ontology overview is not ready yet.' },
        { status: 409 }
      );
    }

    try {
      const entity = promoteCandidate(body.phrase, body.contextSlug ?? null);
      const hasSynthesis =
        Boolean(getSynthesisForSlug(entity.slug, 'live')) ||
        Boolean(getSynthesisForSlug(entity.slug, 'queued'));
      return NextResponse.json({
        slug: entity.slug,
        name: entity.name,
        type: entity.type,
        has_synthesis: hasSynthesis,
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
