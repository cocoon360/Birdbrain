'use client';

import { useEffect, useState } from 'react';
import { ConceptTile } from '../ConceptTile';
import { useDossier } from '../DossierContext';
import { BRANCH_COLORS } from '@/lib/ui/semantic';

interface Stats {
  total_docs: number;
  canon_docs: number;
  working_docs: number;
  archive_docs: number;
  total_chunks: number;
  total_entities: number;
  last_ingested: number | null;
}

interface Concept {
  slug: string;
  name: string;
  type: string;
  summary: string;
  mention_count: number;
  canon_docs: number;
  working_docs: number;
  document_count: number;
  lens_title?: string;
  lens_description?: string;
}

interface Alert {
  kind: string;
  title: string;
  description: string;
  entity_slug: string;
}

interface Meta {
  project_name: string;
  docs_root: string;
}

interface Emerged {
  slug: string;
  name: string;
  type: string;
  emerged_from: string | null;
  created_at: number | null;
  has_synthesis: number;
}

interface HubData {
  startup?: {
    ready: boolean;
    stale: boolean;
    missing: boolean;
    failed: boolean;
    summary_text?: string | null;
  };
  meta: Meta;
  stats: Stats;
  concepts: Concept[];
  emerged: Emerged[];
}

export function HubPanel() {
  const { openConcept, branches, openBranch } = useDossier();
  const [data, setData] = useState<HubData | null>(null);

  useEffect(() => {
    fetch('/api/hub')
      .then((r) => r.json())
      .then(setData);
  }, []);

  const top = data?.concepts.slice(0, 3) ?? [];
  const next = data?.concepts.slice(3, 9) ?? [];
  const blocked = data?.startup ? !data.startup.ready : false;

  return (
    <div className="metro-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>
          bird brain — {data?.meta?.project_name?.toLowerCase() ?? 'project'}
        </div>
        <h1 className="metro-title">hub</h1>
        <p className="metro-lead">
          Snapshot of ingested material: document counts by folder-derived status, drift alerts, and
          starter lenses. Click a concept to open its dossier.
        </p>
        {data?.startup?.summary_text && (
          <div
            className="metro-surface"
            style={{
              marginTop: 12,
              maxWidth: 620,
              padding: '12px 14px',
              color: 'var(--text-dim)',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            {data.startup.summary_text}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 12 }} className="thin-scrollbar">
        {data && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 14,
              marginBottom: 24,
            }}
          >
            <StatTile label="TOTAL DOCS" value={data.stats.total_docs} />
            <StatTile label="PRIMARY" value={data.stats.canon_docs} color="#00d68f" />
            <StatTile label="IN PROGRESS" value={data.stats.working_docs} color="#f6c90e" />
            <StatTile label="CONCEPTS" value={data.stats.total_entities} color="#00b4d8" />
          </div>
        )}

        {blocked && (
          <div
            className="metro-surface"
            style={{
              marginBottom: 28,
              padding: '14px 16px',
              borderStyle: 'dashed',
              color: 'var(--text-dim)',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            Bird Brain has not accepted a startup ontology overview yet. Use the start screen to
            build or rebuild the overview before relying on hub concepts.
          </div>
        )}

        {top.length > 0 && !blocked && (
          <>
            <SectionHeader title="STARTER LENSES" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
                marginBottom: 22,
              }}
            >
              {top.map((c) => (
                <ConceptTile key={c.slug} {...c} summary={c.lens_description ?? c.summary} size="lg" />
              ))}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
                marginBottom: 28,
              }}
            >
              {next.map((c) => (
                <ConceptTile key={c.slug} {...c} summary={c.lens_description ?? c.summary} size="md" />
              ))}
            </div>
          </>
        )}

        {data && data.emerged && data.emerged.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <SectionHeader title="EMERGED FROM EXPLORATION" accent="#e74c9b" />
            <p style={{ fontSize: '0.7rem', color: '#666', margin: '0 0 12px', maxWidth: 560, lineHeight: 1.55 }}>
              Concepts you surfaced by clicking phrases inside other dossiers. Each one is a new
              lens the app hadn't seen in the corpus until you named it.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
              }}
            >
              {data.emerged.map((e) => (
                <button
                  key={e.slug}
                  onClick={() => openConcept(e.slug, { branch: 'new', source: 'root', label: e.name })}
                  style={{
                    textAlign: 'left',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderLeft: '3px solid #e74c9b',
                    padding: '12px 14px',
                    cursor: 'pointer',
                    color: 'var(--text)',
                  }}
                >
                  <div style={{ fontSize: '0.85rem', color: '#f0f0f0', marginBottom: 4 }}>
                    {e.name}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: '#666', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    {e.has_synthesis ? 'synthesized' : 'pending'}
                    {e.emerged_from ? ` · from ${e.emerged_from}` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {branches.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <SectionHeader title="BRANCHES ON THE HUD" accent={BRANCH_COLORS.new} />
            <p style={{ fontSize: '0.7rem', color: '#666', margin: '0 0 12px', maxWidth: 560, lineHeight: 1.55 }}>
              Opening a concept tile starts a new branch. Candidate phrases can surface child
              branches, which stay isolated even when they lead toward overlapping concepts.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {branches.slice(0, 6).map((branch) => (
                <button
                  key={branch.id}
                  onClick={() => openBranch(branch.id)}
                  style={{
                    textAlign: 'left',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${branch.unread ? BRANCH_COLORS.new : branch.status === 'ready' ? BRANCH_COLORS.ready : branch.status === 'pending' ? BRANCH_COLORS.pending : BRANCH_COLORS.idle}`,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    color: 'var(--text)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: '0.82rem', color: '#f0f0f0' }}>{branch.label}</div>
                    {branch.unread && (
                      <span style={{ color: BRANCH_COLORS.new, fontSize: '0.54rem', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>
                        new
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: '#666', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                    {branch.parentBranchId ? 'child branch' : 'root branch'} · {branch.path.length} hops
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#888', lineHeight: 1.45 }}>
                    {branch.currentSlug}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  valueLabel,
  color = 'var(--text)',
}: {
  label: string;
  value?: number;
  valueLabel?: string;
  color?: string;
}) {
  return (
    <div className="metro-stat">
      <div style={{ fontSize: valueLabel ? '1rem' : '2rem', fontWeight: 200, color, lineHeight: 1 }}>
        {valueLabel ?? value ?? 0}
      </div>
      <div
        className="metro-subtitle"
        style={{
          marginTop: 8,
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionHeader({ title, accent = '#888' }: { title: string; accent?: string }) {
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
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}
