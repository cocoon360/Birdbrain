'use client';

import { useEffect, useState } from 'react';
import { useDossier } from '../DossierContext';
import { documentStatusBadgeLabel } from '@/lib/ui/semantic';

interface SearchResult {
  chunk_id: number;
  document_id: number;
  doc_title: string;
  doc_path: string;
  doc_status: string;
  doc_category: string;
  heading: string | null;
  snippet: string;
}

const STATUS_COLOR: Record<string, string> = {
  canon: '#00d68f',
  working: '#f6c90e',
  active: '#00b4d8',
  reference: '#4a90d9',
  brainstorm: '#9b59b6',
  archive: '#666',
};

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

export function SearchPanel() {
  const { openDoc } = useDossier();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      const url = new URL('/api/search', window.location.origin);
      url.searchParams.set('q', query.trim());
      if (status) url.searchParams.set('status', status);
      fetch(url.toString())
        .then((r) => r.json())
        .then((data) => {
          setResults(data.results ?? []);
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [query, status]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '32px 48px 32px',
      }}
    >
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>full-text fts5</div>
        <h1 className="metro-title">search</h1>
      </div>

      <div style={{ flexShrink: 0, marginBottom: 14 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every chunk of every document…"
          style={{
            width: '100%',
            background: '#0f0f0f',
            border: '1px solid #1e1e1e',
            color: '#f0f0f0',
            padding: '14px 18px',
            fontSize: '0.95rem',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['', 'canon', 'working', 'active', 'reference', 'brainstorm', 'archive'].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatus(s)}
              style={{
                fontSize: '0.58rem',
                letterSpacing: '0.14em',
                padding: '4px 10px',
                background: status === s ? '#00b4d8' : 'transparent',
                color: status === s ? '#000' : '#777',
                border: `1px solid ${status === s ? '#00b4d8' : '#2a2a2a'}`,
                cursor: 'pointer',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              {documentStatusBadgeLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', paddingRight: 18 }}
        className="thin-scrollbar"
      >
        {loading && (
          <div style={{ color: '#00b4d8', fontSize: '0.75rem', marginBottom: 10 }}>
            Searching…
          </div>
        )}
        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div style={{ color: '#444', fontSize: '0.82rem' }}>No matches.</div>
        )}
        {!query.trim() && (
          <div style={{ color: '#333', fontSize: '0.78rem' }}>
            Start typing. Ranking favors primary-folder and in-progress files, then active and
            reference, then exploratory and older material.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {results.map((r) => {
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
    </div>
  );
}
