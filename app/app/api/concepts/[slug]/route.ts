import { NextRequest, NextResponse } from 'next/server';
import { getEntityBySlug, getEntityMentions, getRelatedEntities } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  return withWorkspaceRoute(req, async () => {
    const { slug } = await context.params;
    const concept = getEntityBySlug(slug);
    if (!concept) {
      return NextResponse.json({ error: 'Concept not found' }, { status: 404 });
    }
    const mentions = getEntityMentions(slug, 20);
    const related = getRelatedEntities(slug, 8);
    return NextResponse.json({ concept, mentions, related });
  });
}
