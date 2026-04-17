import { NextRequest, NextResponse } from 'next/server';
import {
  getEntityBySlug,
  getEntityMentions,
  getRelatedEntities,
  getSynthesisForSlug,
  enqueueSynthesis,
  getStartupStatus,
} from '@/lib/db/queries';
import { synthesizeForSlug } from '@/lib/ai/synthesize';
import { CursorAgentError } from '@/lib/ai/cursor-agent';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

// Next.js: allow up to 3 minutes for inline LLM synthesis.
export const maxDuration = 180;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  return withWorkspaceRoute(req, async () => {
    const { slug } = await context.params;
    const search = req.nextUrl.searchParams;
    const profile = search.get('mode') === 'queued' ? 'queued' : 'live';
    const fromSlug = search.get('from');
    const rootSlug = search.get('root');
    const startup = getStartupStatus();
    if (!startup.ready) {
      return NextResponse.json(
        {
          blocked: true,
          error: {
            code: 'ontology-not-ready',
            message:
              'Startup ontology overview is not ready yet. Begin or rebuild from the start screen first.',
          },
        },
        { status: 409 }
      );
    }
    const concept = getEntityBySlug(slug);
    if (!concept) return NextResponse.json({ error: 'Concept not found' }, { status: 404 });

    const related = getRelatedEntities(slug, 10);
    const evidence = getEntityMentions(slug, 6);

    const cached = getSynthesisForSlug(slug, profile);
    if (cached) {
      return NextResponse.json({
        concept,
        pending: false,
        profile,
        paragraph: cached.paragraph,
        generated_at: cached.generated_at,
        generator: cached.generator,
        model: cached.model,
        evidence,
        related,
      });
    }

    if (profile === 'queued') {
      enqueueSynthesis({
        entityId: concept.id,
        contextSlug: fromSlug ?? null,
        rootSlug: rootSlug ?? null,
        profile,
      });
      return NextResponse.json({
        concept,
        pending: true,
        profile,
        paragraph: null,
        error: null,
        evidence,
        related,
      });
    }

    try {
      const fresh = await synthesizeForSlug(slug, { profile, fromSlug, rootSlug });
      return NextResponse.json({
        concept,
        pending: false,
        profile,
        paragraph: fresh.paragraph,
        generated_at: Math.floor(Date.now() / 1000),
        generator: fresh.generator,
        model: fresh.model,
        evidence,
        related,
      });
    } catch (err) {
      const { code, message } = describeError(err);
      return NextResponse.json({
        concept,
        pending: true,
        profile,
        paragraph: null,
        error: { code, message },
        evidence,
        related,
      });
    }
  });
}

function describeError(err: unknown): { code: string; message: string } {
  if (err instanceof CursorAgentError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) return { code: 'unknown', message: err.message };
  return { code: 'unknown', message: 'Unknown synthesis error' };
}
