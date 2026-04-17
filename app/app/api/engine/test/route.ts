import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import { buildEngine, getEngineForWorkspace, isEngineProvider } from '@/lib/engine';

// Runs a tiny connectivity check against the provided engine config without
// persisting it. Useful for the Settings panel before the user commits a
// new provider. Falls back to the saved engine when body is empty.

interface TestBody {
  provider?: string;
  model?: string;
  endpoint?: string;
  api_key_env?: string;
}

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: TestBody = {};
    try {
      body = (await req.json()) as TestBody;
    } catch {
      // empty body -> test saved engine
    }

    const engine = body.provider && isEngineProvider(body.provider)
      ? buildEngine({
          provider: body.provider,
          model: body.model,
          endpoint: body.endpoint,
          apiKeyEnvVar: body.api_key_env,
        })
      : getEngineForWorkspace();

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
