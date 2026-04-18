import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import { getDriftRadar } from '@/lib/db/participation';

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const url = new URL(req.url);
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Math.min(20, Math.max(1, Number(limitRaw))) : 6;
    try {
      const drift = getDriftRadar(limit);
      return NextResponse.json({ drift });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
