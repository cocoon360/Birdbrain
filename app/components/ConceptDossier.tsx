'use client';

import { useEffect, useState } from 'react';
import { useDossier } from './DossierContext';
import {
  STATUS_COLORS,
  TYPE_COLORS,
  LINK_COLORS,
} from '@/lib/ui/semantic';

interface ConceptData {
  id: number;
  slug: string;
  name: string;
  type: string;
  summary: string;
  mention_count: number;
  document_count: number;
  canon_docs: number;
  working_docs: number;
}

interface EvidenceRow {
  doc_id: number;
  doc_title: string;
  doc_path: string;
  doc_status: string;
  heading: string | null;
  body: string;
  match_count: number;
}

interface RelatedConcept {
  slug: string;
  name: string;
  type: string;
  mention_count: number;
  canon_docs: number;
  working_docs: number;
  document_count: number;
}

type Span =
  | { text: string }
  | { text: string; ref: string; kind: 'known' | 'candidate' };

interface DossierError {
  code: string;
  message: string;
}

interface DossierData {
  blocked?: boolean;
  concept: ConceptData;
  pending: boolean;
  profile?: 'live' | 'queued';
  paragraph: Span[] | null;
  evidence: EvidenceRow[];
  related: RelatedConcept[];
  generated_at?: number;
  generator?: string;
  model?: string;
  error?: DossierError;
}

export function ConceptDossier() {
  const {
    conceptSlug,
    openConcept,
    openDoc,
    close,
    synthesisMode,
    branchContext,
    markBranchStatus,
  } = useDossier();
  const [data, setData] = useState<DossierData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [queuingPhrase, setQueuingPhrase] = useState<string | null>(null);
  const [queueActivity, setQueueActivity] = useState<'idle' | 'status' | 'generating'>('idle');

  useEffect(() => {
    if (!conceptSlug) {
      setData(null);
      setShowEvidence(false);
      return;
    }
    setLoading(true);
    setData(null);
    setShowEvidence(false);
    fetch(buildDossierUrl(conceptSlug, synthesisMode, branchContext))
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        markBranchStatus(conceptSlug, d.pending || d.blocked ? 'pending' : 'ready');
      })
      .finally(() => setLoading(false));
  }, [conceptSlug, synthesisMode, branchContext.branchId, branchContext.fromSlug, branchContext.rootSlug, markBranchStatus]);

  useEffect(() => {
    if (!conceptSlug || synthesisMode !== 'queued' || !data?.pending) return;
    const timer = window.setInterval(async () => {
      try {
        setQueueActivity('status');
        const pendingRes = await fetch('/api/dossier/pending?mode=queued', { cache: 'no-store' });
        const pendingBody = (await pendingRes.json()) as { pending?: Array<unknown> };
        const hasPending = (pendingBody.pending?.length ?? 0) > 0;
        if (hasPending) {
          setQueueActivity('generating');
          await fetch('/api/queue/process?mode=queued&limit=1', { method: 'POST' });
        } else {
          setQueueActivity('idle');
        }
        const res = await fetch(buildDossierUrl(conceptSlug, synthesisMode, branchContext));
        const next = (await res.json()) as DossierData;
        setData(next);
        markBranchStatus(conceptSlug, next.pending || next.blocked ? 'pending' : 'ready');
      } catch {
        setQueueActivity('idle');
      }
    }, 4000);
    return () => {
      setQueueActivity('idle');
      window.clearInterval(timer);
    };
  }, [conceptSlug, synthesisMode, data?.pending, branchContext.branchId, branchContext.fromSlug, branchContext.rootSlug, markBranchStatus]);

  if (!conceptSlug) return null;

  const concept = data?.concept;
  const typeColor = concept ? TYPE_COLORS[concept.type] ?? '#888' : '#888';
  const targetName = concept?.name ?? humanizeSlug(conceptSlug);
  const branchContextName = branchContext.fromSlug ? humanizeSlug(branchContext.fromSlug) : null;
  const currentEvidence = (data?.evidence ?? []).filter((row) =>
    ['canon', 'working', 'active'].includes(row.doc_status)
  );
  const historicalEvidence = (data?.evidence ?? []).filter(
    (row) => !['canon', 'working', 'active'].includes(row.doc_status)
  );

  async function onCandidateClick(phrase: string) {
    if (!conceptSlug) return;
    setQueuingPhrase(phrase);
    try {
      const res = await fetch('/api/dossier/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase, contextSlug: conceptSlug }),
      });
      const body = await res.json();
      if (body.slug) {
        openConcept(body.slug, {
          branch: 'current',
          source: 'candidate',
          label: body.name,
          spawnSuggestion: true,
        });
      }
    } finally {
      setQueuingPhrase(null);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '48vw',
        maxWidth: 720,
        minWidth: 420,
        height: '100vh',
        background: '#0d0d0d',
        borderLeft: `1px solid #1a1a1a`,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        boxShadow: '-24px 0 40px rgba(0,0,0,0.5)',
      }}
      className="thin-scrollbar"
    >
      <div
        style={{
          padding: '20px 28px 18px',
          borderBottom: '1px solid #161616',
          borderLeft: `3px solid ${typeColor}`,
          position: 'sticky',
          top: 0,
          background: '#0d0d0d',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <button
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              color: '#555',
              cursor: 'pointer',
              fontSize: '0.65rem',
              letterSpacing: '0.14em',
              padding: 0,
            }}
          >
            ← CLOSE DOSSIER
          </button>
          <span
            style={{
              fontSize: '0.55rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: typeColor,
            }}
          >
            {concept?.type ?? ''}
          </span>
        </div>
        <h2
          style={{
            fontSize: '2.3rem',
            fontWeight: 200,
            letterSpacing: '-0.02em',
            margin: '4px 0 6px',
            lineHeight: 1,
          }}
        >
          {targetName}
        </h2>
        {concept && (
          <div style={{ display: 'flex', gap: 18, marginTop: 10 }}>
            <Stat label="MENTIONS" value={concept.mention_count} color="#888" />
            <Stat label="IN CANON" value={concept.canon_docs} color="#00d68f" />
            <Stat label="IN WORKING" value={concept.working_docs} color="#f6c90e" />
            <Stat label="TOTAL DOCS" value={concept.document_count} color="#888" />
          </div>
        )}
      </div>

      <div style={{ padding: '22px 28px 36px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {loading && (
          <LoadingState
            name={targetName}
            accent={typeColor}
            mode={synthesisMode}
            branchContextName={branchContextName}
          />
        )}

        {!loading && data?.paragraph && (
          <section>
            <SectionHeader label="SYNTHESIS" accent={typeColor} />
            <ParagraphView
              paragraph={data.paragraph}
              onKnown={(slug) => openConcept(slug, { branch: 'current', source: 'known' })}
              onCandidate={onCandidateClick}
              queuingPhrase={queuingPhrase}
            />
            {data.generator && (
              <div style={{ marginTop: 14, fontSize: '0.55rem', color: '#333', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                {data.profile ?? synthesisMode} · generated by {data.generator}
                {data.model ? ` · ${data.model}` : ''}
              </div>
            )}
          </section>
        )}

        {!loading && data?.pending && (
          <PendingBanner
            name={targetName}
            error={data.error}
            onRetry={() => {
              if (!conceptSlug) return;
              setLoading(true);
              fetch(`${buildDossierUrl(conceptSlug, synthesisMode, branchContext)}&t=${Date.now()}`)
                .then((r) => r.json())
                .then((d) => {
                  setData(d);
                  markBranchStatus(conceptSlug, d.pending || d.blocked ? 'pending' : 'ready');
                })
                .finally(() => setLoading(false));
            }}
            mode={synthesisMode}
            queueActivity={queueActivity}
          />
        )}

        {!loading && data?.blocked && (
          <PendingBanner
            name={targetName}
            error={data.error}
            onRetry={() => {
              if (!conceptSlug) return;
              setLoading(true);
              fetch(`${buildDossierUrl(conceptSlug, synthesisMode, branchContext)}&t=${Date.now()}`)
                .then((r) => r.json())
                .then((d) => {
                  setData(d);
                  markBranchStatus(conceptSlug, d.pending || d.blocked ? 'pending' : 'ready');
                })
                .finally(() => setLoading(false));
            }}
            mode={synthesisMode}
            queueActivity={queueActivity}
          />
        )}

        {!loading && data?.related && data.related.length > 0 && (
          <section>
            <SectionHeader label="RELATED CONCEPTS" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.related.map((r) => (
                <button
                  key={r.slug}
                  onClick={() => openConcept(r.slug, { branch: 'current', source: 'related', label: r.name })}
                  style={{
                    background: '#111',
                    border: '1px solid #1e1e1e',
                    borderLeft: `2px solid ${TYPE_COLORS[r.type] ?? '#666'}`,
                    padding: '6px 12px',
                    color: '#ccc',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {r.name}
                  <span style={{ color: '#555', marginLeft: 8, fontSize: '0.65rem' }}>
                    {r.document_count}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {!loading && currentEvidence.length > 0 && (
          <section>
            <SectionHeader label="CURRENT GROUNDING" accent="#00d68f" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {currentEvidence.map((m, i) => (
                <EvidenceCard key={`${m.doc_id}-${i}`} row={m} onOpen={openDoc} />
              ))}
            </div>
          </section>
        )}

        {!loading && historicalEvidence.length > 0 && (
          <section>
            <button
              onClick={() => setShowEvidence((v) => !v)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: '#555',
                fontSize: '0.6rem',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              {showEvidence ? '▾' : '▸'} history / archive context ({historicalEvidence.length})
            </button>
            {showEvidence && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {historicalEvidence.map((m, i) => (
                  <EvidenceCard key={`${m.doc_id}-${i}`} row={m} onOpen={openDoc} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ParagraphView({
  paragraph,
  onKnown,
  onCandidate,
  queuingPhrase,
}: {
  paragraph: Span[];
  onKnown: (slug: string) => void;
  onCandidate: (phrase: string) => void;
  queuingPhrase: string | null;
}) {
  return (
    <p
      style={{
        fontSize: '1rem',
        lineHeight: 1.7,
        color: '#e4e4e4',
        margin: 0,
        fontWeight: 300,
        letterSpacing: '0.005em',
      }}
    >
      {paragraph.map((span, i) => {
        if (!('ref' in span)) {
          return (
            <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
              {span.text}
            </span>
          );
        }
        const isCandidate = span.kind === 'candidate';
        const isQueuing = queuingPhrase === span.text;
        return (
          <button
            key={i}
            onClick={() =>
              isCandidate ? onCandidate(span.text) : onKnown(span.ref)
            }
            disabled={isQueuing}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              margin: 0,
              color: isCandidate ? LINK_COLORS.candidate : LINK_COLORS.known,
              borderBottom: `1px ${isCandidate ? 'dashed' : 'solid'} currentColor`,
              cursor: isQueuing ? 'wait' : 'pointer',
              font: 'inherit',
              lineHeight: 1.7,
              opacity: isQueuing ? 0.5 : 1,
            }}
            title={
              isCandidate
                ? `Surface "${span.text}" as a new concept`
                : `Open dossier: ${span.ref}`
            }
          >
            {span.text}
          </button>
        );
      })}
    </p>
  );
}

function PendingBanner({
  name,
  error,
  onRetry,
  mode,
  queueActivity,
}: {
  name: string;
  error?: DossierError;
  onRetry: () => void;
  mode: 'live' | 'queued';
  queueActivity: 'idle' | 'status' | 'generating';
}) {
  const isAuth = error?.code === 'not-logged-in';
  const isMissing = error?.code === 'not-installed';
  const headline = isAuth
    ? 'CURSOR AGENT NOT LOGGED IN'
    : isMissing
      ? 'CURSOR AGENT NOT INSTALLED'
      : mode === 'queued'
        ? 'QUEUED FOR SYNTHESIS'
      : 'SYNTHESIS UNAVAILABLE';
  const body = isAuth ? (
    <>
      The live synthesis path uses the Cursor Agent CLI on your machine. Run{' '}
      <code style={{ color: '#00b4d8' }}>cursor-agent login</code> in a terminal, then retry.
    </>
  ) : isMissing ? (
    <>
      Install the CLI with{' '}
      <code style={{ color: '#00b4d8' }}>curl https://cursor.com/install -fsS | bash</code>, log
      in, then retry.
    </>
  ) : (
    <>
      {mode === 'queued' ? (
        <>
          <strong style={{ color: '#eee' }}>{name}</strong> is in the queued synthesis lane. The
          preview will keep processing it automatically in the background while evidence stays
          visible below.{' '}
          <span style={{ color: '#666' }}>
            {queueActivity === 'generating'
              ? 'Background generation is active now.'
              : queueActivity === 'status'
                ? 'Checking queue status.'
                : 'Waiting for queued work.'}
          </span>
        </>
      ) : (
        <>
          Couldn&apos;t generate a paragraph for <strong style={{ color: '#eee' }}>{name}</strong>
          {error?.message ? (
            <>
              {' '}
              (<span style={{ color: '#e74c9b' }}>{error.message}</span>)
            </>
          ) : null}
          . Evidence from the archive is shown below in the meantime.
        </>
      )}
    </>
  );
  return (
    <div
      style={{
        padding: '16px 18px',
        background: '#0f0f0f',
        border: '1px dashed #2a2a2a',
        color: '#aaa',
        fontSize: '0.82rem',
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          color: '#e74c9b',
          fontSize: '0.55rem',
          letterSpacing: '0.18em',
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        {headline}
      </div>
      <div>{body}</div>
      <button
        onClick={onRetry}
        style={{
          marginTop: 12,
          background: 'transparent',
          border: '1px solid #333',
          color: '#eee',
          padding: '6px 14px',
          fontSize: '0.65rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        retry synthesis
      </button>
    </div>
  );
}

function LoadingState({
  name,
  accent,
  mode,
  branchContextName,
}: {
  name: string;
  accent: string;
  mode: 'live' | 'queued';
  branchContextName: string | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          color: accent,
          fontSize: '0.55rem',
          letterSpacing: '0.18em',
          fontWeight: 700,
        }}
      >
        SYNTHESIZING…
      </div>
      <div style={{ color: '#777', fontSize: '0.82rem', lineHeight: 1.6 }}>
        {mode === 'queued' ? (
          <>
            Queueing <strong style={{ color: '#ccc' }}>{name}</strong> for the slower quality lane.
            {branchContextName ? (
              <> Using branch context from <strong style={{ color: '#ccc' }}>{branchContextName}</strong>.</>
            ) : null}{' '}
            The preview will process pending dossiers automatically and cache the result when it is
            ready.
          </>
        ) : (
          <>
            Generating a dossier for <strong style={{ color: '#ccc' }}>{name}</strong>
            {branchContextName ? (
              <> using branch context from <strong style={{ color: '#ccc' }}>{branchContextName}</strong></>
            ) : null}
            . Bird Brain is grounding the paragraph in current project evidence, then asking the
            Cursor agent to write the hypertext summary. First open of a concept can take 10–30s;
            the result is cached afterwards.
          </>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginTop: 2,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              background: accent,
              opacity: 0.25,
              animation: `bb-pulse 1.1s ${i * 0.15}s infinite ease-in-out`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes bb-pulse {
          0%, 100% { opacity: 0.2; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </div>
  );
}

function buildDossierUrl(
  slug: string,
  mode: 'live' | 'queued',
  branchContext: { branchId: string | null; rootSlug: string | null; fromSlug: string | null }
) {
  const params = new URLSearchParams({ mode });
  if (branchContext.fromSlug) params.set('from', branchContext.fromSlug);
  if (branchContext.rootSlug) params.set('root', branchContext.rootSlug);
  if (branchContext.branchId) params.set('branch', branchContext.branchId);
  return `/api/dossier/${slug}?${params.toString()}`;
}

function EvidenceCard({
  row,
  onOpen,
}: {
  row: EvidenceRow;
  onOpen: (docId: number) => void;
}) {
  return (
    <button
      onClick={() => onOpen(row.doc_id)}
      style={{
        textAlign: 'left',
        background: '#101010',
        border: '1px solid #181818',
        borderLeft: `2px solid ${STATUS_COLORS[row.doc_status] ?? '#666'}`,
        padding: '10px 14px',
        cursor: 'pointer',
        color: '#ccc',
      }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: '0.78rem', color: '#eee' }}>{row.doc_title}</span>
        {row.heading && <span style={{ fontSize: '0.68rem', color: '#555' }}>§ {row.heading}</span>}
      </div>
      <div style={{ fontSize: '0.56rem', color: STATUS_COLORS[row.doc_status] ?? '#666', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 }}>
        {row.doc_status}
      </div>
      <div style={{ fontSize: '0.7rem', color: '#777', lineHeight: 1.5 }}>{row.body.slice(0, 220)}</div>
    </button>
  );
}

function humanizeSlug(slug: string | null) {
  if (!slug) return '';
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.15rem', fontWeight: 200, color }}>{value}</div>
      <div style={{ fontSize: '0.52rem', letterSpacing: '0.16em', color: '#555', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function SectionHeader({ label, accent = '#888' }: { label: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
      <span
        style={{
          fontSize: '0.6rem',
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: accent,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: '#181818' }} />
    </div>
  );
}
