import { NextRequest, NextResponse } from 'next/server';
import {
  getPrecontextForSlug,
  getEntityBySlug,
  getEntityMentions,
  getRelatedEntities,
  getSynthesisForSlug,
  getProjectMeta,
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
import { findPossibleEvidenceConflicts } from '@/lib/ai/evidence-conflicts';
import { CursorAgentError } from '@/lib/ai/cursor-agent';
import { EngineError } from '@/lib/engine';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

// Next.js: allow up to 3 minutes for inline LLM synthesis.
export const maxDuration = 180;

function getCachedDossierForMode(slug: string, preferredProfile: string, demoMode: boolean) {
  const preferred = getSynthesisForSlug(slug, preferredProfile);
  if (preferred) {
    return {
      row: preferred,
      profile: preferredProfile === 'queued' || preferredProfile === 'queued_spanify' ? 'queued' as const : 'live' as const,
      variant: preferredProfile.endsWith('_spanify') ? 'spanify_precontext' as const : 'default' as const,
    };
  }
  if (!demoMode) return null;

  const fallbacks: Array<{
    cacheProfile: string;
    profile: 'live' | 'queued';
    variant: DossierSynthesisVariant;
  }> = [
    { cacheProfile: 'queued', profile: 'queued', variant: 'default' },
    { cacheProfile: 'live_spanify', profile: 'live', variant: 'spanify_precontext' },
    { cacheProfile: 'live', profile: 'live', variant: 'default' },
    { cacheProfile: 'queued_spanify', profile: 'queued', variant: 'spanify_precontext' },
  ];

  for (const fallback of fallbacks) {
    if (fallback.cacheProfile === preferredProfile) continue;
    const row = getSynthesisForSlug(slug, fallback.cacheProfile);
    if (row) return { row, profile: fallback.profile, variant: fallback.variant };
  }
  return null;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  return withWorkspaceRoute(req, async (ctx) => {
    const { slug } = await context.params;
    const search = req.nextUrl.searchParams;
    const profile = search.get('mode') === 'live' ? 'live' : 'queued';
    const forkSpanify = search.get('fork') === 'spanify' && profile === 'live';
    const synthesisVariant: DossierSynthesisVariant = forkSpanify
      ? 'spanify_precontext'
      : 'default';
    const cacheProfile = dossierCacheProfile(profile, synthesisVariant);
    const fromSlug = search.get('from');
    const rootSlug = search.get('root');
    const startup = getStartupStatus();
    const concept = getEntityBySlug(slug);
    if (!concept) return NextResponse.json({ error: 'Concept not found' }, { status: 404 });

    const related = getRelatedEntities(slug, 10);
    const evidence = getEntityMentions(slug, 6);
    const conflictEvidence = getEntityMentions(slug, 12);
    const possible_conflicts = findPossibleEvidenceConflicts(conflictEvidence);
    const precontext = getPrecontextForSlug(slug);
    const localProvider = getProjectMeta().engine_provider === 'local';
    const demoMode = localProvider && ctx.id === 'demo_mode';

    const cached = getCachedDossierForMode(slug, cacheProfile, demoMode);
    if (cached) {
      return NextResponse.json({
        concept,
        precontext,
        pending: false,
        profile: cached.profile,
        synthesis_variant: cached.variant,
        paragraph: cached.row.paragraph,
        generated_at: cached.row.generated_at,
        generator: cached.row.generator,
        model: cached.row.model,
        evidence,
        related,
        possible_conflicts,
      });
    }

    if (localProvider) {
      return NextResponse.json({
        blocked: true,
        concept,
        precontext,
        pending: false,
        profile,
        synthesis_variant: synthesisVariant,
        paragraph: null,
        evidence,
        related,
        possible_conflicts,
        error: {
          code: demoMode ? 'demo-mode-cache-miss' : 'api-config-required',
          message: demoMode
            ? 'Use API config with your own project materials!'
            : 'Configure Cursor CLI, OpenAI, Anthropic, or Ollama to generate dossiers for this workspace.',
        },
      });
    }

    if (!startup.ready) {
      return NextResponse.json(
        {
          blocked: true,
          concept,
          precontext,
          pending: false,
          profile,
          synthesis_variant: synthesisVariant,
          paragraph: null,
          evidence,
          related,
          possible_conflicts,
          error: {
            code: 'ontology-not-ready',
            message:
              'Startup ontology overview is not ready yet. Begin or rebuild from the start screen first.',
          },
        },
        { status: 409 }
      );
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
        possible_conflicts,
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
        possible_conflicts,
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
        possible_conflicts,
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
  return withWorkspaceRoute(req, async (ctx) => {
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
    const concept = getEntityBySlug(slug);
    if (!concept) return NextResponse.json({ error: 'Concept not found' }, { status: 404 });

    const profile =
      body.profile === 'live' || body.mode === 'live' ? ('live' as const) : ('queued' as const);
    const fromSlug = body.from ?? null;
    const rootSlug = body.root ?? null;
    const forkSpanify = body.fork === 'spanify' && profile === 'live';
    const synthesisVariant: DossierSynthesisVariant = forkSpanify
      ? 'spanify_precontext'
      : 'default';

    const related = getRelatedEntities(slug, 10);
    const evidence = getEntityMentions(slug, 6);
    const conflictEvidence = getEntityMentions(slug, 12);
    const possible_conflicts = findPossibleEvidenceConflicts(conflictEvidence);
    const localProvider = getProjectMeta().engine_provider === 'local';
    const demoMode = localProvider && ctx.id === 'demo_mode';

    const cacheProfile = dossierCacheProfile(profile, synthesisVariant);
    const cached = getCachedDossierForMode(slug, cacheProfile, demoMode);
    if (cached) {
      return NextResponse.json({
        concept,
        precontext: getPrecontextForSlug(slug),
        pending: false,
        profile: cached.profile,
        synthesis_variant: cached.variant,
        paragraph: cached.row.paragraph,
        generated_at: cached.row.generated_at,
        generator: cached.row.generator,
        model: cached.row.model,
        evidence,
        related,
        possible_conflicts,
      });
    }

    if (localProvider) {
      return NextResponse.json({
        blocked: true,
        concept,
        precontext: getPrecontextForSlug(slug),
        pending: false,
        profile,
        synthesis_variant: synthesisVariant,
        paragraph: null,
        evidence,
        related,
        possible_conflicts,
        error: {
          code: demoMode ? 'demo-mode-cache-miss' : 'api-config-required',
          message: demoMode
            ? 'Use API config with your own project materials!'
            : 'Configure Cursor CLI, OpenAI, Anthropic, or Ollama to generate dossiers for this workspace.',
        },
      });
    }

    if (!startup.ready) {
      return NextResponse.json(
        {
          blocked: true,
          concept,
          precontext: getPrecontextForSlug(slug),
          pending: false,
          profile,
          paragraph: null,
          evidence,
          related,
          possible_conflicts,
          error: {
            code: 'ontology-not-ready',
            message:
              'Startup ontology overview is not ready yet. Begin or rebuild from the start screen first.',
          },
        },
        { status: 409 }
      );
    }

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
        possible_conflicts,
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
        possible_conflicts,
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
        possible_conflicts,
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
