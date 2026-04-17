import { notFound } from 'next/navigation';
import { getWorkspace, touchWorkspace } from '@/lib/workspaces/registry';
import { WorkspaceShell } from '@/components/WorkspaceShell';

// Server entry for a specific workspace. It resolves the workspace record
// from the registry, stamps its "last opened" time, then hands the id +
// name down to the client shell which wires the fetch patch.

export const dynamic = 'force-dynamic';

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const record = getWorkspace(workspaceId);
  if (!record) notFound();
  touchWorkspace(record.id);
  return (
    <WorkspaceShell
      workspace={{
        id: record.id,
        name: record.name,
        folder_path: record.folder_path,
      }}
    />
  );
}
