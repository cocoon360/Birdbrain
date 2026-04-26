'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panorama, type PanoramaPanel } from '@/components/Panorama';
import { DossierProvider } from '@/components/DossierContext';
import { ConceptDossier } from '@/components/ConceptDossier';
import { DocDrawer } from '@/components/DocDrawer';
import { HubPanel } from '@/components/panels/HubPanel';
import { WorkbenchPanel } from '@/components/panels/WorkbenchPanel';
import { TimelinePanel } from '@/components/panels/TimelinePanel';
import { JournalPanel } from '@/components/panels/JournalPanel';
import { StartupShell } from '@/components/StartupShell';
import { WorkspaceProvider, type WorkspaceShape } from '@/components/WorkspaceProvider';

const PANELS: PanoramaPanel[] = [
  { id: 'hub', label: 'hub', content: <HubPanel /> },
  { id: 'workbench', label: 'workbench', content: <WorkbenchPanel /> },
  { id: 'journal', label: 'journal', content: <JournalPanel /> },
  { id: 'timeline', label: 'timeline', content: <TimelinePanel /> },
];

export function WorkspaceShell({ workspace }: { workspace: WorkspaceShape }) {
  const router = useRouter();
  const [entered, setEntered] = useState(false);
  const [startupMode, setStartupMode] = useState<'automatic-cached' | 'always-fresh'>('automatic-cached');

  return (
    <WorkspaceProvider workspace={workspace}>
      <DossierProvider>
        {entered ? (
          <>
            <Panorama
              panels={PANELS}
              onBeginAgain={() => {
                setStartupMode('always-fresh');
                setEntered(false);
              }}
              workspaceName={workspace.name}
              onSwitchWorkspace={() => router.push('/')}
            />
            <ConceptDossier />
            <DocDrawer />
          </>
        ) : (
          <StartupShell
            initialMode={startupMode}
            onEnter={() => {
              setEntered(true);
              setStartupMode('automatic-cached');
            }}
            workspaceName={workspace.name}
            onSwitchWorkspace={() => router.push('/')}
          />
        )}
      </DossierProvider>
    </WorkspaceProvider>
  );
}
