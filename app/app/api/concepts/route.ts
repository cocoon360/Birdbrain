import { NextRequest, NextResponse } from 'next/server';
import { getOntologyConceptRows, getStartupStatus } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const url = new URL(req.url);
    const type = url.searchParams.get('type') ?? undefined;
    const limit = Number(url.searchParams.get('limit') ?? 40);
    const startup = getStartupStatus();
    const concepts = startup.ready ? getOntologyConceptRows(type || undefined, limit) : [];
    return NextResponse.json({ concepts, startup });
  });
}
