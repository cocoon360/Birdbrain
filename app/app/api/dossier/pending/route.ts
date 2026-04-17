import { NextResponse } from 'next/server';
import { getPendingQueue } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async () => {
    const url = new URL(req.url);
    const profile = url.searchParams.get('mode') === 'live' ? 'live' : 'queued';
    return NextResponse.json({ pending: getPendingQueue(100, profile), profile });
  });
}
