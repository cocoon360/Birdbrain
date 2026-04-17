import { WorkspacePicker } from '@/components/WorkspacePicker';
import { adoptLegacyWorkspace, listWorkspaces } from '@/lib/workspaces/registry';

// Root route is the workspace picker. It lists known workspaces, lets the
// user add a new folder, and sends them to /w/[workspaceId] once they open
// one. We also adopt any legacy single-DB install as a workspace so users
// upgrading from pre-workspace builds don't lose their corpus.
export const dynamic = 'force-dynamic';

export default function Home() {
  adoptLegacyWorkspace();
  const workspaces = listWorkspaces();
  return <WorkspacePicker initialWorkspaces={workspaces} />;
}
