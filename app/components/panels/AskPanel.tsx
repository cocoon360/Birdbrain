'use client';

import { useEffect, useState } from 'react';
import { BriefView, type BriefPayload } from '../BriefView';
import { useDossier } from '../DossierContext';

interface Concept {
  slug: string;
  name: string;
  type: string;
}

// Build example questions dynamically from whatever concepts the corpus has
// produced, so the UI is project-agnostic. We generate one "list all of type"
// prompt plus one concept-specific prompt per distinct type, up to 4 total.
function buildExamples(concepts: Concept[]): string[] {
  if (!concepts.length) return [];
  const byType = new Map<string, Concept[]>();
  for (const c of concepts) {
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type)!.push(c);
  }

  const examples: string[] = [];
  const typeOrder = Array.from(byType.keys()).sort((a, b) => {
    return (byType.get(b)?.length ?? 0) - (byType.get(a)?.length ?? 0);
  });

  for (const type of typeOrder) {
    const bucket = byType.get(type)!;
    if (bucket.length >= 2) examples.push(`List all ${type}s.`);
    if (examples.length >= 4) break;
    if (bucket[0]) examples.push(`What does the corpus say about ${bucket[0].name}?`);
    if (examples.length >= 4) break;
  }
  return examples.slice(0, 4);
}

export function AskPanel() {
  const { openConcept } = useDossier();
  const [query, setQuery] = useState('');
  const [payload, setPayload] = useState<BriefPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [examples, setExamples] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/concepts')
      .then((r) => r.json())
      .then((data) => setExamples(buildExamples(data.concepts ?? [])))
      .catch(() => setExamples([]));
  }, []);

  async function ask(q?: string) {
    const finalQ = (q ?? query).trim();
    if (!finalQ) {
      setError('Enter a question.');
      return;
    }
    setQuery(finalQ);
    setLoading(true);
    setError('');
    setPayload(null);
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: finalQ }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setPayload(data);
    } catch {
      setError('Request failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="metro-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>retrieval first</div>
        <h1 className="metro-title">ask</h1>
        <p className="metro-lead" style={{ maxWidth: 540 }}>
          Ask anything. Bird Brain pulls the most relevant chunks first (ranking favors primary-folder
          and in-progress material), then either answers deterministically (typed lists, etc.) or
          synthesizes with the configured model. Every claim is cited to a real ingested file.
        </p>
      </div>

      <div style={{ flexShrink: 0, marginBottom: 14 }}>
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
            disabled={loading}
            style={{
              background: loading ? 'var(--surface-2)' : 'var(--accent)',
              color: loading ? 'var(--text-muted)' : '#041015',
              border: 'none',
              borderLeft: '1px solid var(--border)',
              padding: '0 22px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              cursor: loading ? 'wait' : 'pointer',
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            {loading ? '…' : 'Ask'}
          </button>
        </div>
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
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
        {error && (
          <div style={{ marginTop: 8, fontSize: 14, color: '#e74c3c' }}>{error}</div>
        )}
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', paddingRight: 18 }}
        className="thin-scrollbar"
      >
        {!payload && !loading && (
          <div style={{ color: '#2a2a2a', fontSize: '0.85rem', lineHeight: 1.8, marginTop: 20 }}>
            <div style={{ color: '#444' }}>Ready.</div>
            <div style={{ fontSize: '0.72rem', color: '#333', marginTop: 6 }}>
              Type a question above or tap an example chip.
            </div>
          </div>
        )}

        {loading && (
          <div style={{ color: '#00b4d8', fontSize: '0.82rem', marginTop: 20 }}>
            Retrieving & synthesizing…
          </div>
        )}

        {payload && (
          <div style={{ paddingRight: 8 }}>
            {payload.used_slugs && payload.used_slugs.length > 0 && (
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
                  {payload.used_slugs.map((slug) => (
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
            <BriefView payload={payload} />
          </div>
        )}
      </div>
    </div>
  );
}
