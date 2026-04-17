import { NextRequest, NextResponse } from 'next/server';
import {
  getDocument,
  getChunksForDocument,
  getDocumentEntityMentions,
} from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withWorkspaceRoute(req, async () => {
    const { id } = await params;
    const docId = parseInt(id, 10);
    const doc = getDocument(docId);
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const chunks = getChunksForDocument(docId);
    const mentions = getDocumentEntityMentions(docId);
    return NextResponse.json({ document: doc, chunks, mentions });
  });
}
