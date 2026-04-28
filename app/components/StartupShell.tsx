'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDossier } from './DossierContext';
import { EngineSettingsDrawer } from './EngineSettingsDrawer';
import { RobotBirdLogo } from './RobotBirdLogo';
import { useWorkspace } from './WorkspaceProvider';
import { metroFont, space, type } from '@/lib/ui/metro-theme';

export type StartupMode = 'automatic-cached' | 'always-fresh' | 'manual';
type RunMode = 'local' | 'ai';

/** Mirrors `getCorpusStats()` from the startup status API (client-safe subset). */
interface CorpusStatsPayload {
  total_docs: number;
  total_chunks: number;
  last_ingested: number | null;
}

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
    corpus_signature?: string;
  };
  stats?: CorpusStatsPayload;
  starter_lenses: Array<{
    concept_slug: string;
    title: string;
    description: string;
  }>;
}

const MODE_COPY: Record<StartupMode, { title: string; description: string }> = {
  'automatic-cached': {
    title: 'Automatic cached',
    description: 'Use the last project map if the files are unchanged. Rebuild automatically after ingest or when missing.',
  },
  'always-fresh': {
    title: 'Always fresh',
    description: 'Build a fresh project map and clear cached briefs/dossiers, even if the files have not changed.',
  },
  manual: {
    title: 'Manual rebuild',
    description: 'Only rebuild the project map when you explicitly click the rebuild button.',
  },
};

const RUN_MODE_COPY: Record<RunMode, { title: string; description: string }> = {
  local: {
    title: 'Demo mode',
    description: 'Click around pregenerated material: some links work, some show branches, and some mark where the full configured version begins.',
  },
  ai: {
    title: 'Configure AI',
    description: 'Use Cursor CLI, Ollama, OpenAI, or Anthropic for richer project maps and generated dossiers.',
  },
};

export function StartupShell({
  onEnter,
  initialMode = 'automatic-cached',
  workspaceName,
  onSwitchWorkspace,
}: {
  onEnter: () => void;
  initialMode?: StartupMode;
  workspaceName?: string;
  onSwitchWorkspace?: () => void;
}) {
  const { resetSession } = useDossier();
  const workspace = useWorkspace();
  const [mode, setMode] = useState<StartupMode>(initialMode);
  const [status, setStatus] = useState<StartupStatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  /** Step-by-step hints after a failed ontology rebuild (from API). */
  const [rebuildSteps, setRebuildSteps] = useState<string[]>([]);
  /** Set when /api/startup/status fails so we don’t look “stuck loading” forever. */
  const [statusFetchError, setStatusFetchError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  /** First load (or workspace switch) until the status request settles. */
  const [bootstrapping, setBootstrapping] = useState(true);
  const [runMode, setRunMode] = useState<RunMode>('ai');
  const [savingRunMode, setSavingRunMode] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const isDemoWorkspace = workspace.id === 'demo_mode';
  const runModeOptions: RunMode[] = isDemoWorkspace ? ['local', 'ai'] : ['ai'];

  const fetchStartupStatus = useCallback(
    async (opts?: { signal?: AbortSignal }): Promise<StartupStatusPayload | null> => {
      setStatusFetchError(null);
      try {
        const res = await fetch('/api/startup/status', { cache: 'no-store', signal: opts?.signal });
        const json = (await res.json()) as StartupStatusPayload & {
          error?: { code?: string; message?: string };
        };
        if (!res.ok) {
          const hint =
            json.error?.message ??
            (res.status === 400 && json.error?.code === 'no-workspace'
              ? 'No workspace on this request. Go back and open a project from the picker.'
              : `Could not load startup status (${res.status}).`);
          setStatusFetchError(hint);
          setStatus(null);
          return null;
        }
        if (!json.status) {
          setStatusFetchError('Startup response was missing status. Try again or check server logs.');
          setStatus(null);
          return null;
        }
        setStatus(json as StartupStatusPayload);
        return json as StartupStatusPayload;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null;
        }
        const text = err instanceof Error ? err.message : 'Network error';
        setStatusFetchError(`Could not reach Bird Brain: ${text}`);
        setStatus(null);
        return null;
      }
    },
    []
  );

  useEffect(() => {
    setMode(initialMode);
    const ac = new AbortController();
    setBootstrapping(true);
    setStatus(null);
    setStatusFetchError(null);
    void (async () => {
      await fetchStartupStatus({ signal: ac.signal });
      if (!ac.signal.aborted) {
        setBootstrapping(false);
      }
    })();
    return () => ac.abort();
  }, [workspace.id, fetchStartupStatus, initialMode]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/engine', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { provider?: string }) => {
        if (cancelled) return;
        setRunMode(data.provider === 'local' && isDemoWorkspace ? 'local' : 'ai');
      })
      .catch(() => {
        if (!cancelled) setRunMode(isDemoWorkspace ? 'local' : 'ai');
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.id, isDemoWorkspace]);

  useEffect(() => {
    if (!status?.status?.running || busy) return;
    const timer = window.setInterval(() => {
      void fetchStartupStatus();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [status?.status?.running, busy, fetchStartupStatus]);

  const canEnter = Boolean(status?.status?.ready);
  const blocked = Boolean(status && status.status && !status.status.ready);
  const summary = status?.status?.latest_run?.summary_text;

  async function refreshStatus() {
    return fetchStartupStatus();
  }

  async function saveLocalRunMode() {
    if (!isDemoWorkspace) {
      setRunMode('ai');
      setMessage('Demo mode is only available in the bundled Demo Mode workspace.');
      return;
    }
    const next: RunMode = 'local';
    setRunMode(next);
    setSavingRunMode(true);
    setMessage('');
    try {
      const res = await fetch('/api/engine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'local' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage(body?.error ?? 'Could not save run mode.');
        return;
      }
      await refreshStatus();
    } finally {
      setSavingRunMode(false);
    }
  }

  async function enterReaderMode() {
    resetSession();
    if (runMode === 'local' && isDemoWorkspace) {
      const next = await rebuild(false);
      if (!next?.status?.ready && !corpusIngestedOk) return;
    }
    onEnter();
  }

  async function runCorpusIngest(includeCode = true) {
    setIngesting(true);
    setMessage('');
    setRebuildSteps([]);
    try {
      const res = await fetch('/api/workspace/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          include_code: includeCode,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        stats?: { total: number; added: number; updated: number };
      };
      if (!res.ok) {
        setMessage(json.error || 'Folder scan failed.');
        return;
      }
      const st = json.stats;
      if (st) {
        if (st.total === 0) {
          setMessage('Ingest finished, but no readable files were found under this workspace folder.');
        } else {
          setMessage(
            `Indexed ${st.total} file${st.total === 1 ? '' : 's'} (${st.added} new, ${st.updated} updated).`
          );
        }
      } else {
        setMessage('Folder scan finished.');
      }
      await refreshStatus();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Folder scan failed.');
    } finally {
      setIngesting(false);
    }
  }

  async function begin() {
    resetSession();
    setBusy(true);
    setMessage('');
    setRebuildSteps([]);
    try {
      let next = status ?? (await refreshStatus());
      if (!next?.status) {
        setMessage('Startup status did not load. Use retry above or switch workspace.');
        return;
      }
      if (next.status.running) {
        setMessage('Project map is already building. This screen will refresh when it finishes.');
        return;
      }
      if (mode === 'automatic-cached' && (next.status.missing || next.status.stale || next.status.failed)) {
        next = (await rebuild(false)) ?? next;
      } else if (mode === 'always-fresh') {
        next = (await rebuild(true)) ?? next;
      }
      if (!next?.status) return;
      if (next.status.ready) {
        onEnter();
      } else if (mode === 'manual') {
        setMessage('Project map is not ready yet. Rebuild it before entering Bird Brain.');
      } else {
        setMessage('Bird Brain could not enter because the project map is still unavailable.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function rebuild(force: boolean): Promise<StartupStatusPayload | null> {
    setBusy(true);
    setMessage('');
    setRebuildSteps([]);
    const res = await fetch('/api/startup/rebuild', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, force }),
    });
    const json = (await res.json()) as {
      error?: string;
      hint?: string;
      steps?: string[];
    };
    const next = await refreshStatus();
    if (!res.ok) {
      const parts = [json.error || 'Project map rebuild failed.'];
      if (json.hint?.trim()) parts.push(json.hint.trim());
      setMessage(parts.join(' '));
      setRebuildSteps(Array.isArray(json.steps) ? json.steps.filter((s) => typeof s === 'string' && s.trim()) : []);
    }
    setBusy(false);
    return next;
  }

  const statusLabel = useMemo(() => {
    if (bootstrapping && !statusFetchError) return 'loading startup state';
    if (statusFetchError) return 'startup status unavailable';
    if (!status?.status) return 'startup state unknown';
    if (status.status.running) return 'project map running';
    if (status.status.ready) return 'project map ready';
    if (status.status.failed) return 'project map failed';
    if (status.status.stale) return 'project map stale';
    if (status.status.missing) return 'project map missing';
    return 'startup pending';
  }, [status, statusFetchError, bootstrapping]);

  const corpusIngestedOk = useMemo(() => {
    if (!status?.status) return false;
    const sig = status.status.current_corpus_signature?.trim();
    const docs = status.stats?.total_docs ?? 0;
    return Boolean(sig && docs > 0);
  }, [status]);
  const canEnterDegraded = corpusIngestedOk && !canEnter;

  const corpusDetail = useMemo(() => {
    if (!status?.status) return null;
    const sig = status.status.current_corpus_signature?.trim();
    const stats = status.stats;
    const n = stats?.total_docs ?? 0;
    const chunks = stats?.total_chunks ?? 0;
    if (!stats && !sig) return null;
    if (!sig && n === 0) {
      return 'Run re-scan folder so Bird Brain scans your folder and writes documents into the local database.';
    }
    if (!sig && n > 0) {
      return `${n} document(s) in the database, but folder metadata is missing — run re-scan once to repair.`;
    }
    if (sig && n === 0) {
      return 'Folder metadata exists but the document index is empty — run re-scan folder.';
    }
    const last = stats?.last_ingested;
    const lastBit =
      last != null ? ` Last folder scan: ${new Date(last * 1000).toLocaleString()}.` : '';
    return `${n} document${n === 1 ? '' : 's'}, ${chunks} chunk${chunks === 1 ? '' : 's'} in the index.${lastBit}`;
  }, [status]);

  return (
    <div
      style={{
        height: '100vh',
        minHeight: '100vh',
        maxHeight: '100vh',
        width: '100vw',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        fontFamily: metroFont,
      }}
      className="thin-scrollbar"
    >
      <div
        style={{
          flex: '0 0 min(56vw, 740px)',
          minHeight: 0,
          overflowY: 'auto',
          padding: `${space.xl}px ${space.hub}px`,
          borderRight: '1px solid var(--border)',
        }}
        className="thin-scrollbar"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: space.md,
            borderBottom: '1px solid var(--border)',
            paddingBottom: space.sm,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
            <RobotBirdLogo size={32} />
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
        <h1 className="metro-title" style={{ fontSize: 'clamp(2.35rem, 5vw, 3.4rem)' }}>
          begin again
        </h1>
        <p className="metro-lead" style={{ marginTop: space.md, maxWidth: 620 }}>
          Build or reuse this workspace’s project map, choose how much AI to use, then enter the
          panorama.
        </p>
        <div style={{ marginTop: space.lg }}>
          <div className="metro-subtitle" style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
            run mode
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                runModeOptions.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
              gap: space.sm,
            }}
          >
            {runModeOptions.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => (key === 'local' ? void saveLocalRunMode() : setEngineOpen(true))}
                disabled={savingRunMode}
                className="metro-surface"
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  cursor: savingRunMode ? 'wait' : 'pointer',
                  borderColor:
                    runMode === key
                      ? 'var(--status-canon)'
                      : key === 'ai'
                        ? 'rgba(231, 76, 155, 0.55)'
                        : 'var(--border)',
                  background:
                    key === 'ai' && runMode !== key
                      ? 'rgba(231, 76, 155, 0.055)'
                      : undefined,
                  minHeight: 92,
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color:
                      runMode === key
                        ? 'var(--status-canon)'
                        : key === 'ai'
                          ? '#e74c9b'
                          : 'var(--text)',
                    marginBottom: 6,
                  }}
                >
                  {RUN_MODE_COPY[key].title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                  {RUN_MODE_COPY[key].description}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: space.lg }}>
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
                    marginBottom: 4,
                  }}
                >
                  {MODE_COPY[key].title}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.42 }}>
                  {MODE_COPY[key].description}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className="thin-scrollbar"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflowY: 'auto',
          padding: `${space.xl}px`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          className="metro-subtitle"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 10,
            color: statusFetchError
              ? '#e74c9b'
              : bootstrapping
                ? 'var(--accent)'
                : blocked
                  ? '#e74c9b'
                  : 'var(--status-canon)',
          }}
        >
          {bootstrapping && !statusFetchError && <StartupInlineSpinner />}
          {statusLabel}
        </div>
        {statusFetchError && (
          <div style={{ fontSize: 14, color: '#e74c9b', lineHeight: 1.55, marginBottom: space.md }}>
            {statusFetchError}
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => void refreshStatus()}
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
                  fontFamily: metroFont,
                }}
              >
                retry
              </button>
            </div>
          </div>
        )}
        <div style={{ fontSize: type.lead, color: 'var(--text)', lineHeight: 1.35, marginBottom: 8 }}>
          {status?.meta?.project_name ?? workspaceName ?? 'Bird Brain'}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: space.md }}>
          {bootstrapping
            ? 'Connecting to this workspace’s database and checking the last project map…'
            : summary ||
              'Bird Brain hasn’t built an overview of this folder yet. Click build overview to run it.'}
        </div>
        {status?.status?.latest_run?.error_text && (
          <div style={{ fontSize: 14, color: '#e74c9b', lineHeight: 1.6, marginBottom: space.lg }}>
            Last project-map error: {status.status.latest_run.error_text}
          </div>
        )}

        <div className="metro-surface" style={{ padding: '14px 16px', marginBottom: space.md }}>
          <div className="metro-subtitle" style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
            startup checks
          </div>
          {bootstrapping ? (
            <StartupChecksLoading />
          ) : statusFetchError || !status?.status ? (
            <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {statusFetchError
                ? 'Fix the error above, then tap retry to reload these checks.'
                : 'Startup status did not load.'}
            </div>
          ) : (
            <>
              <ChecklistRow label="Folder scanned" ok={corpusIngestedOk} />
              <ChecklistRow label="Project map ready" ok={Boolean(status.status.ready)} />
              <ChecklistRow label="Project map stale" ok={Boolean(status.status.stale)} invert />
              <ChecklistRow label="Last run succeeded" ok={!status.status.failed} />
              {corpusDetail && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border)',
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    lineHeight: 1.55,
                  }}
                >
                  {corpusDetail}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={begin}
            disabled={busy || ingesting || bootstrapping}
            style={{
              background: canEnter ? 'var(--status-canon)' : 'var(--accent)',
              color: '#041015',
              border: 'none',
              padding: '12px 20px',
              cursor: busy || ingesting || bootstrapping ? 'wait' : 'pointer',
              fontSize: type.stamp,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 700,
              opacity: busy || ingesting || bootstrapping ? 0.7 : 1,
              fontFamily: metroFont,
            }}
          >
            {bootstrapping ? 'loading…' : busy ? 'working…' : canEnter ? 'enter' : 'build overview'}
          </button>
          {canEnterDegraded && (
            <button
              type="button"
              onClick={() => {
                void enterReaderMode();
              }}
              disabled={busy || ingesting || bootstrapping}
              title="Enter with local search, files, and derived concepts while the AI project map is unavailable."
              style={{
                background: 'transparent',
                color: 'var(--status-canon)',
                border: '1px solid var(--status-canon)',
                padding: '12px 20px',
                cursor: busy || ingesting || bootstrapping ? 'wait' : 'pointer',
                fontSize: type.stamp,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 700,
                opacity: busy || ingesting || bootstrapping ? 0.7 : 1,
                fontFamily: metroFont,
              }}
            >
              enter reader mode
            </button>
          )}
          <button
            type="button"
            onClick={() => void runCorpusIngest(false)}
            disabled={busy || ingesting || bootstrapping}
            title="Scan the project folder again and refresh file stats. Required before the first overview if you skipped scanning when opening."
            style={{
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '12px 20px',
              cursor: busy || ingesting || bootstrapping ? 'wait' : 'pointer',
              fontSize: type.stamp,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 700,
              opacity: busy || ingesting || bootstrapping ? 0.7 : 1,
              fontFamily: metroFont,
            }}
          >
            {ingesting ? 'scanning…' : 're-scan folder'}
          </button>
          {canEnter && (
            <button
              type="button"
              onClick={() => rebuild(true)}
              disabled={busy || ingesting || bootstrapping}
              title="Force a fresh overview without entering — useful to preview the summary."
              style={{
                background: 'transparent',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                padding: '12px 20px',
                cursor: busy || ingesting || bootstrapping ? 'wait' : 'pointer',
                fontSize: type.stamp,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 700,
                opacity: busy || ingesting || bootstrapping ? 0.7 : 1,
                fontFamily: metroFont,
              }}
            >
              rebuild overview
            </button>
          )}
          {message && <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{message}</span>}
        </div>
        {rebuildSteps.length > 0 && (
          <div
            className="metro-surface"
            style={{
              marginTop: space.md,
              padding: '14px 16px',
              borderColor: '#2a1a14',
              background: '#120f08',
            }}
          >
            <div className="metro-subtitle" style={{ marginBottom: 10, color: '#e7b24c' }}>
              what to try next
            </div>
            <ol
              style={{
                margin: 0,
                paddingLeft: 20,
                fontSize: 14,
                color: 'var(--text-dim)',
                lineHeight: 1.65,
              }}
            >
              {rebuildSteps.map((step, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <EngineSettingsDrawer
        open={engineOpen}
        onClose={() => setEngineOpen(false)}
        onSaved={(next) => {
          setRunMode(next.provider === 'local' ? 'local' : 'ai');
          void refreshStatus();
        }}
      />
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

function StartupInlineSpinner() {
  return (
    <>
      <style>{`@keyframes bb-startup-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        aria-hidden
        style={{
          width: 14,
          height: 14,
          border: '2px solid var(--accent)',
          borderRightColor: 'transparent',
          borderRadius: '50%',
          flexShrink: 0,
          animation: 'bb-startup-spin 0.85s linear infinite',
        }}
      />
    </>
  );
}

function StartupChecksLoading() {
  return (
    <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
      Reading the workspace database: document counts, folder fingerprint, and the latest project map.
    </div>
  );
}
