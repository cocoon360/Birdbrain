import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import { getProjectMeta } from '@/lib/db/queries';
import {
  buildEngine,
  getEngineForWorkspace,
  isEngineProvider,
  updateWorkspaceEngineConfig,
  type EngineProvider,
} from '@/lib/engine';

// Reads / writes the engine config for the active workspace. Lives here
// because engine config is a workspace-scoped value stored in project_meta.

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async (ctx) => {
    const meta = getProjectMeta();
    const engine = getEngineForWorkspace();
    const provider = (isEngineProvider(meta.engine_provider)
      ? meta.engine_provider
      : 'local') as EngineProvider;
    const effectiveProvider: EngineProvider =
      provider === 'local' && ctx.id !== 'demo_mode' ? 'cursor-cli' : provider;
    const effectiveEngine =
      effectiveProvider === provider
        ? engine
        : buildEngine({
            provider: effectiveProvider,
            model: meta.engine_model || null,
            endpoint: meta.engine_endpoint || null,
            apiKeyEnvVar: meta.engine_api_key_env || null,
          });
    return NextResponse.json({
      provider: effectiveProvider,
      model: meta.engine_model || effectiveEngine.defaultModel,
      endpoint: meta.engine_endpoint,
      api_key_env: meta.engine_api_key_env,
      default_model: effectiveEngine.defaultModel,
    });
  });
}

interface PutBody {
  provider: string;
  model?: string;
  endpoint?: string;
  api_key_env?: string;
}

function cleanProviderModel(provider: EngineProvider, model: string | undefined): string | null {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === 'no-ai') return null;
  if (provider === 'local') return null;
  return trimmed;
}

export async function PUT(req: NextRequest) {
  return withWorkspaceRoute(req, async (ctx) => {
    let body: PutBody;
    try {
      body = (await req.json()) as PutBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (!isEngineProvider(body.provider)) {
      return NextResponse.json(
        { error: `Unknown provider: ${body.provider}` },
        { status: 400 }
      );
    }
    if (body.provider === 'local' && ctx.id !== 'demo_mode') {
      return NextResponse.json(
        { error: 'Demo mode is only available for the bundled Demo Mode workspace.' },
        { status: 403 }
      );
    }
    const next = updateWorkspaceEngineConfig({
      provider: body.provider,
      model: cleanProviderModel(body.provider, body.model),
      endpoint: body.provider === 'local' ? null : body.endpoint ?? null,
      apiKeyEnvVar: body.provider === 'local' ? null : body.api_key_env ?? null,
    });
    const engine = buildEngine(next);
    return NextResponse.json({
      provider: next.provider,
      model: next.model ?? engine.defaultModel,
      endpoint: next.endpoint ?? '',
      api_key_env: next.apiKeyEnvVar ?? '',
      default_model: engine.defaultModel,
    });
  });
}
