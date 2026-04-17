import { NextResponse } from 'next/server';
import {
  getCorpusStats,
  getProjectMeta,
  getStarterLenses,
  getStartupStatus,
} from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async (ctx) => {
    const status = getStartupStatus();
    return NextResponse.json({
      workspace: { id: ctx.id, name: ctx.name, folder_path: ctx.folder_path },
      status,
      meta: getProjectMeta(),
      stats: getCorpusStats(),
      starter_lenses: status.ready ? getStarterLenses(8) : [],
    });
  });
}
