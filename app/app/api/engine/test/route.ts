import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import { getProjectMeta } from '@/lib/db/queries';
import { buildEngine, isEngineProvider, type EngineProvider } from '@/lib/engine';

// Runs a tiny connectivity check against the provided engine config without
// persisting it. Merges the request body with saved workspace meta so an
// omitted `model` field (JSON drops `undefined`) still tests the saved model.

interface TestBody {
  provider?: string;
  model?: string;
  endpoint?: string;
  api_key_env?: string;
}

function resolveEngineConfigForTest(body: TestBody) {
  const meta = getProjectMeta();
  const rawProvider = (body.provider ?? meta.engine_provider ?? 'cursor-cli').trim();
  const provider: EngineProvider = isEngineProvider(rawProvider) ? rawProvider : 'cursor-cli';

  const hasExplicitModel = typeof body.model === 'string' && body.model.trim().length > 0;
  const model = hasExplicitModel ? body.model!.trim() : meta.engine_model?.trim() || null;

  const hasExplicitEndpoint = typeof body.endpoint === 'string' && body.endpoint.trim().length > 0;
  const endpoint = hasExplicitEndpoint ? body.endpoint!.trim() : meta.engine_endpoint?.trim() || null;

  const hasExplicitKeyEnv =
    typeof body.api_key_env === 'string' && body.api_key_env.trim().length > 0;
  const apiKeyEnvVar = hasExplicitKeyEnv
    ? body.api_key_env!.trim()
    : meta.engine_api_key_env?.trim() || null;

  return { provider, model, endpoint, apiKeyEnvVar };
}

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: TestBody = {};
    try {
      body = (await req.json()) as TestBody;
    } catch {
      /* empty body — use saved meta only */
    }

    const merged = resolveEngineConfigForTest(body);
    const engine = buildEngine(merged);

    if (!engine.test) {
      return NextResponse.json({
        ok: false,
        provider: engine.provider,
        message: `${engine.provider} does not expose a test method.`,
      });
    }

    const result = await engine.test();
    return NextResponse.json({
      ok: result.ok,
      provider: engine.provider,
      model: result.model ?? engine.defaultModel,
      message: result.message,
    });
  });
}
