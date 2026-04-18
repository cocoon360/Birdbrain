import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import { synthesizeSession } from '@/lib/ai/memesis';
import {
  getLatestSessionSynthesis,
  getEventCountForSession,
} from '@/lib/db/participation';
import { EngineError } from '@/lib/engine';

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }
    try {
      const cached = getLatestSessionSynthesis(sessionId);
      const eventCount = getEventCountForSession(sessionId);
      return NextResponse.json({ paragraph: cached, eventCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

interface PostBody {
  sessionId: string;
  force?: boolean;
}

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: PostBody;
    try {
      body = (await req.json()) as PostBody;
    } catch {
      return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
    }
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }
    try {
      const result = await synthesizeSession(body.sessionId, { force: !!body.force });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof EngineError) {
        return NextResponse.json(
          { error: err.code, message: err.message, detail: err.details },
          { status: 502 }
        );
      }
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
