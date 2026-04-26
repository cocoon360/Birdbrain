import { NextRequest, NextResponse } from 'next/server';
import { withWorkspaceRoute } from '@/lib/workspaces/route';
import {
  hasSecretSource,
  listLocalSecretKeys,
  setLocalSecret,
} from '@/lib/engine/secrets';

// Lets the UI report which secrets exist and lets the user store one into
// the local data/secrets.json fallback. In the desktop build the
// registered resolver will intercept before we hit local storage so the
// OS keychain wins. This route never returns the secret value itself.

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async () => {
    const keys = listLocalSecretKeys();
    const statuses = keys.map((key) => ({ env_var: key, ...hasSecretSource(key) }));
    return NextResponse.json({ secrets: statuses });
  });
}

interface PutBody {
  env_var: string;
  value?: string | null;
}

export async function PUT(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: PutBody;
    try {
      body = (await req.json()) as PutBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body.env_var || typeof body.env_var !== 'string') {
      return NextResponse.json({ error: 'env_var is required' }, { status: 400 });
    }
    try {
      setLocalSecret(body.env_var, body.value ?? null);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : 'Failed to write local secret',
        },
        { status: 500 }
      );
    }
    const status = hasSecretSource(body.env_var);
    return NextResponse.json({ env_var: body.env_var, ...status });
  });
}

export async function DELETE(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    const url = new URL(req.url);
    const envVar = url.searchParams.get('env_var');
    if (!envVar) {
      return NextResponse.json({ error: 'env_var is required' }, { status: 400 });
    }
    setLocalSecret(envVar, null);
    const status = hasSecretSource(envVar);
    return NextResponse.json({ env_var: envVar, ...status });
  });
}

// POST check/status for a specific env var — single-lookup helper used by
// the settings panel to show a green check when the key is reachable.
export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: { env_var?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body
    }
    if (!body.env_var) {
      return NextResponse.json({ error: 'env_var is required' }, { status: 400 });
    }
    return NextResponse.json({ env_var: body.env_var, ...hasSecretSource(body.env_var) });
  });
}
