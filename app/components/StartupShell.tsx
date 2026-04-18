'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDossier } from './DossierContext';

export type StartupMode = 'automatic-cached' | 'always-fresh' | 'manual';

interface StartupStatusPayload {
  status: {
    ready: boolean;
    running: boolean;
    stale: boolean;
    failed: boolean;
    missing: boolean;
    current_corpus_signature: string;
    ontology_corpus_signature: string | null;
    latest_run: {
      summary_text: string | null;
      error_text: string | null;
      completed_at: number | null;
    } | null;
  };
  meta: {
    project_name: string;
    docs_root: string;
  };
  starter_lenses: Array<{
    concept_slug: string;
    title: string;
    description: string;
  }>;
}

const MODE_COPY: Record<StartupMode, { title: string; description: string }> = {
  'automatic-cached': {
    title: 'Automatic cached',
    description: 'Use the last ontology if the corpus is unchanged. Rebuild automatically after ingest or when missing.',
  },
  'always-fresh': {
    title: 'Always fresh',
    description: 'Run a new ontology overview every time you begin again, even if the corpus has not changed.',
  },
  manual: {
    title: 'Manual rebuild',
    description: 'Only rebuild the ontology when you explicitly click the rebuild button.',
  },
};

export function StartupShell({
  onEnter,
  workspaceName,
  onSwitchWorkspace,
}: {
  onEnter: () => void;
  workspaceName?: string;
  onSwitchWorkspace?: () => void;
}) {
  const { resetSession } = useDossier();
  const [mode, setMode] = useState<StartupMode>('automatic-cached');
  const [status, setStatus] = useState<StartupStatusPayload | null>(null);
  const [lastStatusLoadedAt, setLastStatusLoadedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    refreshStatus();
  }, []);

  const canEnter = Boolean(status?.status.ready);
  const blocked = Boolean(status && !status.status.ready);
  const summary = status?.status.latest_run?.summary_text;

  async function refreshStatus(force = false) {
    if (!force && status && Date.now() - lastStatusLoadedAt < 1500) {
      return status;
    }
    const res = await fetch('/api/startup/status', { cache: 'no-store' });
    const json = (await res.json()) as StartupStatusPayload;
    setStatus(json);
    setLastStatusLoadedAt(Date.now());
    return json;
  }

  async function begin() {
    resetSession();
    setBusy(true);
    setMessage('');
    try {
      let next = status ?? (await refreshStatus());
      if (mode === 'automatic-cached' && (next.status.missing || next.status.stale || next.status.failed)) {
        next = await rebuild(false);
      } else if (mode === 'always-fresh') {
        next = await rebuild(true);
      }
      if (next.status.ready) {
        onEnter();
      } else if (mode === 'manual') {
        setMessage('Ontology is not ready yet. Rebuild it before entering Bird Brain.');
      } else {
        setMessage('Bird Brain could not enter because the ontology overview is still unavailable.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function rebuild(force: boolean) {
    setBusy(true);
    setMessage('');
    const res = await fetch('/api/startup/rebuild', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, force }),
    });
    const json = await res.json();
    const next = (await refreshStatus(true)) as StartupStatusPayload;
    if (!res.ok) {
      setMessage(json.error || 'Ontology rebuild failed.');
    }
    setBusy(false);
    return next;
  }

  const statusLabel = useMemo(() => {
    if (!status) return 'loading startup state';
    if (status.status.running) return 'ontology running';
    if (status.status.ready) return 'ontology ready';
    if (status.status.failed) return 'ontology failed';
    if (status.status.stale) return 'ontology stale';
    if (status.status.missing) return 'ontology missing';
    return 'startup pending';
  }, [status]);

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
      <div style={{ width: '58%', padding: '56px 60px 44px', borderRight: '1px solid #151515' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src="/icons/robot-bird-transparent.svg"
              width={40}
              height={40}
              alt=""
              style={{ display: 'block', flexShrink: 0 }}
            />
            <div style={{ fontSize: '0.72rem', color: '#00b4d8', letterSpacing: '0.22em', fontWeight: 700 }}>
              {workspaceName ? `BIRD BRAIN · ${workspaceName.toUpperCase()}` : 'BIRD BRAIN STARTUP'}
            </div>
          </div>
          {onSwitchWorkspace && (
            <button
              onClick={onSwitchWorkspace}
              style={{
                background: 'transparent',
                border: '1px solid #2c2c2c',
                color: '#888',
                padding: '6px 10px',
                fontSize: '0.58rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              switch workspace
            </button>
          )}
        </div>
        <h1 style={{ fontSize: '4.6rem', lineHeight: 0.95, fontWeight: 200, letterSpacing: '-0.04em', margin: 0 }}>
          begin
          <br />
          again
        </h1>
        <p style={{ marginTop: 22, fontSize: '1rem', color: '#bbb', lineHeight: 1.7, maxWidth: 620 }}>
          Bird Brain starts by building an ontology overview of the project. That overview serves
          three jobs at once: it briefs active builders, explains the project to newcomers, and
          demonstrates the product pattern as a reusable project-intelligence console.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, marginTop: 28 }}>
          <PurposeCard title="For Builders" body="Clarify what matters now, what changed, and which concepts deserve active attention." />
          <PurposeCard title="For Newcomers" body="Define ideas plainly before assuming any prior familiarity or internal shorthand with this project." />
          <PurposeCard title="For Product" body="Show Bird Brain as a portable way to transform a messy project folder into interactive understanding." />
        </div>
        <div style={{ marginTop: 34 }}>
          <div style={{ fontSize: '0.62rem', color: '#666', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10 }}>
            startup mode
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {(Object.keys(MODE_COPY) as StartupMode[]).map((key) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                style={{
                  textAlign: 'left',
                  background: mode === key ? '#101d21' : '#0f0f0f',
                  border: `1px solid ${mode === key ? '#00b4d8' : '#1c1c1c'}`,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  color: '#ddd',
                }}
              >
                <div style={{ fontSize: '0.82rem', color: mode === key ? '#00b4d8' : '#f0f0f0', marginBottom: 6 }}>
                  {MODE_COPY[key].title}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#888', lineHeight: 1.5 }}>
                  {MODE_COPY[key].description}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: '56px 48px 44px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '0.6rem', color: blocked ? '#e74c9b' : '#00d68f', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
          {statusLabel}
        </div>
        <div style={{ fontSize: '1.1rem', color: '#eee', lineHeight: 1.45, marginBottom: 10 }}>
          {status?.meta.project_name ?? 'Bird Brain'}
        </div>
        <div style={{ fontSize: '0.78rem', color: '#777', lineHeight: 1.6, marginBottom: 18 }}>
          {summary ||
            'Bird Brain hasn’t built an overview of this folder yet. Click build overview to run it.'}
        </div>
        {status?.status.latest_run?.error_text && (
          <div style={{ fontSize: '0.76rem', color: '#e74c9b', lineHeight: 1.6, marginBottom: 18 }}>
            Last ontology error: {status.status.latest_run.error_text}
          </div>
        )}

        <div style={{ background: '#0f0f0f', border: '1px solid #181818', padding: '16px 18px', marginBottom: 18 }}>
          <div style={{ fontSize: '0.58rem', color: '#666', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
            startup checks
          </div>
          <ChecklistRow label="Corpus ingested" ok={Boolean(status?.meta.docs_root)} />
          <ChecklistRow label="Ontology ready" ok={Boolean(status?.status.ready)} />
          <ChecklistRow label="Ontology stale" ok={Boolean(status?.status.stale)} invert />
          <ChecklistRow label="Last run failed" ok={!status?.status.failed} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={begin}
            disabled={busy}
            style={{
              background: canEnter ? '#00d68f' : '#00b4d8',
              color: '#041015',
              border: 'none',
              padding: '12px 18px',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: '0.68rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 700,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy
              ? mode === 'automatic-cached' && !canEnter
                ? 'building overview…'
                : 'working…'
              : canEnter
                ? 'enter'
                : 'build overview'}
          </button>
          <button
            onClick={() => rebuild(true)}
            disabled={busy}
            style={{
              background: 'transparent',
              color: '#f0f0f0',
              border: '1px solid #2c2c2c',
              padding: '12px 18px',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: '0.68rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 700,
              opacity: busy ? 0.7 : 1,
            }}
          >
            rebuild overview
          </button>
          {message && <span style={{ fontSize: '0.74rem', color: '#888' }}>{message}</span>}
        </div>
      </div>
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

function ChecklistRow({ label, ok, invert = false }: { label: string; ok: boolean; invert?: boolean }) {
  const pass = invert ? !ok : ok;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: '0.72rem', color: '#999' }}>{label}</span>
      <span style={{ fontSize: '0.62rem', color: pass ? '#00d68f' : '#e74c9b', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>
        {pass ? 'ok' : 'needs work'}
      </span>
    </div>
  );
}
