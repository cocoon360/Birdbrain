import { NextRequest, NextResponse } from 'next/server';
import { getTimeline } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '30', 10);
    const docs = getTimeline(limit);
    return NextResponse.json({ documents: docs });
  });
}
