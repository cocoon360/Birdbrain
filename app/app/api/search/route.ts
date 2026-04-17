import { NextRequest, NextResponse } from 'next/server';
import { searchChunks } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const q = req.nextUrl.searchParams.get('q');
    const status = req.nextUrl.searchParams.get('status') ?? undefined;
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10);
    if (!q || q.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }
    try {
      const results = searchChunks(q.trim(), limit, status);
      return NextResponse.json({ results });
    } catch (err) {
      console.error('Search error:', err);
      return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 });
    }
  });
}
