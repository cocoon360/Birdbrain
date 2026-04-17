import { NextResponse } from 'next/server';
import { getCorpusStats } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async () => {
    const stats = getCorpusStats();
    return NextResponse.json(stats);
  });
}
