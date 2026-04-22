import { NextRequest, NextResponse } from 'next/server';
import {
  getPrecontextForSlug,
  getEntityBySlug,
  getEntityMentions,
  getRelatedEntities,
  getSynthesisForSlug,
  enqueueSynthesis,
  getStartupStatus,
  deleteSynthesisCacheForSlug,
  deletePrecontextForSlug,
} from '@/lib/db/queries';
import {
  dossierCacheProfile,
  synthesizeForSlug,
  type DossierSynthesisVariant,
} from '@/lib/ai/synthesize';
import { CursorAgentError } from '@/lib/ai/cursor-agent';
import { EngineError } from '@/lib/engine';
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
    const forkSpanify = search.get('fork') === 'spanify' && profile === 'live';
    const synthesisVariant: DossierSynthesisVariant = forkSpanify
      ? 'spanify_precontext'
      : 'default';
    const cacheProfile = dossierCacheProfile(profile, synthesisVariant);
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
    const precontext = getPrecontextForSlug(slug);

    const cached = getSynthesisForSlug(slug, cacheProfile);
    if (cached) {
      return NextResponse.json({
        concept,
        precontext,
        pending: false,
        profile,
        synthesis_variant: synthesisVariant,
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
        precontext,
        pending: true,
        pending_stage: precontext ? 'dossier' : 'precontext',
        profile,
        synthesis_variant: synthesisVariant,
        paragraph: null,
        error: null,
        evidence,
        related,
      });
    }

    try {
      const fresh = await synthesizeForSlug(slug, {
        profile,
        fromSlug,
        rootSlug,
        variant: synthesisVariant,
      });
      return NextResponse.json({
        concept,
        precontext: fresh.precontext,
        pending: false,
        profile,
        synthesis_variant: synthesisVariant,
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
        precontext,
        pending: true,
        pending_stage: precontext ? 'dossier' : 'precontext',
        profile,
        synthesis_variant: synthesisVariant,
        paragraph: null,
        error: { code, message },
        evidence,
        related,
      });
    }
  });
}

interface RegenerateBody {
  action?: string;
  profile?: string;
  mode?: string;
  from?: string | null;
  root?: string | null;
  /** When `spanify` with live profile: only re-segment precontext into spans; keep precontext cache. */
  fork?: 'spanify' | 'default';
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  return withWorkspaceRoute(req, async () => {
    const { slug } = await context.params;
    let body: RegenerateBody = {};
    try {
      body = (await req.json()) as RegenerateBody;
    } catch {
      /* empty body */
    }
    if (body.action !== 'regenerate') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

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

    const profile =
      body.profile === 'queued' || body.mode === 'queued' ? ('queued' as const) : ('live' as const);
    const fromSlug = body.from ?? null;
    const rootSlug = body.root ?? null;
    const forkSpanify = body.fork === 'spanify' && profile === 'live';
    const synthesisVariant: DossierSynthesisVariant = forkSpanify
      ? 'spanify_precontext'
      : 'default';

    const related = getRelatedEntities(slug, 10);
    const evidence = getEntityMentions(slug, 6);

    if (forkSpanify) {
      deleteSynthesisCacheForSlug(slug, 'live_spanify');
    } else {
      deletePrecontextForSlug(slug);
      deleteSynthesisCacheForSlug(slug);
    }

    if (profile === 'queued') {
      enqueueSynthesis({
        entityId: concept.id,
        contextSlug: fromSlug,
        rootSlug,
        profile: 'queued',
      });
      return NextResponse.json({
        concept,
        precontext: null,
        pending: true,
        pending_stage: 'precontext',
        profile,
        paragraph: null,
        error: null,
        evidence,
        related,
      });
    }

    try {
      const fresh = await synthesizeForSlug(slug, {
        profile: 'live',
        fromSlug,
        rootSlug,
        variant: synthesisVariant,
      });
      return NextResponse.json({
        concept,
        precontext: fresh.precontext,
        pending: false,
        profile: 'live',
        synthesis_variant: synthesisVariant,
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
        precontext: forkSpanify ? getPrecontextForSlug(slug) : null,
        pending: true,
        pending_stage: forkSpanify ? 'dossier' : 'precontext',
        profile: 'live',
        synthesis_variant: synthesisVariant,
        paragraph: null,
        error: { code, message },
        evidence,
        related,
      });
    }
  });
}

function describeError(err: unknown): { code: string; message: string; details?: string } {
  if (err instanceof CursorAgentError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof EngineError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) return { code: 'unknown', message: err.message };
  return { code: 'unknown', message: 'Unknown synthesis error' };
}
