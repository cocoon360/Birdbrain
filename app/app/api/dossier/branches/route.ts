import { NextResponse } from 'next/server';
import { getProjectMetaValue, setProjectMetaValue } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async () => {
    const raw = getProjectMetaValue('branches_json') ?? getProjectMetaValue('demo_branches_json');
    if (!raw) return NextResponse.json({ branches: [], activeBranchId: null });
    try {
      const parsed = JSON.parse(raw) as { branches?: unknown[]; activeBranchId?: unknown };
      return NextResponse.json({
        branches: Array.isArray(parsed.branches) ? parsed.branches : [],
        activeBranchId: typeof parsed.activeBranchId === 'string' ? parsed.activeBranchId : null,
      });
    } catch {
      return NextResponse.json({ branches: [], activeBranchId: null });
    }
  });
}

export async function POST(req: Request) {
  return withWorkspaceRoute(req, async () => {
    let body: { branches?: unknown; activeBranchId?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const branches = Array.isArray(body.branches) ? body.branches : [];
    const activeBranchId = typeof body.activeBranchId === 'string' ? body.activeBranchId : null;
    setProjectMetaValue('branches_json', JSON.stringify({ branches, activeBranchId }));
    return NextResponse.json({ ok: true });
  });
}
