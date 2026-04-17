'use client';

import { useEffect, useState } from 'react';
import { BriefView, type BriefPayload } from '../BriefView';
import { useDossier } from '../DossierContext';

interface SearchResult {
  chunk_id: number;
  document_id: number;
  doc_title: string;
  doc_path: string;
  doc_status: string;
  heading: string | null;
  snippet: string;
}

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
    if (bucket[0]) examples.push(`What is the current canon on ${bucket[0].name}?`);
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
    <div
      style={{ height: '100%', overflowY: 'auto', padding: '32px 48px 48px' }}
      className="thin-scrollbar"
    >
      <div style={{ marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>
          retrieval + synthesis
        </div>
        <h1 className="metro-title">workbench</h1>
        <p
          style={{
            marginTop: 10,
            fontSize: '0.78rem',
            color: '#555',
            maxWidth: 620,
            lineHeight: 1.5,
          }}
        >
          Use the top bar for direct archive retrieval and the second bar for Bird Brain questions.
          Search stays deterministic; asking retrieves evidence first, then synthesizes or returns a
          grounded fallback.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
        <div style={{ background: '#0f0f0f', border: '1px solid #181818', padding: '14px 16px' }}>
          <div style={{ fontSize: '0.58rem', color: '#666', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
            search-style retrieval
          </div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search every chunk of every document…"
            style={{
              width: '100%',
              background: '#0b0b0b',
              border: '1px solid #1e1e1e',
              color: '#f0f0f0',
              padding: '14px 18px',
              fontSize: '0.95rem',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['', 'canon', 'working', 'active', 'reference', 'brainstorm', 'archive'].map((status) => (
              <button
                key={status || 'all'}
                onClick={() => setSearchStatus(status)}
                style={{
                  fontSize: '0.58rem',
                  letterSpacing: '0.14em',
                  padding: '4px 10px',
                  background: searchStatus === status ? '#00b4d8' : 'transparent',
                  color: searchStatus === status ? '#000' : '#777',
                  border: `1px solid ${searchStatus === status ? '#00b4d8' : '#2a2a2a'}`,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                {status || 'all'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: '#0f0f0f', border: '1px solid #181818', padding: '14px 16px' }}>
          <div style={{ fontSize: '0.58rem', color: '#666', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
            question / synthesis
          </div>
          <div style={{ display: 'flex', gap: 0, border: '1px solid #1e1e1e', background: '#0b0b0b' }}>
            <input
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ask();
              }}
              placeholder="Ask Bird Brain about your project…"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: '#f0f0f0',
                padding: '14px 18px',
                fontSize: '0.95rem',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => ask()}
              disabled={askLoading}
              style={{
                background: askLoading ? '#1a1a1a' : '#00b4d8',
                color: askLoading ? '#555' : '#000',
                border: 'none',
                padding: '0 24px',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.16em',
                cursor: askLoading ? 'wait' : 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {askLoading ? '…' : 'Ask'}
            </button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {examples.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                style={{
                  fontSize: '0.68rem',
                  color: '#888',
                  background: 'transparent',
                  border: '1px solid #222',
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                {q}
              </button>
            ))}
          </div>
          {askError && (
            <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#e74c3c' }}>{askError}</div>
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
              Start typing. Results rank canon and working material above older archive context.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searchResults.map((r) => {
              const color = STATUS_COLOR[r.doc_status] ?? '#666';
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
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: '#eee' }}>
                      {r.doc_title}
                    </span>
                    {r.heading && <span style={{ fontSize: '0.7rem', color: '#555' }}>§ {r.heading}</span>}
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: '0.56rem',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color,
                      }}
                    >
                      {r.doc_status}
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
                Ask for current canon, active changes, or lists of concepts.
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
      <div style={{ flex: 1, height: 1, background: '#181818' }} />
    </div>
  );
}
