'use client';

import { useEffect, useState } from 'react';
import { useDossier, type BranchRecord } from '../DossierContext';
import { BRANCH_COLORS, MODE_COLORS } from '@/lib/ui/semantic';

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
  const { synthesisMode, setSynthesisMode, branches, activeBranchId, openBranch, openBranchStep } =
    useDossier();
  const [pendingCount, setPendingCount] = useState(0);
  const [laneState, setLaneState] = useState<'idle' | 'checking' | 'generating'>('checking');

  const hasPendingBranch = branches.some((branch) => branch.status === 'pending');

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

  const active = branches.find((branch) => branch.id === activeBranchId) ?? null;
  const unread = branches.filter((branch) => branch.unread).length;

  return (
    <div
      style={{ height: '100%', overflowY: 'auto', padding: '32px 48px 48px' }}
      className="thin-scrollbar"
    >
      <div style={{ marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>
          branch memory
        </div>
        <h1 className="metro-title">datalog</h1>
        <p style={{ marginTop: 10, fontSize: '0.78rem', color: '#555', maxWidth: 560, lineHeight: 1.5 }}>
          Switch between the immediate exploration lane and the slower queued lane, then inspect
          every branch the HUD has surfaced from your hypertext path.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 18, marginBottom: 22 }}>
        <div style={{ background: '#0f0f0f', border: '1px solid #181818', padding: '18px 20px' }}>
          <div style={{ fontSize: '0.6rem', color: '#666', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
            synthesis lane
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['live', 'queued'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSynthesisMode(mode)}
                style={{
                  background: synthesisMode === mode ? MODE_COLORS[mode] : 'transparent',
                  color: synthesisMode === mode ? '#041015' : '#aaa',
                  border: `1px solid ${MODE_COLORS[mode]}`,
                  padding: '8px 14px',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  fontSize: '0.62rem',
                  letterSpacing: '0.16em',
                  fontWeight: 700,
                }}
              >
                {mode}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '0.74rem', color: '#888', lineHeight: 1.6 }}>
            {synthesisMode === 'live'
              ? 'Live opens a dossier and writes immediately, so it feels magical and responsive.'
              : 'Queued defers writing into the background lane so the preview can work through pending dossiers automatically.'}
          </div>
        </div>

        <div style={{ background: '#0f0f0f', border: '1px solid #181818', padding: '18px 20px' }}>
          <div style={{ fontSize: '0.6rem', color: '#666', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
            status
          </div>
          <StatRow label="pending queued dossiers" value={pendingCount} color={MODE_COLORS.queued} />
          <StatRow label="new branches" value={unread} color={BRANCH_COLORS.new} />
          <StatRow label="active branch depth" value={active?.path.length ?? 0} color={BRANCH_COLORS.active} />
          <div style={{ marginTop: 12, fontSize: '0.68rem', color: '#777', lineHeight: 1.6 }}>
            {synthesisMode === 'live'
              ? 'Live lane is idle until you open another dossier.'
              : laneState === 'generating'
                ? 'Background generation is active because queued dossiers are still pending.'
                : laneState === 'checking'
                  ? 'Only checking queue status.'
                  : 'Queue is calm. No background generation is running.'}
          </div>
        </div>
      </div>

      <SectionHeader title="BRANCHES TO CHECK OUT" accent={BRANCH_COLORS.new} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 24 }}>
        {branches.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            activeBranchId={activeBranchId}
            openBranch={openBranch}
            openBranchStep={openBranchStep}
          />
        ))}
        {branches.length === 0 && (
          <div style={{ color: '#555', fontSize: '0.8rem' }}>
            No branches yet. Open a concept tile from the HUD to start one.
          </div>
        )}
      </div>
    </div>
  );
}

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

  return (
    <div
      style={{
        background: branch.id === activeBranchId ? '#12181b' : '#111',
        border: `1px solid ${branch.id === activeBranchId ? BRANCH_COLORS.active : '#1e1e1e'}`,
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
      <div style={{ fontSize: '0.62rem', color: '#666', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
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
                <div style={{ fontSize: '0.58rem', color: '#666', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>
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

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
      <div style={{ fontSize: '0.6rem', color: '#666', letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', color, fontWeight: 300 }}>{value}</div>
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
