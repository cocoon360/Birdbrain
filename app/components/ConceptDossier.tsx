'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useDossier } from './DossierContext';
import { useOptionalWorkspace } from './WorkspaceProvider';
import { logParticipation } from '../lib/participation/log';
import {
  STATUS_COLORS,
  TYPE_COLORS,
  LINK_COLORS,
  documentStatusBadgeLabel,
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
  details?: string;
}

interface PrecontextData {
  plain_definition: string;
  project_role: string;
  study_relevance: string;
  related_concepts: string[];
  precontext_text: string;
  generated_at: number;
  generator?: string;
  model?: string | null;
}

interface DossierData {
  blocked?: boolean;
  concept: ConceptData;
  precontext: PrecontextData | null;
  pending: boolean;
  pending_stage?: 'precontext' | 'dossier';
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
  const workspace = useOptionalWorkspace();
  const workspaceId = workspace?.id ?? null;
  const [data, setData] = useState<DossierData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [queuingPhrase, setQueuingPhrase] = useState<string | null>(null);
  const [queueActivity, setQueueActivity] = useState<'idle' | 'status' | 'generating'>('idle');
  const [regenerating, setRegenerating] = useState(false);

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
      .then(async (r) => {
        const text = await r.text();
        try {
          return JSON.parse(text) as DossierData;
        } catch {
          throw new Error(
            r.ok ? 'Dossier response was not JSON' : `Dossier request failed (${r.status})`
          );
        }
      })
      .then((d) => {
        setData(d);
        markBranchStatus(conceptSlug, d.pending || d.blocked ? 'pending' : 'ready');
      })
      .catch(() => {
        setData(null);
        markBranchStatus(conceptSlug, 'idle');
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

  // Log every candidate span shown in the current paragraph as an impression.
  // This is what lets candidate_concepts accumulate distinct-session reach
  // even for readers who never click a candidate span.
  // MUST live above the early return so hook order stays stable across renders.
  useEffect(() => {
    if (!data?.paragraph || !conceptSlug) return;
    const seen = new Set<string>();
    for (const span of data.paragraph) {
      if ('ref' in span && span.kind === 'candidate') {
        const key = span.text.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        logParticipation(workspaceId, {
          kind: 'impression',
          phrase: span.text,
          fromSlug: conceptSlug,
          source: 'prose',
        });
      }
    }
  }, [data?.paragraph, conceptSlug, workspaceId]);

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

  async function regenerateDossier() {
    if (!conceptSlug || !data || data.blocked) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/dossier/${encodeURIComponent(conceptSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'regenerate',
          profile: synthesisMode,
          from: branchContext.fromSlug ?? undefined,
          root: branchContext.rootSlug ?? undefined,
          branch: branchContext.branchId ?? undefined,
        }),
      });
      const d = (await res.json()) as DossierData;
      if (d && typeof d === 'object' && 'concept' in d && d.concept) {
        setData(d);
        markBranchStatus(conceptSlug, d.pending || d.blocked ? 'pending' : 'ready');
      }
    } finally {
      setRegenerating(false);
    }
  }

  async function onCandidateClick(phrase: string) {
    if (!conceptSlug) return;
    // Record the click BEFORE navigation so candidate_concepts.clicks bumps
    // even if the /api/dossier/queue promotion roundtrip fails.
    logParticipation(workspaceId, {
      kind: 'promote',
      phrase,
      fromSlug: conceptSlug,
      source: 'prose',
    });
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
            <Stat label="PRIMARY PATHS" value={concept.canon_docs} color="#00d68f" />
            <Stat label="IN PROGRESS" value={concept.working_docs} color="#f6c90e" />
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
            <SectionHeader
              label="SYNTHESIS"
              accent={typeColor}
              actions={
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => copyDossierAsMarkdown(data, targetName)}
                    title="Copy this dossier (paragraph + sources) to the clipboard as Markdown."
                    style={{
                      background: 'transparent',
                      border: '1px solid #2a2a2a',
                      color: '#888',
                      cursor: 'pointer',
                      fontSize: '0.55rem',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      padding: '6px 10px',
                    }}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={() => void regenerateDossier()}
                    disabled={regenerating || data.blocked}
                    title="Clear cached synthesis and run the engine again with current settings and prompts."
                    style={{
                      background: 'transparent',
                      border: '1px solid #2a2a2a',
                      color: regenerating ? '#444' : '#888',
                      cursor: regenerating || data.blocked ? 'not-allowed' : 'pointer',
                      fontSize: '0.55rem',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      padding: '6px 10px',
                    }}
                  >
                    {regenerating ? '…' : 'Regenerate'}
                  </button>
                </div>
              }
            />
            <ParagraphView
              paragraph={data.paragraph}
              onKnown={(slug) => openConcept(slug, { branch: 'current', source: 'known' })}
              onCandidate={onCandidateClick}
              queuingPhrase={queuingPhrase}
            />
            <SourcesStrip evidence={data.evidence} onOpen={openDoc} />
            {data.generator && (
              <div style={{ marginTop: 14, fontSize: '0.55rem', color: '#333', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                {data.profile ?? synthesisMode} · generated by {data.generator}
                {data.model ? ` · ${data.model}` : ''}
              </div>
            )}
          </section>
        )}

        {!loading && data?.pending && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => void regenerateDossier()}
                disabled={regenerating || Boolean(data.blocked)}
                title="Drop cached output and re-queue or re-run synthesis from scratch."
                style={{
                  background: 'transparent',
                  border: '1px solid #2a2a2a',
                  color: regenerating ? '#444' : '#888',
                  cursor: regenerating || data.blocked ? 'not-allowed' : 'pointer',
                  fontSize: '0.55rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  padding: '6px 10px',
                }}
              >
                {regenerating ? '…' : 'Regenerate'}
              </button>
            </div>
            {data.precontext && <PrecontextCard precontext={data.precontext} />}
            <PendingBanner
              name={targetName}
              error={data.error}
              pendingStage={data.pending_stage ?? (data.precontext ? 'dossier' : 'precontext')}
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
          </div>
        )}

        {!loading && data?.blocked && (
          <PendingBanner
            name={targetName}
            error={data.error}
            pendingStage={data.pending_stage ?? (data.precontext ? 'dossier' : 'precontext')}
            onRetry={() => {
              if (!conceptSlug) return;
              setLoading(true);
              fetch(`/api/dossier/${encodeURIComponent(conceptSlug)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'regenerate',
                  profile: synthesisMode,
                  from: branchContext.fromSlug ?? undefined,
                  root: branchContext.rootSlug ?? undefined,
                  branch: branchContext.branchId ?? undefined,
                }),
              })
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
              {showEvidence ? '▾' : '▸'} older and supporting context ({historicalEvidence.length})
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
  pendingStage,
  onRetry,
  mode,
  queueActivity,
}: {
  name: string;
  error?: DossierError;
  pendingStage: 'precontext' | 'dossier';
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
        ? pendingStage === 'precontext'
          ? 'QUEUED FOR PRECONTEXT'
          : 'QUEUED FOR DOSSIER'
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
          <strong style={{ color: '#eee' }}>{name}</strong>{' '}
          {pendingStage === 'precontext'
            ? 'is building its bird’s-eye precontext first.'
            : 'already has precontext and is waiting on the final dossier paragraph.'}{' '}
          The preview will keep processing it automatically in the background while evidence stays
          visible below.{' '}
          <span style={{ color: '#666' }}>
            {queueActivity === 'generating'
              ? pendingStage === 'precontext'
                ? 'Background precontext generation is active now.'
                : 'Background dossier generation is active now.'
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
          . Supporting snippets from the rest of the corpus are shown below in the meantime.
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
      {error?.details && (
        <details style={{ marginTop: 10 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: '0.6rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#666',
              fontWeight: 700,
            }}
          >
            show agent stderr
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: '10px 12px',
              background: '#070707',
              border: '1px solid #1a1a1a',
              color: '#bbb',
              fontSize: '0.72rem',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {error.details}
          </pre>
        </details>
      )}
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

function PrecontextCard({ precontext }: { precontext: PrecontextData }) {
  return (
    <div
      style={{
        background: '#0f0f0f',
        border: '1px solid #1c1c1c',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div
        style={{
          color: '#00b4d8',
          fontSize: '0.55rem',
          letterSpacing: '0.18em',
          fontWeight: 700,
        }}
      >
        PRECONTEXT READY
      </div>
      <div style={{ color: '#d8d8d8', fontSize: '0.9rem', lineHeight: 1.65 }}>{precontext.precontext_text}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <PrecontextLine label="What it is" value={precontext.plain_definition} />
        <PrecontextLine label="What it is here" value={precontext.project_role} />
        <PrecontextLine label="Why it matters" value={precontext.study_relevance} />
      </div>
    </div>
  );
}

function PrecontextLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div
        style={{
          color: '#666',
          fontSize: '0.55rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div style={{ color: '#aaa', fontSize: '0.78rem', lineHeight: 1.6 }}>{value}</div>
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

function SourcesStrip({
  evidence,
  onOpen,
}: {
  evidence: EvidenceRow[];
  onOpen: (docId: number) => void;
}) {
  // Dedupe by doc_id so three mentions of the same doc render as one chip.
  // We keep the first occurrence's status + title because evidence is already
  // ranked upstream (primary/canon first, then working, then archive).
  const seen = new Set<number>();
  const uniqueDocs: { id: number; title: string; status: string }[] = [];
  for (const e of evidence) {
    if (seen.has(e.doc_id)) continue;
    seen.add(e.doc_id);
    uniqueDocs.push({ id: e.doc_id, title: e.doc_title, status: e.doc_status });
  }
  if (uniqueDocs.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 14,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: '0.55rem',
          letterSpacing: '0.18em',
          color: '#555',
          textTransform: 'uppercase',
          fontWeight: 600,
          marginRight: 4,
        }}
      >
        Sources
      </span>
      {uniqueDocs.map((d) => {
        const color = STATUS_COLORS[d.status] ?? '#666';
        return (
          <button
            key={d.id}
            onClick={() => onOpen(d.id)}
            title={`${d.title} · ${documentStatusBadgeLabel(d.status)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#0f0f0f',
              border: '1px solid #1d1d1d',
              padding: '3px 8px',
              color: '#bbb',
              fontSize: '0.7rem',
              cursor: 'pointer',
              maxWidth: 240,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {d.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function spansToPlain(paragraph: Span[] | null | undefined): string {
  if (!paragraph) return '';
  return paragraph
    .map((s) => {
      if ('ref' in s && s.kind === 'known') {
        // Stable cross-dossier link form so exports don't break when the UI changes.
        return `[${s.text}](#/concept/${s.ref})`;
      }
      return s.text;
    })
    .join('');
}

function copyDossierAsMarkdown(data: DossierData, targetName: string) {
  const lines: string[] = [];
  lines.push(`# ${targetName}`);
  if (data.concept?.type) lines.push(`> ${data.concept.type}`);
  lines.push('');
  lines.push(spansToPlain(data.paragraph));
  const seen = new Set<number>();
  const uniqueDocs: { title: string; status: string; heading: string | null }[] = [];
  for (const e of data.evidence ?? []) {
    if (seen.has(e.doc_id)) continue;
    seen.add(e.doc_id);
    uniqueDocs.push({ title: e.doc_title, status: e.doc_status, heading: e.heading });
  }
  if (uniqueDocs.length > 0) {
    lines.push('');
    lines.push('## Sources');
    for (const d of uniqueDocs) {
      const statusLabel = documentStatusBadgeLabel(d.status).toLowerCase();
      const heading = d.heading ? ` — ${d.heading}` : '';
      lines.push(`- **${d.title}**${heading} _(${statusLabel})_`);
    }
  }
  if (data.generator) {
    lines.push('');
    lines.push(
      `_Generated by ${data.generator}${data.model ? ` · ${data.model}` : ''} · profile: ${
        data.profile ?? 'live'
      }_`
    );
  }
  const text = lines.join('\n');
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text);
  }
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
        {row.heading && <span style={{ fontSize: '0.68rem', color: '#555' }}>· {row.heading}</span>}
      </div>
      <div style={{ fontSize: '0.56rem', color: STATUS_COLORS[row.doc_status] ?? '#666', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 }}>
        {documentStatusBadgeLabel(row.doc_status)}
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

function SectionHeader({
  label,
  accent = '#888',
  actions,
}: {
  label: string;
  accent?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 1, minWidth: 120 }}>
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
        <div style={{ flex: 1, height: 1, background: '#181818', minWidth: 24 }} />
      </div>
      {actions}
    </div>
  );
}
