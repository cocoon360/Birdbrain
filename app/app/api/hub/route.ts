import { NextResponse } from 'next/server';
import {
  getCorpusStats,
  getEntities,
  getProjectMeta,
  getEmergedEntities,
  getOntologyConceptRows,
  getStarterLensConcepts,
  getStartupStatus,
} from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async (ctx) => {
    const startup = getStartupStatus();
    const localConcepts = getEntities(undefined, 500);
    return NextResponse.json({
      workspace: { id: ctx.id, name: ctx.name, folder_path: ctx.folder_path },
      startup: {
        ready: startup.ready,
        stale: startup.stale,
        missing: startup.missing,
        failed: startup.failed,
        summary_text: startup.latest_run?.summary_text ?? null,
      },
      meta: getProjectMeta(),
      stats: getCorpusStats(),
      concepts: startup.ready ? getStarterLensConcepts(9) : localConcepts.slice(0, 9),
      all_concepts: startup.ready ? getOntologyConceptRows(undefined, 500) : localConcepts,
      emerged: startup.ready ? getEmergedEntities(8) : [],
    });
  });
}
