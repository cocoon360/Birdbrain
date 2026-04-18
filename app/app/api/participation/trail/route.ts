import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import { getTrail } from '@/lib/db/participation';

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId');
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw))) : 40;
    try {
      const trail = getTrail({ sessionId, limit });
      return NextResponse.json({ trail });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
