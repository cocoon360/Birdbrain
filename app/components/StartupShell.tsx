'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDossier } from './DossierContext';
import { metroFont, space, type } from '@/lib/ui/metro-theme';

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
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'stretch',
        overflowY: 'auto',
        fontFamily: metroFont,
      }}
      className="thin-scrollbar"
    >
      <div
        style={{
          width: '58%',
          padding: `${space.xxl + 8}px ${space.hub}px ${space.xxl}px`,
          borderRight: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: space.lg,
            borderBottom: '1px solid var(--border)',
            paddingBottom: space.sm,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
            <img
              src="/icons/robot-bird-transparent.svg"
              width={40}
              height={40}
              alt=""
              style={{ display: 'block', flexShrink: 0 }}
            />
            <div className="metro-subtitle" style={{ color: 'var(--accent)' }}>
              {workspaceName ? `bird brain · ${workspaceName.toLowerCase()}` : 'bird brain startup'}
            </div>
          </div>
          {onSwitchWorkspace && (
            <button
              type="button"
              onClick={onSwitchWorkspace}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                padding: '8px 12px',
                fontSize: type.stamp,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              switch workspace
            </button>
          )}
        </div>
        <h1 className="metro-title" style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}>
          begin
          <br />
          again
        </h1>
        <p className="metro-lead" style={{ marginTop: space.lg, maxWidth: 620 }}>
          Bird Brain starts by building an ontology overview of the project. That overview serves
          three jobs at once: it briefs active builders, explains the project to newcomers, and
          demonstrates the product pattern as a reusable project-intelligence console.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: space.md,
            marginTop: space.xl,
          }}
        >
          <PurposeCard title="For Builders" body="Clarify what matters now, what changed, and which concepts deserve active attention." />
          <PurposeCard title="For Newcomers" body="Define ideas plainly before assuming any prior familiarity or internal shorthand with this project." />
          <PurposeCard title="For Product" body="Show Bird Brain as a portable way to transform a messy project folder into interactive understanding." />
        </div>
        <div style={{ marginTop: space.xxl }}>
          <div className="metro-subtitle" style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
            startup mode
          </div>
          <div className="metro-surface" style={{ padding: 0, overflow: 'hidden' }}>
            {(Object.keys(MODE_COPY) as StartupMode[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`metro-list-row${mode === key ? ' metro-list-row--selected' : ''}`}
                onClick={() => setMode(key)}
              >
                <div
                  style={{
                    fontSize: type.body,
                    fontWeight: 600,
                    color: mode === key ? 'var(--accent)' : 'var(--text)',
                    marginBottom: 6,
                  }}
                >
                  {MODE_COPY[key].title}
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  {MODE_COPY[key].description}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: `${space.xxl + 8}px ${space.xl}px ${space.xxl}px`, display: 'flex', flexDirection: 'column' }}>
        <div
          className="metro-subtitle"
          style={{ marginBottom: 10, color: blocked ? '#e74c9b' : 'var(--status-canon)' }}
        >
          {statusLabel}
        </div>
        <div style={{ fontSize: type.lead, color: 'var(--text)', lineHeight: 1.45, marginBottom: 10 }}>
          {status?.meta.project_name ?? 'Bird Brain'}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: space.lg }}>
          {summary ||
            'Bird Brain hasn’t built an overview of this folder yet. Click build overview to run it.'}
        </div>
        {status?.status.latest_run?.error_text && (
          <div style={{ fontSize: 14, color: '#e74c9b', lineHeight: 1.6, marginBottom: space.lg }}>
            Last ontology error: {status.status.latest_run.error_text}
          </div>
        )}

        <div className="metro-surface" style={{ padding: '16px 18px', marginBottom: space.lg }}>
          <div className="metro-subtitle" style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
            startup checks
          </div>
          <ChecklistRow label="Corpus ingested" ok={Boolean(status?.meta.docs_root)} />
          <ChecklistRow label="Ontology ready" ok={Boolean(status?.status.ready)} />
          <ChecklistRow label="Ontology stale" ok={Boolean(status?.status.stale)} invert />
          <ChecklistRow label="Last run failed" ok={!status?.status.failed} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={begin}
            disabled={busy}
            style={{
              background: canEnter ? 'var(--status-canon)' : 'var(--accent)',
              color: '#041015',
              border: 'none',
              padding: '12px 20px',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: type.stamp,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 700,
              opacity: busy ? 0.7 : 1,
              fontFamily: metroFont,
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
            type="button"
            onClick={() => rebuild(true)}
            disabled={busy}
            style={{
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '12px 20px',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: type.stamp,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 700,
              opacity: busy ? 0.7 : 1,
              fontFamily: metroFont,
            }}
          >
            rebuild overview
          </button>
          {message && <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{message}</span>}
        </div>
      </div>
    </div>
  );
}

function PurposeCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="metro-surface" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function ChecklistRow({ label, ok, invert = false }: { label: string; ok: boolean; invert?: boolean }) {
  const pass = invert ? !ok : ok;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{label}</span>
      <span
        className="metro-subtitle"
        style={{ color: pass ? 'var(--status-canon)' : '#e74c9b' }}
      >
        {pass ? 'ok' : 'needs work'}
      </span>
    </div>
  );
}
