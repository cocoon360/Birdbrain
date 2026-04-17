import { NextResponse } from 'next/server';
import { getAlerts } from '@/lib/db/queries';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

export async function GET(req: Request) {
  return withWorkspaceRoute(req, async () => {
    return NextResponse.json({ alerts: getAlerts(12) });
  });
}
