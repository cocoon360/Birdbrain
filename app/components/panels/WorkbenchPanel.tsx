'use client';

import { useEffect, useState } from 'react';
import { BriefView, type BriefPayload } from '../BriefView';
import { useDossier } from '../DossierContext';
import { documentStatusBadgeLabel } from '@/lib/ui/semantic';

interface SearchResult {
  chunk_id: number;
  document_id: number;
  doc_title: string;
  doc_path: string;
  doc_status: string;
  doc_source_kind?: string;
  heading: string | null;
  snippet: string;
}

const KIND_LABEL: Record<string, string> = {
  markdown: 'MD',
  text: 'TXT',
  svg: 'SVG',
  html: 'HTML',
  code: 'CODE',
};

const KIND_COLOR: Record<string, string> = {
  markdown: '#00b4d8',
  text: '#e7b24c',
  svg: '#b48cff',
  html: '#f06292',
  code: '#7cb342',
};

interface Concept {
  slug: string;
  name: string;
  type: string;
}

const STATUS_COLOR: Record<string, string> = {
  canon: '#00d68f',
  working: '#f6c90e',
  active: '#00b4d8',
  reference: '#4a90d9',
  brainstorm: '#9b59b6',
  archive: '#666',
};

function buildExamples(concepts: Concept[]): string[] {
  if (!concepts.length) return [];
  const byType = new Map<string, Concept[]>();
  for (const c of concepts) {
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type)!.push(c);
  }

  const examples: string[] = [];
  const typeOrder = Array.from(byType.keys()).sort(
    (a, b) => (byType.get(b)?.length ?? 0) - (byType.get(a)?.length ?? 0)
  );

  for (const type of typeOrder) {
    const bucket = byType.get(type)!;
    if (bucket.length >= 2) examples.push(`List all ${type}s.`);
    if (examples.length >= 4) break;
    if (bucket[0]) examples.push(`What do the files say about ${bucket[0].name}?`);
    if (examples.length >= 4) break;
  }
  return examples.slice(0, 4);
}

function renderSnippet(snippet: string): React.ReactNode {
  const parts = snippet.split(/(<mark>[^<]*<\/mark>)/g);
  return parts.map((p, i) => {
    const m = p.match(/^<mark>([^<]*)<\/mark>$/);
    if (m) {
      return (
        <mark
          key={i}
          style={{ background: 'rgba(0,180,216,0.25)', color: '#00d8ff', padding: '0 2px' }}
        >
          {m[1]}
        </mark>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function WorkbenchPanel() {
  const { openDoc, openConcept } = useDossier();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [askQuery, setAskQuery] = useState('');
  const [askPayload, setAskPayload] = useState<BriefPayload | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState('');
  const [examples, setExamples] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/concepts')
      .then((r) => r.json())
      .then((data) => setExamples(buildExamples(data.concepts ?? [])))
      .catch(() => setExamples([]));
  }, []);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      const url = new URL('/api/search', window.location.origin);
      url.searchParams.set('q', searchQuery.trim());
      if (searchStatus) url.searchParams.set('status', searchStatus);
      fetch(url.toString())
        .then((r) => r.json())
        .then((data) => setSearchResults(data.results ?? []))
        .finally(() => setSearchLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchQuery, searchStatus]);

  async function ask(q?: string) {
    const finalQ = (q ?? askQuery).trim();
    if (!finalQ) {
      setAskError('Enter a question.');
      return;
    }
    setAskQuery(finalQ);
    setAskLoading(true);
    setAskError('');
    setAskPayload(null);
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: finalQ }),
      });
      const data = await res.json();
      if (data.error) setAskError(data.error);
      else setAskPayload(data);
    } catch {
      setAskError('Request failed.');
    } finally {
      setAskLoading(false);
    }
  }

  return (
    <div className="metro-panel thin-scrollbar" style={{ height: '100%', overflowY: 'auto', paddingBottom: 40 }}>
      <div style={{ marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>
          search + answers
        </div>
        <h1 className="metro-title">workbench</h1>
        <p className="metro-lead">
          Use the top bar to search the files and the second bar to ask Bird Brain questions.
          Search stays predictable; asking pulls evidence first, then writes an answer or returns
          a grounded fallback.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
        <div className="metro-surface" style={{ padding: '14px 16px' }}>
          <div className="metro-subtitle" style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
            file search
          </div>
          <input
            className="metro-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search every chunk of every document…"
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {['', 'canon', 'working', 'active', 'reference', 'brainstorm', 'archive'].map((status) => (
              <button
                key={status || 'all'}
                type="button"
                onClick={() => setSearchStatus(status)}
                style={{
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  padding: '6px 10px',
                  background: 'transparent',
                  color: searchStatus === status ? 'var(--accent)' : 'var(--text-dim)',
                  border: '1px solid var(--border)',
                  borderBottomWidth: searchStatus === status ? 3 : 1,
                  borderBottomColor: searchStatus === status ? 'var(--accent)' : 'var(--border)',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  transition: 'border-color 150ms ease-out, color 150ms ease-out',
                }}
              >
                {documentStatusBadgeLabel(status)}
              </button>
            ))}
          </div>
        </div>

        <div className="metro-surface" style={{ padding: '14px 16px' }}>
          <div className="metro-subtitle" style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
            question / answer
          </div>
          <div
            style={{
              display: 'flex',
              gap: 0,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
            }}
          >
            <input
              className="metro-input"
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ask();
              }}
              placeholder="Ask Bird Brain about your project…"
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 0,
              }}
            />
            <button
              type="button"
              onClick={() => ask()}
              disabled={askLoading}
              style={{
                background: askLoading ? 'var(--surface-2)' : 'var(--accent)',
                color: askLoading ? 'var(--text-muted)' : '#041015',
                border: 'none',
                borderLeft: '1px solid var(--border)',
                padding: '0 22px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                cursor: askLoading ? 'wait' : 'pointer',
                textTransform: 'uppercase',
                flexShrink: 0,
              }}
            >
              {askLoading ? '…' : 'Ask'}
            </button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {examples.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => ask(q)}
                style={{
                  fontSize: 13,
                  color: 'var(--text-dim)',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  padding: '5px 10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {q}
              </button>
            ))}
          </div>
          {askError && (
            <div style={{ marginTop: 8, fontSize: 14, color: '#e74c3c' }}>{askError}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        <div>
          <SectionHeader title="retrieval results" accent="#00b4d8" />
          {searchLoading && (
            <div style={{ color: '#00b4d8', fontSize: '0.75rem', marginBottom: 10 }}>Searching…</div>
          )}
          {!searchLoading && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <div style={{ color: '#444', fontSize: '0.82rem' }}>No matches.</div>
          )}
          {!searchQuery.trim() && (
            <div style={{ color: '#333', fontSize: '0.78rem' }}>
              Start typing. Ranking favors primary-folder and in-progress documents over reference,
              exploratory, and older paths. Folder names map each file to a status bucket.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searchResults.map((r) => {
              const color = STATUS_COLOR[r.doc_status] ?? '#666';
              const kind = r.doc_source_kind ?? 'markdown';
              const showKindPill = kind !== 'markdown';
              const kindLabel = KIND_LABEL[kind] ?? kind.toUpperCase();
              const kindColor = KIND_COLOR[kind] ?? '#888';
              return (
                <button
                  key={r.chunk_id}
                  onClick={() => openDoc(r.document_id)}
                  style={{
                    textAlign: 'left',
                    background: '#0f0f0f',
                    border: '1px solid #181818',
                    borderLeft: `2px solid ${color}`,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    color: '#ddd',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 4,
                      flexWrap: 'wrap',
                    }}
                  >
                    {showKindPill && (
                      <span
                        style={{
                          fontSize: '0.56rem',
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          color: kindColor,
                          border: `1px solid ${kindColor}44`,
                          padding: '2px 6px',
                          fontWeight: 600,
                        }}
                      >
                        {kindLabel}
                      </span>
                    )}
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: '#eee' }}>
                      {r.doc_title}
                    </span>
                    {r.heading && (
                      <span style={{ fontSize: '0.7rem', color: '#555' }}>· {r.heading}</span>
                    )}
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: '0.56rem',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color,
                      }}
                    >
                      {documentStatusBadgeLabel(r.doc_status)}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#aaa', lineHeight: 1.55 }}>
                    {renderSnippet(r.snippet)}
                  </div>
                  <div style={{ fontSize: '0.58rem', color: '#333', marginTop: 4 }}>{r.doc_path}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <SectionHeader title="question output" accent="#f6c90e" />
          {!askPayload && !askLoading && (
            <div style={{ color: '#2a2a2a', fontSize: '0.85rem', lineHeight: 1.8, marginTop: 20 }}>
              <div style={{ color: '#444' }}>Ready.</div>
              <div style={{ fontSize: '0.72rem', color: '#333', marginTop: 6 }}>
                Try summaries, comparisons, or &quot;list all …&quot; style questions grounded in your files.
              </div>
            </div>
          )}
          {askLoading && (
            <div style={{ color: '#00b4d8', fontSize: '0.82rem', marginTop: 20 }}>
              Retrieving & synthesizing…
            </div>
          )}
          {askPayload && (
            <div style={{ paddingRight: 8 }}>
              {askPayload.used_slugs && askPayload.used_slugs.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      fontSize: '0.55rem',
                      letterSpacing: '0.16em',
                      color: '#555',
                      marginBottom: 6,
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    Concepts Detected
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {askPayload.used_slugs.map((slug) => (
                      <button
                        key={slug}
                        onClick={() => openConcept(slug)}
                        style={{
                          background: '#111',
                          border: '1px solid #1e1e1e',
                          padding: '4px 10px',
                          color: '#00b4d8',
                          fontSize: '0.68rem',
                          cursor: 'pointer',
                        }}
                      >
                        {slug}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <BriefView payload={askPayload} />
            </div>
          )}
        </div>
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
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}
