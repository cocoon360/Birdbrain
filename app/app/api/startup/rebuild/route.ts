import { NextRequest, NextResponse } from 'next/server';
import { ensureOntologyReady, rebuildOntology } from '@/lib/ontology/startup';
import { getStartupStatus } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    let body: { mode?: 'automatic-cached' | 'always-fresh' | 'manual'; force?: boolean } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // allow empty body
    }
    const mode = body.mode ?? 'automatic-cached';
    try {
      if (body.force || mode === 'manual') {
        const result = await rebuildOntology(mode);
        return NextResponse.json({ ok: true, rebuilt: true, result, status: getStartupStatus() });
      }
      const status = await ensureOntologyReady(mode);
      return NextResponse.json({ ok: true, rebuilt: status.ready, status });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : 'Ontology rebuild failed',
          status: getStartupStatus(),
        },
        { status: 500 }
      );
    }
  });
}
