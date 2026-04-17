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
  return withWorkspaceRoute(req, async () => {
    const meta = getProjectMeta();
    const engine = getEngineForWorkspace();
    return NextResponse.json({
      provider: (isEngineProvider(meta.engine_provider)
        ? meta.engine_provider
        : 'cursor-cli') as EngineProvider,
      model: meta.engine_model || engine.defaultModel,
      endpoint: meta.engine_endpoint,
      api_key_env: meta.engine_api_key_env,
      default_model: engine.defaultModel,
    });
  });
}

interface PutBody {
  provider: string;
  model?: string;
  endpoint?: string;
  api_key_env?: string;
}

export async function PUT(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
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
    const next = updateWorkspaceEngineConfig({
      provider: body.provider,
      model: body.model ?? null,
      endpoint: body.endpoint ?? null,
      apiKeyEnvVar: body.api_key_env ?? null,
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
