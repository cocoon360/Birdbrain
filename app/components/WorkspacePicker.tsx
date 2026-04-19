'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isTauri, openWorkspaceWindow, pickFolderNative } from '@/lib/desktop/tauri-bridge';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import { RobotBirdLogo } from './RobotBirdLogo';

interface WorkspaceRecord {
  id: string;
  name: string;
  folder_path: string;
  db_path: string;
  created_at: number;
  last_opened_at: number | null;
}

interface IngestStats {
  total: number;
  added: number;
  updated: number;
  removed: number;
  by_kind?: { markdown: number; text: number; svg: number; html: number; code?: number };
}

type IngestPhase =
  | { kind: 'idle' }
  | { kind: 'registering'; folder: string }
  | { kind: 'ingesting'; folder: string }
  | { kind: 'empty'; folder: string; workspaceId: string }
  | { kind: 'error'; folder: string; message: string };

type OpenMode = 'last-opened' | 'fresh-ingest' | 'pick-folder';

const INCLUDE_CODE_LS = 'birdbrain:include-code';

const OPEN_MODE_COPY: Record<OpenMode, { title: string; description: string }> = {
  'last-opened': {
    title: 'Pick up where you left off',
    description: 'Open the most recent workspace with its cached ontology. Fastest way to resume.',
  },
  'fresh-ingest': {
    title: 'Re-ingest and rebuild',
    description: 'Re-scan the selected folder for new or changed files, then open it. Use after heavy edits.',
  },
  'pick-folder': {
    title: 'Begin a new project',
    description: 'Add a brand-new folder as a workspace and build its ontology from scratch.',
  },
};

export function WorkspacePicker({
  initialWorkspaces,
}: {
  initialWorkspaces: WorkspaceRecord[];
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>(initialWorkspaces);
  const [folderInput, setFolderInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [hasNative, setHasNative] = useState(false);
  const [openMode, setOpenMode] = useState<OpenMode>('last-opened');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [phase, setPhase] = useState<IngestPhase>({ kind: 'idle' });
  const [includeCode, setIncludeCode] = useState(false);

  useEffect(() => {
    setHasNative(isTauri());
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem(INCLUDE_CODE_LS);
      if (v === '1' || v === 'true') setIncludeCode(true);
    } catch {
      /* ignore */
    }
  }, []);

  function persistIncludeCode(next: boolean) {
    setIncludeCode(next);
    try {
      localStorage.setItem(INCLUDE_CODE_LS, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  const sorted = useMemo(
    () => [...workspaces].sort((a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0)),
    [workspaces]
  );
  const mostRecent = sorted[0] ?? null;

  useEffect(() => {
    if (!mostRecent && openMode === 'last-opened') {
      setOpenMode('pick-folder');
    }
  }, [mostRecent, openMode]);

  async function refreshWorkspaces() {
    const res = await fetch('/api/workspaces', { cache: 'no-store' });
    if (res.ok) {
      const json = (await res.json()) as { workspaces: WorkspaceRecord[] };
      setWorkspaces(json.workspaces);
    }
  }

  async function beginAgain() {
    if (openMode === 'last-opened' && mostRecent) {
      await openWorkspace(mostRecent, { ingestFirst: false });
      return;
    }
    if (openMode === 'fresh-ingest' && mostRecent) {
      await openWorkspace(mostRecent, { ingestFirst: true });
      return;
    }
    await addWorkspace();
  }

  async function addWorkspace(override?: { folder?: string; name?: string; guidance?: string }) {
    const folder = (override?.folder ?? folderInput).trim();
    const name = (override?.name ?? nameInput).trim();
    const userGuidance = (override?.guidance ?? '').trim();
    if (!folder) {
      setMessage('Pick or paste a folder path before adding.');
      return;
    }
    setBusyId('__new__');
    setMessage('');
    setPhase({ kind: 'registering', folder });
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: folder, name: name || undefined }),
      });
      const json = (await res.json()) as { workspace?: WorkspaceRecord; error?: string };
      if (!res.ok || !json.workspace) {
        setPhase({
          kind: 'error',
          folder,
          message: json.error ?? 'Could not add workspace.',
        });
        return;
      }
      setFolderInput('');
      setNameInput('');
      await refreshWorkspaces();
      await openWorkspace(json.workspace, { ingestFirst: true, userGuidance, includeCode });
    } finally {
      setBusyId(null);
    }
  }

  async function openWorkspace(
    ws: WorkspaceRecord,
    {
      ingestFirst,
      userGuidance,
      includeCode: includeCodeOverride,
    }: { ingestFirst: boolean; userGuidance?: string; includeCode?: boolean }
  ) {
    const ingestIncludeCode = includeCodeOverride ?? includeCode;
    setBusyId(ws.id);
    setMessage('');
    try {
      if (ingestFirst) {
        setPhase({ kind: 'ingesting', folder: ws.folder_path });
        const res = await fetch('/api/workspace/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: ws.id,
            docs_path: ws.folder_path,
            user_guidance: userGuidance?.trim() || undefined,
            include_code: ingestIncludeCode,
          }),
        });
        const json = (await res.json()) as { error?: string; stats?: IngestStats };
        if (!res.ok) {
          setPhase({
            kind: 'error',
            folder: ws.folder_path,
            message: json.error ?? 'Ingestion failed.',
          });
          return;
        }
        const stats = json.stats ?? {
          total: 0,
          added: 0,
          updated: 0,
          removed: 0,
          by_kind: { markdown: 0, text: 0, svg: 0, html: 0, code: 0 },
        };
        if (stats.total === 0) {
          setPhase({ kind: 'empty', folder: ws.folder_path, workspaceId: ws.id });
          return;
        }
        // Go straight to the workspace. A delayed auto-enter in the modal was
        // unreliable in the desktop shell (effect cleanups cancelled navigation).
        setPhase({ kind: 'idle' });
        router.push(`/w/${encodeURIComponent(ws.id)}`);
        return;
      }
      router.push(`/w/${encodeURIComponent(ws.id)}`);
    } finally {
      setBusyId(null);
    }
  }

  const enterWorkspace = useCallback(
    (workspaceId: string) => {
      setPhase({ kind: 'idle' });
      router.push(`/w/${encodeURIComponent(workspaceId)}`);
    },
    [router]
  );

  async function removeWorkspace(ws: WorkspaceRecord) {
    if (!confirm(`Remove ${ws.name} from the picker? (The folder and DB file are not deleted.)`)) {
      return;
    }
    await fetch(`/api/workspaces?id=${encodeURIComponent(ws.id)}`, { method: 'DELETE' });
    await refreshWorkspaces();
  }

  const busy = busyId !== null;
  const canBeginAgain =
    (openMode === 'last-opened' && Boolean(mostRecent)) ||
    (openMode === 'fresh-ingest' && Boolean(mostRecent)) ||
    (openMode === 'pick-folder' && folderInput.trim().length > 0);

  return (
    <div
      style={{
        minHeight: '100vh',
        maxHeight: '100vh',
        width: '100vw',
        background: '#0a0a0a',
        color: '#f0f0f0',
        display: 'flex',
        alignItems: 'stretch',
        overflowY: 'auto',
      }}
      className="thin-scrollbar"
    >
      <div style={{ width: '58%', padding: '48px 56px', borderRight: '1px solid #151515' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <RobotBirdLogo size={36} />
          <div
            style={{
              fontSize: '0.7rem',
              color: '#00b4d8',
              letterSpacing: '0.22em',
              fontWeight: 700,
            }}
          >
            BIRD BRAIN · PROJECTS
          </div>
        </div>
        <h1
          style={{
            fontSize: '3.4rem',
            lineHeight: 1,
            fontWeight: 200,
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          begin again
        </h1>
        <p
          style={{
            marginTop: 18,
            fontSize: '0.95rem',
            color: '#aaa',
            lineHeight: 1.65,
            maxWidth: 640,
          }}
        >
          Bird Brain takes a project folder and uses generative hypertext trees to turn abstract,
          scattered concepts into approachable, workable ideas. All project info and generated content stays on your machine. Bird Brain ingests it, builds the overview, and drops you into the panorama.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 14,
            marginTop: 28,
          }}
        >
          <PurposeCard
            title="For Builders"
            body="Clarify what matters now, what changed, and which concepts deserve active attention."
          />
          <PurposeCard
            title="For Newcomers"
            body="Define ideas plainly before assuming any internal shorthand or prior familiarity."
          />
          <PurposeCard
            title="For Product"
            body="Turn a messy project folder into interactive, navigable understanding."
          />
        </div>

        <div style={{ marginTop: 28 }}>
          <div
            style={{
              fontSize: '0.62rem',
              color: '#666',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            open mode
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {(Object.keys(OPEN_MODE_COPY) as OpenMode[]).map((key) => {
              const disabled =
                (key === 'last-opened' || key === 'fresh-ingest') && !mostRecent;
              return (
                <button
                  key={key}
                  onClick={() => !disabled && setOpenMode(key)}
                  disabled={disabled}
                  style={{
                    textAlign: 'left',
                    background: openMode === key ? '#101d21' : '#0f0f0f',
                    border: `1px solid ${openMode === key ? '#00b4d8' : '#1c1c1c'}`,
                    padding: '14px 16px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    color: '#ddd',
                    opacity: disabled ? 0.45 : 1,
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.82rem',
                      color: openMode === key ? '#00b4d8' : '#f0f0f0',
                      marginBottom: 6,
                    }}
                  >
                    {OPEN_MODE_COPY[key].title}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#888', lineHeight: 1.5 }}>
                    {OPEN_MODE_COPY[key].description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {openMode === 'pick-folder' && (
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                fontSize: '0.62rem',
                color: '#666',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              folder to ingest
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="/absolute/path/to/folder"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={async () => {
                    setMessage('');
                    try {
                      if (hasNative) {
                        const picked = await pickFolderNative();
                        if (picked) {
                          setFolderInput(picked.path);
                          if (!nameInput) setNameInput(picked.name);
                        } else {
                          setMessage(
                            'No folder was chosen. If the dialog did not appear, use “browse here”.'
                          );
                        }
                      } else {
                        setBrowserOpen(true);
                      }
                    } catch (err) {
                      setMessage(
                        err instanceof Error ? err.message : 'Native folder picker failed.'
                      );
                    }
                  }}
                  style={secondaryButtonStyle(false)}
                >
                  {hasNative ? 'system dialog' : 'browse'}
                </button>
                {hasNative && (
                  <button
                    type="button"
                    onClick={() => {
                      setMessage('');
                      setBrowserOpen(true);
                    }}
                    style={secondaryButtonStyle(false)}
                    title="Pick a folder using the in-app file tree (same as the web build)."
                  >
                    browse here
                  </button>
                )}
              </div>
            </div>
            <input
              type="text"
              placeholder="name (optional)"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              style={{ ...inputStyle, marginTop: 10 }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
                marginTop: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', flex: 1 }}>
                <div style={{ fontSize: '0.66rem', color: '#555', lineHeight: 1.45 }}>
                  {hasNative
                    ? 'System dialog or in-app tree, or paste a path.'
                    : 'Browse your home folder, or paste a path.'}
                  {' · '}
                  <span title="Readable: .md .txt .rst .org .adoc .json .yaml .csv .log .toml .ini .html .htm .xml .svg. Binaries, PDFs, images, videos, and dot-folders always skipped. Nothing in your folder is copied or modified.">
                    md + txt + html + svg only
                  </span>
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    fontSize: '0.66rem',
                    color: '#888',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeCode}
                    onChange={(e) => persistIncludeCode(e.target.checked)}
                  />
                  <span title="Also ingest .ts, .py, .rs, .go, .java, .cpp, etc. Still skips node_modules and build folders.">
                    include source code
                  </span>
                </label>
              </div>
              <button
                onClick={beginAgain}
                disabled={!canBeginAgain || busy}
                style={{
                  background: canBeginAgain ? '#00d68f' : '#1a1a1a',
                  color: canBeginAgain ? '#041015' : '#666',
                  border: 'none',
                  padding: '10px 18px',
                  cursor: !canBeginAgain || busy ? 'not-allowed' : 'pointer',
                  fontSize: '0.68rem',
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  opacity: busy ? 0.7 : 1,
                  flexShrink: 0,
                }}
              >
                {busy ? 'working…' : 'begin'}
              </button>
            </div>
            {message && (
              <div style={{ marginTop: 8, fontSize: '0.7rem', color: '#888' }}>{message}</div>
            )}
          </div>
        )}

        {openMode !== 'pick-folder' && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 18,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={beginAgain}
              disabled={!canBeginAgain || busy}
              style={{
                background: canBeginAgain ? '#00d68f' : '#1a1a1a',
                color: canBeginAgain ? '#041015' : '#666',
                border: 'none',
                padding: '10px 18px',
                cursor: !canBeginAgain || busy ? 'not-allowed' : 'pointer',
                fontSize: '0.68rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'working…' : openMode === 'fresh-ingest' ? 're-ingest' : 'open'}
            </button>
            {message && <span style={{ fontSize: '0.74rem', color: '#888' }}>{message}</span>}
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          padding: '48px',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontSize: '0.6rem',
            color: '#00d68f',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 700,
            marginBottom: 14,
          }}
        >
          {sorted.length === 0
            ? 'no workspaces yet'
            : `${sorted.length} workspace${sorted.length === 1 ? '' : 's'}`}
        </div>

        {sorted.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: '#777', lineHeight: 1.7, maxWidth: 460 }}>
            Pick "begin a new project" on the left and point at a folder of readable documents
            (markdown, text, HTML, or SVG). Bird Brain will register it, ingest every file inside,
            and drop you into the ontology startup screen.
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              overflowY: 'auto',
              paddingRight: 6,
            }}
            className="thin-scrollbar"
          >
            {sorted.map((ws, i) => (
              <div
                key={ws.id}
                style={{
                  background: '#0f0f0f',
                  border: `1px solid ${i === 0 ? '#1b3b42' : '#181818'}`,
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: '1rem', color: '#eee' }}>{ws.name}</div>
                  <div
                    style={{
                      fontSize: '0.62rem',
                      color: i === 0 ? '#00b4d8' : '#555',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                    }}
                  >
                    {i === 0 ? `most recent · ${formatAgo(ws.last_opened_at)}` : formatAgo(ws.last_opened_at)}
                  </div>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#888', wordBreak: 'break-all' }}>
                  {ws.folder_path}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => openWorkspace(ws, { ingestFirst: false })}
                    disabled={busyId === ws.id}
                    style={primaryButtonStyle(busyId === ws.id)}
                  >
                    {busyId === ws.id ? 'opening…' : 'open'}
                  </button>
                  {hasNative && (
                    <button
                      onClick={() => openWorkspaceWindow(ws.id, ws.name)}
                      disabled={busyId === ws.id}
                      style={secondaryButtonStyle(false)}
                      title="Open this workspace in its own native window"
                    >
                      new window
                    </button>
                  )}
                  <button
                    onClick={() => openWorkspace(ws, { ingestFirst: true, includeCode })}
                    disabled={busyId === ws.id}
                    style={secondaryButtonStyle(busyId === ws.id)}
                  >
                    re-ingest + open
                  </button>
                  <button
                    onClick={() => removeWorkspace(ws)}
                    disabled={busyId === ws.id}
                    style={dangerButtonStyle(busyId === ws.id)}
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {browserOpen && (
        <FolderBrowserDialog
          initialPath={folderInput.trim() || undefined}
          onCancel={() => setBrowserOpen(false)}
          onPick={(picked) => {
            setFolderInput(picked.path);
            if (!nameInput) setNameInput(picked.name);
            setBrowserOpen(false);
            void addWorkspace({
              folder: picked.path,
              name: nameInput || picked.name,
              guidance: picked.guidance,
            });
          }}
        />
      )}

      {phase.kind !== 'idle' && (
        <IngestProgressModal
          phase={phase}
          onClose={() => setPhase({ kind: 'idle' })}
          onEnter={enterWorkspace}
        />
      )}
    </div>
  );
}

function IngestProgressModal({
  phase,
  onClose,
  onEnter,
}: {
  phase: IngestPhase;
  onClose: () => void;
  onEnter: (workspaceId: string) => void;
}) {
  const titleCopy =
    phase.kind === 'registering'
      ? 'Registering workspace'
      : phase.kind === 'ingesting'
        ? 'Ingesting documents'
        : phase.kind === 'empty'
          ? 'No readable files found'
          : 'Ingest failed';

  const titleColor =
    phase.kind === 'error' ? '#e74c9b' : phase.kind === 'empty' ? '#e7b24c' : '#00b4d8';

  const folder =
    'folder' in phase ? phase.folder : '';

  const busy = phase.kind === 'registering' || phase.kind === 'ingesting';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={busy ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0a0a0a',
          border: `1px solid ${titleColor}22`,
          color: '#f0f0f0',
          width: 'min(560px, 94vw)',
          padding: '26px 28px',
        }}
      >
        <div
          style={{
            fontSize: '0.6rem',
            color: titleColor,
            letterSpacing: '0.22em',
            fontWeight: 700,
            marginBottom: 10,
          }}
        >
          {titleCopy.toUpperCase()}
        </div>
        <div style={{ fontSize: '1.35rem', fontWeight: 300, lineHeight: 1.25, marginBottom: 14 }}>
          {phase.kind === 'registering' && 'Creating the workspace database…'}
          {phase.kind === 'ingesting' &&
            'Walking the folder for markdown, text, HTML, SVG, and optionally source code.'}
          {phase.kind === 'empty' && 'This folder has no readable text files under it.'}
          {phase.kind === 'error' && phase.message}
        </div>
        {folder && (
          <div
            style={{
              fontSize: '0.72rem',
              color: '#777',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              marginBottom: 18,
              wordBreak: 'break-all',
            }}
          >
            {folder}
          </div>
        )}

        {busy && <IngestSpinnerRow />}

        {phase.kind === 'empty' && (
          <div
            style={{
              fontSize: '0.76rem',
              color: '#aaa',
              lineHeight: 1.6,
              padding: '12px 14px',
              background: '#120f08',
              border: '1px solid #2a2414',
              marginBottom: 14,
            }}
          >
            Bird Brain reads markdown (<code style={{ color: '#e7b24c' }}>.md</code>), plain text
            (<code style={{ color: '#e7b24c' }}>.txt</code>, <code style={{ color: '#e7b24c' }}>.rst</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.org</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.adoc</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.json</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.yaml</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.csv</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.log</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.toml</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.ini</code>), HTML (
            <code style={{ color: '#e7b24c' }}>.html</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.htm</code>,{' '}
            <code style={{ color: '#e7b24c' }}>.xml</code>), and{' '}
            <code style={{ color: '#e7b24c' }}>.svg</code>. You can still open the workspace with
            its empty database, or cancel and point at a folder that has any of those inside.
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: 14,
            flexWrap: 'wrap',
          }}
        >
          {phase.kind === 'empty' && (
            <button
              onClick={() => onEnter(phase.workspaceId)}
              style={{
                background: '#00d68f',
                color: '#041015',
                border: 'none',
                padding: '10px 16px',
                cursor: 'pointer',
                fontSize: '0.66rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              open anyway
            </button>
          )}
          {!busy && (
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                color: '#ddd',
                border: '1px solid #2c2c2c',
                padding: '10px 14px',
                cursor: 'pointer',
                fontSize: '0.64rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              {phase.kind === 'empty' ? 'stay here' : 'close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function IngestSpinnerRow() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: '#0f1316',
        border: '1px solid #16242a',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          border: '2px solid #00b4d8',
          borderRightColor: 'transparent',
          borderRadius: '50%',
          animation: 'bb-spin 0.85s linear infinite',
        }}
      />
      <div style={{ fontSize: '0.76rem', color: '#8fb6c3' }}>
        Parsing markdown, chunking by heading, writing to SQLite.
      </div>
      <style>{`@keyframes bb-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PurposeCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #181818', padding: '14px 16px' }}>
      <div style={{ fontSize: '0.74rem', color: '#f0f0f0', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: '0.72rem', color: '#888', lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f0f',
  border: '1px solid #1c1c1c',
  color: '#eee',
  padding: '12px 14px',
  fontSize: '0.82rem',
  outline: 'none',
};

function primaryButtonStyle(busy: boolean): React.CSSProperties {
  return {
    background: '#00d68f',
    color: '#041015',
    border: 'none',
    padding: '10px 16px',
    cursor: busy ? 'wait' : 'pointer',
    fontSize: '0.66rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
    opacity: busy ? 0.7 : 1,
  };
}

function secondaryButtonStyle(busy: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: '#f0f0f0',
    border: '1px solid #2c2c2c',
    padding: '10px 16px',
    cursor: busy ? 'wait' : 'pointer',
    fontSize: '0.66rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
    opacity: busy ? 0.7 : 1,
  };
}

function dangerButtonStyle(busy: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: '#e74c9b',
    border: '1px solid #3a1a2a',
    padding: '10px 16px',
    cursor: busy ? 'wait' : 'pointer',
    fontSize: '0.66rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
    opacity: busy ? 0.7 : 1,
  };
}

function formatAgo(ts: number | null): string {
  if (!ts) return 'never opened';
  const secs = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
