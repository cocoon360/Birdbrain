import { NextRequest, NextResponse } from 'next/server';
import {
  claimPendingQueue,
  markQueueDone,
  markQueuePending,
  getQueueStats,
  getStartupStatus,
} from '@/lib/db/queries';
import { synthesizeForSlug } from '@/lib/ai/synthesize';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    if (!getStartupStatus().ready) {
      return NextResponse.json(
        { processed: 0, claimed: 0, queue: getQueueStats('queued'), blocked: true },
        { status: 409 }
      );
    }
    const search = req.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(3, Number(search.get('limit') ?? '1')));
    const profile = search.get('mode') === 'live' ? 'live' : 'queued';
    const claimed = claimPendingQueue(limit, profile);

    if (!claimed.length) {
      return NextResponse.json({
        processed: 0,
        claimed: 0,
        queue: getQueueStats(profile),
      });
    }

    let processed = 0;
    const errors: Array<{ slug: string; message: string }> = [];

    for (const item of claimed) {
      try {
        await synthesizeForSlug(item.slug, {
          profile: item.profile as 'live' | 'queued',
          fromSlug: item.context_slug,
          rootSlug: item.root_slug,
        });
        markQueueDone(item.entity_id, item.profile);
        processed += 1;
      } catch (err) {
        markQueuePending(item.entity_id, item.profile);
        errors.push({
          slug: item.slug,
          message: err instanceof Error ? err.message : 'Unknown queue processing error',
        });
      }
    }

    return NextResponse.json({
      processed,
      claimed: claimed.length,
      errors,
      queue: getQueueStats(profile),
    });
  });
}
