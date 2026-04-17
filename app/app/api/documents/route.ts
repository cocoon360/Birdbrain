import { NextRequest, NextResponse } from 'next/server';
import { getAllDocuments, getCanonDocuments } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const status = req.nextUrl.searchParams.get('status') ?? undefined;
    const canon = req.nextUrl.searchParams.get('canon') === 'true';
    const docs = canon ? getCanonDocuments() : getAllDocuments(status);
    return NextResponse.json({ documents: docs });
  });
}
