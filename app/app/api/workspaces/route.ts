import { NextRequest, NextResponse } from 'next/server';
import {
  addWorkspace,
  adoptLegacyWorkspace,
  listWorkspaces,
  removeWorkspace,
  renameWorkspace,
} from '@/lib/workspaces/registry';

// Workspace CRUD does not need a workspace context — it operates on the
// global registry. Legacy adoption runs on every call so the first time a
// user opens the UI after upgrading, their existing DB becomes a workspace.
export async function GET() {
  adoptLegacyWorkspace();
  return NextResponse.json({ workspaces: listWorkspaces() });
}

interface AddBody {
  folder_path: string;
  name?: string;
  db_path?: string;
}

export async function POST(req: NextRequest) {
  let body: AddBody;
  try {
    body = (await req.json()) as AddBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.folder_path || typeof body.folder_path !== 'string') {
    return NextResponse.json(
      { error: 'folder_path is required' },
      { status: 400 }
    );
  }
  try {
    const record = addWorkspace({
      folderPath: body.folder_path,
      name: body.name,
      dbPath: body.db_path,
    });
    return NextResponse.json({ workspace: record });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to add workspace' },
      { status: 400 }
    );
  }
}

interface PatchBody {
  id: string;
  name?: string;
}

export async function PATCH(req: NextRequest) {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (body.name) {
    const updated = renameWorkspace(body.id, body.name);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ workspace: updated });
  }
  return NextResponse.json({ error: 'No changes supplied' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const ok = removeWorkspace(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
