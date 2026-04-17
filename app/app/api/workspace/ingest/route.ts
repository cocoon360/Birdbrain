import { NextRequest, NextResponse } from 'next/server';
import { getWorkspace } from '@/lib/workspaces/registry';
import { withWorkspaceId } from '@/lib/workspaces/context';
import { runIngestion } from '@/lib/ingest/ingest';

export const maxDuration = 180;

interface IngestBody {
  workspace_id: string;
  docs_path?: string;
  user_guidance?: string;
}

// Runs a markdown ingestion into the given workspace's SQLite file. The
// default docs_path is the workspace folder itself, so opening a workspace
// the first time is a "pick folder → ingest that folder" flow.
export async function POST(req: NextRequest) {
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.workspace_id) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }
  const workspace = getWorkspace(body.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'Unknown workspace' }, { status: 404 });
  }
  const docsPath = body.docs_path?.trim() || workspace.folder_path;
  const userGuidance = body.user_guidance?.trim() || undefined;

  try {
    const stats = await withWorkspaceId(workspace.id, () =>
      runIngestion(docsPath, { userGuidance })
    );
    return NextResponse.json({ ok: true, stats, docs_path: docsPath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ingestion failed' },
      { status: 500 }
    );
  }
}
