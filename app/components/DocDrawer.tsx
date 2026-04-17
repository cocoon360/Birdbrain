'use client';

import { useEffect, useState } from 'react';
import { StatusBadge } from './StatusBadge';
import { useDossier } from './DossierContext';

interface Chunk {
  id: number;
  heading: string | null;
  body: string;
  chunk_index: number;
  word_count: number;
}

interface DocFull {
  id: number;
  title: string;
  status: string;
  category: string;
  path: string;
  file_mtime: number;
  word_count: number;
}

interface DocMention {
  entity_slug: string;
  entity_name: string;
  match_count: number;
}

export function DocDrawer() {
  const { docId, openConcept, close } = useDossier();
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [mentions, setMentions] = useState<DocMention[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!docId) {
      setDoc(null);
      setChunks([]);
      setMentions([]);
      return;
    }
    setLoading(true);
    fetch(`/api/documents/${docId}`)
      .then((r) => r.json())
      .then((data) => {
        setDoc(data.document);
        setChunks(data.chunks ?? []);
        setMentions(data.mentions ?? []);
      })
      .finally(() => setLoading(false));
  }, [docId]);

  if (!docId) return null;

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
        borderLeft: '1px solid #1a1a1a',
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
          padding: '20px 28px 16px',
          borderBottom: '1px solid #161616',
          position: 'sticky',
          top: 0,
          background: '#0d0d0d',
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            marginBottom: 10,
          }}
        >
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
            ← CLOSE DOCUMENT
          </button>
          {doc && <StatusBadge status={doc.status} />}
        </div>

        {loading && <div style={{ color: '#444', fontSize: '0.8rem' }}>Loading…</div>}
        {doc && (
          <>
            <h2
              style={{
                fontSize: '1.7rem',
                fontWeight: 200,
                letterSpacing: '-0.01em',
                margin: '0 0 8px',
                lineHeight: 1.15,
              }}
            >
              {doc.title}
            </h2>
            <div style={{ fontSize: '0.62rem', color: '#444', letterSpacing: '0.04em' }}>
              {doc.path}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                marginTop: 8,
                fontSize: '0.62rem',
                color: '#555',
              }}
            >
              <span style={{ letterSpacing: '0.12em' }}>{doc.category.toUpperCase()}</span>
              <span>·</span>
              <span>{doc.word_count.toLocaleString()} words</span>
              <span>·</span>
              <span>
                {new Date(doc.file_mtime * 1000).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>

            {mentions.length > 0 && (
              <div style={{ marginTop: 14 }}>
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
                  Concepts in this document
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {mentions.map((m) => (
                    <button
                      key={m.entity_slug}
                      onClick={() => openConcept(m.entity_slug)}
                      style={{
                        background: '#111',
                        border: '1px solid #1e1e1e',
                        padding: '4px 9px',
                        color: '#00b4d8',
                        fontSize: '0.68rem',
                        cursor: 'pointer',
                      }}
                    >
                      {m.entity_name}
                      <span style={{ color: '#444', marginLeft: 6 }}>×{m.match_count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '18px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {chunks.map((chunk) => (
          <div key={chunk.id}>
            {chunk.heading && (
              <h3
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: '#00b4d8',
                  margin: '0 0 8px',
                }}
              >
                {chunk.heading}
              </h3>
            )}
            <p
              style={{
                fontSize: '0.8rem',
                color: '#ccc',
                lineHeight: 1.65,
                margin: 0,
                whiteSpace: 'pre-wrap',
              }}
            >
              {chunk.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
