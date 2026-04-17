import { NextResponse } from 'next/server';
import {
  getAlerts,
  getCorpusStats,
  getTimeline,
  getCanonDocuments,
  getProjectMeta,
  getEmergedEntities,
  getQueueStats,
  getStarterLensConcepts,
  getStartupStatus,
} from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async (ctx) => {
    const startup = getStartupStatus();
    return NextResponse.json({
      workspace: { id: ctx.id, name: ctx.name, folder_path: ctx.folder_path },
      startup,
      meta: getProjectMeta(),
      stats: getCorpusStats(),
      concepts: startup.ready ? getStarterLensConcepts(9) : [],
      emerged: startup.ready ? getEmergedEntities(8) : [],
      queue: getQueueStats('queued'),
      alerts: startup.ready ? getAlerts(8) : [],
      recent: getTimeline(10),
      canon: getCanonDocuments().slice(0, 10),
    });
  });
}
