'use client';

import { useMemo } from 'react';
import { useDossier } from './DossierContext';

export interface BriefEvidence {
  doc_id: number;
  chunk_id?: number;
  title: string;
  path: string;
  status: string;
  heading: string | null;
  snippet: string;
}

export interface BriefPayload {
  brief: string;
  evidence: BriefEvidence[];
  used_slugs?: string[];
  generated?: boolean;
  model?: string;
}

interface BriefViewProps {
  payload: BriefPayload;
}

function splitCitations(text: string): Array<{ text: string; cite?: number }> {
  const parts: Array<{ text: string; cite?: number }> = [];
  const regex = /\[(\d+)\]/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ text: text.slice(lastIdx, m.index) });
    }
    parts.push({ text: m[0], cite: Number(m[1]) });
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx) });
  return parts;
}

function renderInline(text: string): React.ReactNode {
  const parts = splitCitations(text);
  return parts.map((part, i) => {
    if (part.cite) {
      return (
        <a
          key={i}
          href={`#evidence-${part.cite}`}
          style={{ color: '#00b4d8', textDecoration: 'none', fontWeight: 600 }}
          onClick={(e) => {
            e.preventDefault();
            const el = document.getElementById(`evidence-${part.cite}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.animate(
              [{ background: 'rgba(0,180,216,0.18)' }, { background: 'transparent' }],
              { duration: 900 }
            );
          }}
        >
          {part.text}
        </a>
      );
    }
    // Handle inline bold **x**
    const segs = part.text.split(/(\*\*[^*]+\*\*)/g);
    return segs.map((seg, j) => {
      if (/^\*\*.+\*\*$/.test(seg)) {
        return (
          <strong key={`${i}-${j}`} style={{ color: '#fff', fontWeight: 600 }}>
            {seg.slice(2, -2)}
          </strong>
        );
      }
      const codeSegs = seg.split(/(`[^`]+`)/g);
      return codeSegs.map((c, k) => {
        if (/^`[^`]+`$/.test(c)) {
          return (
            <code
              key={`${i}-${j}-${k}`}
              style={{
                fontSize: '0.72rem',
                background: '#0f0f0f',
                padding: '1px 5px',
                border: '1px solid #222',
                color: '#ccc',
              }}
            >
              {c.slice(1, -1)}
            </code>
          );
        }
        return <span key={`${i}-${j}-${k}`}>{c}</span>;
      });
    });
  });
}

function renderBriefLines(brief: string): React.ReactNode[] {
  const lines = brief.split('\n');
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = (keyPrefix: string) => {
    if (!bullets.length) return;
    out.push(
      <ul key={keyPrefix} style={{ margin: '4px 0 12px', paddingLeft: 18, listStyle: 'square' }}>
        {bullets.map((b, i) => (
          <li
            key={i}
            style={{ fontSize: '0.85rem', lineHeight: 1.65, color: '#ccc', marginBottom: 4 }}
          >
            {renderInline(b)}
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/\s+$/, '');
    const key = `line-${idx}`;

    if (/^\s*[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*]\s+/, ''));
      return;
    }
    flushBullets(`bullets-${idx}`);

    if (!line.trim()) {
      out.push(<div key={key} style={{ height: 6 }} />);
      return;
    }

    if (line.startsWith('# ')) {
      out.push(
        <h2
          key={key}
          style={{
            fontSize: '1.2rem',
            fontWeight: 300,
            letterSpacing: '-0.01em',
            margin: '8px 0 10px',
            color: '#fff',
          }}
        >
          {renderInline(line.slice(2))}
        </h2>
      );
      return;
    }
    if (line.startsWith('## ')) {
      out.push(
        <h3
          key={key}
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            margin: '14px 0 8px',
            color: '#00b4d8',
          }}
        >
          {renderInline(line.slice(3))}
        </h3>
      );
      return;
    }
    if (line === '---' || /^---+$/.test(line)) {
      out.push(<div key={key} style={{ borderTop: '1px solid #1a1a1a', margin: '10px 0' }} />);
      return;
    }
    if (line.startsWith('> ')) {
      out.push(
        <blockquote
          key={key}
          style={{
            borderLeft: '2px solid #2a2a2a',
            margin: '4px 0 8px',
            padding: '2px 0 2px 12px',
            color: '#999',
            fontSize: '0.8rem',
            lineHeight: 1.6,
          }}
        >
          {renderInline(line.slice(2))}
        </blockquote>
      );
      return;
    }
    out.push(
      <p
        key={key}
        style={{ fontSize: '0.85rem', lineHeight: 1.7, color: '#ccc', margin: '0 0 8px' }}
      >
        {renderInline(line)}
      </p>
    );
  });

  flushBullets('bullets-final');
  return out;
}

const STATUS_COLOR: Record<string, string> = {
  canon: '#00d68f',
  working: '#f6c90e',
  active: '#00b4d8',
  archive: '#666',
  brainstorm: '#9b59b6',
  reference: '#4a90d9',
};

export function BriefView({ payload }: BriefViewProps) {
  const { openDoc } = useDossier();
  const nodes = useMemo(() => renderBriefLines(payload.brief), [payload.brief]);

  return (
    <div>
      <div
        style={{
          fontFamily: "'Segoe UI', Inter, sans-serif",
          color: '#ccc',
          marginBottom: 22,
        }}
      >
        {nodes}
      </div>

      {payload.evidence.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '0.6rem',
              fontWeight: 600,
              letterSpacing: '0.16em',
              color: '#555',
              margin: '6px 0 10px',
              textTransform: 'uppercase',
            }}
          >
            Evidence ({payload.evidence.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {payload.evidence.map((ev, i) => {
              const color = STATUS_COLOR[ev.status] ?? '#666';
              return (
                <div
                  id={`evidence-${i + 1}`}
                  key={`${ev.doc_id}-${i}`}
                  style={{
                    padding: '10px 12px',
                    background: '#0f0f0f',
                    border: '1px solid #1a1a1a',
                    borderLeft: `2px solid ${color}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.58rem',
                        color: '#666',
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                      }}
                    >
                      [{i + 1}]
                    </span>
                    <button
                      onClick={() => openDoc(ev.doc_id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#00b4d8',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.8rem',
                        fontWeight: 500,
                      }}
                    >
                      {ev.title}
                    </button>
                    {ev.heading && (
                      <span style={{ fontSize: '0.7rem', color: '#555' }}>§ {ev.heading}</span>
                    )}
                    <span
                      style={{
                        fontSize: '0.55rem',
                        letterSpacing: '0.1em',
                        color,
                        marginLeft: 'auto',
                        textTransform: 'uppercase',
                      }}
                    >
                      {ev.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#aaa', lineHeight: 1.55 }}>
                    {ev.snippet}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {payload.model && (
        <div
          style={{
            marginTop: 14,
            fontSize: '0.55rem',
            color: '#333',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Synthesized by {payload.model}
        </div>
      )}
    </div>
  );
}
