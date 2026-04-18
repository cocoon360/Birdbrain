'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDossier, type BranchRecord } from '../DossierContext';
import { useOptionalWorkspace } from '../WorkspaceProvider';
import { getSessionId, logParticipation } from '../../lib/participation/log';
import { BRANCH_COLORS, MODE_COLORS } from '@/lib/ui/semantic';

// ── Types ────────────────────────────────────────────────────────────────────

type Span =
  | { text: string }
  | { text: string; ref: string; kind: 'known' | 'candidate' };

interface MemesisPayload {
  row: {
    paragraph: Span[];
    generator: string;
    model: string | null;
    generated_at: number;
    event_count: number;
  } | null;
  reason?: 'insufficient-events' | 'fresh-cache' | 'ok';
}

interface PendingResponse {
  pending: Array<{
    id: number;
    slug: string;
    name: string;
    profile: string;
    status: string;
  }>;
}

export function DatalogPanel() {
  const {
    synthesisMode,
    setSynthesisMode,
    branches,
    activeBranchId,
    openBranch,
    openBranchStep,
    openConcept,
  } = useDossier();
  const workspace = useOptionalWorkspace();
  const workspaceId = workspace?.id ?? null;

  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    setSessionId(getSessionId(workspaceId));
  }, [workspaceId]);

  const [memesis, setMemesis] = useState<MemesisPayload | null>(null);
  const [memesisBusy, setMemesisBusy] = useState(false);
  const [memesisError, setMemesisError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [laneState, setLaneState] = useState<'idle' | 'checking' | 'generating'>('checking');

  const hasPendingBranch = branches.some((branch) => branch.status === 'pending');

  const refreshParticipation = useCallback(async () => {
    if (!sessionId) return;
    try {
      const memRes = await fetch(
        `/api/participation/memesis?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: 'no-store' }
      );
      const memJson = (await memRes.json()) as
        | { paragraph: MemesisPayload['row']; eventCount: number }
        | { error: string };
      if ('paragraph' in memJson) {
        setMemesis({ row: memJson.paragraph, reason: memJson.paragraph ? 'fresh-cache' : undefined });
      }
    } catch {
      // network hiccup — leave stale data on screen
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshParticipation();
  }, [refreshParticipation]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setLaneState('checking');
      fetch('/api/dossier/pending?mode=queued')
        .then((r) => r.json())
        .then((data: PendingResponse) => {
          if (cancelled) return;
          const next = data.pending?.length ?? 0;
          setPendingCount(next);
          setLaneState(next > 0 ? 'generating' : 'idle');
        })
        .catch(() => {
          if (cancelled) return;
          setPendingCount(0);
          setLaneState('idle');
        });
    };
    refresh();
    if (synthesisMode !== 'queued' || !hasPendingBranch) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [synthesisMode, hasPendingBranch]);

  const onGenerateMemesis = useCallback(async () => {
    if (!sessionId || memesisBusy) return;
    setMemesisBusy(true);
    setMemesisError(null);
    try {
      const res = await fetch('/api/participation/memesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, force: true }),
      });
      const data = (await res.json()) as MemesisPayload | { error: string };
      if ('error' in data) {
        setMemesisError(data.error);
      } else {
        setMemesis(data);
        logParticipation(workspaceId, { kind: 'memesis' });
      }
    } catch (err) {
      setMemesisError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setMemesisBusy(false);
    }
  }, [memesisBusy, sessionId, workspaceId]);

  const active = branches.find((branch) => branch.id === activeBranchId) ?? null;
  const unread = branches.filter((branch) => branch.unread).length;

  return (
    <div
      style={{ height: '100%', overflowY: 'auto', padding: '32px 48px 56px' }}
      className="thin-scrollbar"
    >
      <div style={{ marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>
          the archive, watching back
        </div>
        <h1 className="metro-title">datalog</h1>
        <p
          style={{
            marginTop: 10,
            fontSize: '0.78rem',
            color: '#555',
            maxWidth: 620,
            lineHeight: 1.55,
          }}
        >
          Today&rsquo;s reading, summarized by the archive. Status and branches follow.
        </p>
      </div>

      <MemesisCard
        payload={memesis}
        onGenerate={onGenerateMemesis}
        busy={memesisBusy}
        error={memesisError}
        onKnown={(slug) => openConcept(slug, { branch: 'new', source: 'known' })}
      />

      <StatusStrip
        synthesisMode={synthesisMode}
        setSynthesisMode={setSynthesisMode}
        pendingCount={pendingCount}
        unread={unread}
        depth={active?.path.length ?? 0}
        laneState={laneState}
      />

      {branches.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <SectionHeader title="BRANCHES TO CHECK OUT" accent={BRANCH_COLORS.new} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {branches.map((branch) => (
              <BranchCard
                key={branch.id}
                branch={branch}
                activeBranchId={activeBranchId}
                openBranch={openBranch}
                openBranchStep={openBranchStep}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Status strip (compact, single row) ───────────────────────────────────────

function StatusStrip({
  synthesisMode,
  setSynthesisMode,
  pendingCount,
  unread,
  depth,
  laneState,
}: {
  synthesisMode: 'live' | 'queued';
  setSynthesisMode: (mode: 'live' | 'queued') => void;
  pendingCount: number;
  unread: number;
  depth: number;
  laneState: 'idle' | 'checking' | 'generating';
}) {
  const pill = (label: string, value: number, color: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ color, fontSize: '0.82rem', fontWeight: 500 }}>{value}</span>
      <span
        style={{
          fontSize: '0.54rem',
          color: '#666',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </div>
  );
  return (
    <section
      style={{
        marginTop: 18,
        background: '#0f0f0f',
        border: '1px solid #181818',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        {(['live', 'queued'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setSynthesisMode(mode)}
            style={{
              background: synthesisMode === mode ? MODE_COLORS[mode] : 'transparent',
              color: synthesisMode === mode ? '#041015' : '#aaa',
              border: `1px solid ${MODE_COLORS[mode]}`,
              padding: '4px 10px',
              cursor: 'pointer',
              textTransform: 'uppercase',
              fontSize: '0.56rem',
              letterSpacing: '0.14em',
              fontWeight: 700,
            }}
          >
            {mode}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {pill('pending', pendingCount, MODE_COLORS.queued)}
        {pill('unread branches', unread, BRANCH_COLORS.new)}
        {pill('depth', depth, BRANCH_COLORS.active)}
      </div>
      <div style={{ fontSize: '0.6rem', color: '#555', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {laneState === 'generating' ? 'queue active' : laneState === 'checking' ? 'checking…' : 'idle'}
      </div>
    </section>
  );
}

// ── Memesis card ─────────────────────────────────────────────────────────────

function MemesisCard({
  payload,
  busy,
  error,
  onGenerate,
  onKnown,
}: {
  payload: MemesisPayload | null;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
  onKnown: (slug: string) => void;
}) {
  const row = payload?.row ?? null;
  const insufficient = payload?.reason === 'insufficient-events' && !row;
  return (
    <section
      style={{
        background: '#0b0d0c',
        border: '1px solid #1d2422',
        borderLeft: '3px solid #3ed9a3',
        padding: '20px 24px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div style={laneLabelStyle}>today&rsquo;s reading, summarized by the archive</div>
        <button
          onClick={onGenerate}
          disabled={busy}
          style={{
            background: 'transparent',
            border: '1px solid #2a2a2a',
            color: busy ? '#444' : '#9cd8ba',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: '0.55rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 700,
            padding: '6px 12px',
          }}
        >
          {busy ? 'listening…' : row ? 'refresh' : 'synthesize'}
        </button>
      </div>
      <div style={{ marginTop: 12, fontSize: '0.95rem', lineHeight: 1.7, color: '#ddd' }}>
        {row ? (
          <SpanRender spans={row.paragraph} onKnown={onKnown} />
        ) : insufficient ? (
          <span style={{ color: '#666', fontStyle: 'italic' }}>
            Not enough clicks yet. Open a few concepts and I&rsquo;ll start noticing a shape.
          </span>
        ) : busy ? (
          <span style={{ color: '#666' }}>Reading your trail…</span>
        ) : (
          <span style={{ color: '#666', fontStyle: 'italic' }}>
            No reflection yet. Hit <em>synthesize</em> when you want the archive to say something
            back.
          </span>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 10, fontSize: '0.66rem', color: '#e06060' }}>
          memesis error: {error}
        </div>
      )}
      {row && (
        <div style={{ marginTop: 10, fontSize: '0.55rem', color: '#444', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          seen {row.event_count} events · {row.generator}
          {row.model ? ` · ${row.model}` : ''}
        </div>
      )}
    </section>
  );
}

function SpanRender({ spans, onKnown }: { spans: Span[]; onKnown: (slug: string) => void }) {
  return (
    <>
      {spans.map((span, i) => {
        if (!('ref' in span)) return <span key={i}>{span.text}</span>;
        const color = span.kind === 'known' ? '#9cd8ba' : '#d9c46b';
        return (
          <button
            key={i}
            onClick={() => (span.kind === 'known' ? onKnown(span.ref) : null)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              margin: 0,
              color,
              textDecoration: 'underline',
              cursor: span.kind === 'known' ? 'pointer' : 'default',
              fontSize: 'inherit',
              fontFamily: 'inherit',
            }}
          >
            {span.text}
          </button>
        );
      })}
    </>
  );
}

// ── Branch cards ─────────────────────────────────────────────────────────────

function BranchCard({
  branch,
  activeBranchId,
  openBranch,
  openBranchStep,
}: {
  branch: BranchRecord;
  activeBranchId: string | null;
  openBranch: (id: string) => void;
  openBranchStep: (branchId: string, stepIndex: number) => void;
}) {
  const statusColor = branch.unread
    ? BRANCH_COLORS.new
    : branch.status === 'ready'
      ? BRANCH_COLORS.ready
      : branch.status === 'pending'
        ? BRANCH_COLORS.pending
        : BRANCH_COLORS.idle;

  const outerColor = branch.id === activeBranchId ? BRANCH_COLORS.active : '#1e1e1e';
  return (
    <div
      style={{
        background: branch.id === activeBranchId ? '#12181b' : '#111',
        borderTop: `1px solid ${outerColor}`,
        borderRight: `1px solid ${outerColor}`,
        borderBottom: `1px solid ${outerColor}`,
        borderLeft: `3px solid ${statusColor}`,
        padding: '12px 14px',
        color: '#ddd',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <button
          onClick={() => openBranch(branch.id)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            margin: 0,
            color: '#f0f0f0',
            cursor: 'pointer',
            fontSize: '0.86rem',
            textAlign: 'left',
          }}
        >
          {branch.label}
        </button>
        <span
          style={{
            color: statusColor,
            fontSize: '0.56rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          {branch.unread ? 'new' : branch.status}
        </span>
      </div>
      <div
        style={{
          fontSize: '0.62rem',
          color: '#666',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        root {branch.rootSlug}
        {branch.parentBranchId ? ' · child branch' : ' · direct from hud'}
      </div>
      <div style={{ fontSize: '0.7rem', color: '#888', lineHeight: 1.5, marginBottom: 10 }}>
        current node: {branch.currentSlug} · path depth {branch.path.length}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {branch.path.map((step, index) => {
          const isCurrent = step.slug === branch.currentSlug;
          const isFirst = index === 0;
          const isNewest = index === branch.path.length - 1;
          return (
            <button
              key={`${branch.id}-${step.slug}-${step.at}-${index}`}
              onClick={() => openBranchStep(branch.id, index)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                textAlign: 'left',
                background: isCurrent ? '#151d20' : '#0d0d0d',
                border: `1px solid ${isCurrent ? BRANCH_COLORS.active : '#1a1a1a'}`,
                color: '#d8d8d8',
                padding: '8px 10px',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: '0.74rem', color: isCurrent ? '#f0f0f0' : '#d8d8d8' }}>
                  {step.slug}
                </div>
                <div
                  style={{
                    fontSize: '0.58rem',
                    color: '#666',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginTop: 2,
                  }}
                >
                  {isFirst ? 'branch root' : `from ${step.fromSlug ?? 'unknown'}`} · {step.source}
                </div>
              </div>
              <span
                style={{
                  fontSize: '0.54rem',
                  color: isCurrent
                    ? BRANCH_COLORS.active
                    : branch.unread && isNewest
                      ? BRANCH_COLORS.new
                      : '#555',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                {isCurrent ? 'current' : branch.unread && isNewest ? 'new node' : 'prior'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeader({ title, accent }: { title: string; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
      <span
        style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: accent,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </span>
      <div style={{ flex: 1, height: 1, background: '#181818' }} />
    </div>
  );
}

const laneLabelStyle: React.CSSProperties = {
  fontSize: '0.6rem',
  color: '#666',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  marginBottom: 10,
};
