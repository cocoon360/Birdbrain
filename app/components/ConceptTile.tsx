'use client';

import { useDossier } from './DossierContext';
import { TYPE_COLORS, STATUS_COLORS } from '@/lib/ui/semantic';

interface ConceptTileProps {
  slug: string;
  name: string;
  type: string;
  summary?: string;
  mention_count?: number;
  canon_docs?: number;
  working_docs?: number;
  document_count?: number;
  size?: 'sm' | 'md' | 'lg';
}

export function ConceptTile({
  slug,
  name,
  type,
  summary,
  mention_count = 0,
  canon_docs = 0,
  working_docs = 0,
  document_count = 0,
  size = 'md',
}: ConceptTileProps) {
  const { openConcept } = useDossier();
  const color = TYPE_COLORS[type] ?? '#888';

  const dims =
    size === 'lg'
      ? { minHeight: 160, padding: '18px 20px', titleSize: '1.3rem' }
      : size === 'sm'
        ? { minHeight: 80, padding: '10px 12px', titleSize: '0.82rem' }
        : { minHeight: 120, padding: '14px 16px', titleSize: '1rem' };

  return (
    <button
      onClick={() => openConcept(slug, { branch: 'new', source: 'root', label: name })}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#111',
        border: '1px solid #1e1e1e',
        borderLeft: `3px solid ${color}`,
        color: '#eee',
        textAlign: 'left',
        cursor: 'pointer',
        minHeight: dims.minHeight,
        padding: dims.padding,
        width: '100%',
        transition: 'background 0.1s, border-color 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#161616';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#111';
      }}
    >
      <div>
        <div
          style={{
            fontSize: '0.55rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color,
            marginBottom: 6,
          }}
        >
          {type}
        </div>
        <div
          style={{
            fontSize: dims.titleSize,
            fontWeight: 300,
            letterSpacing: '-0.01em',
            lineHeight: 1.15,
            marginBottom: size === 'sm' ? 0 : 6,
          }}
        >
          {name}
        </div>
        {size !== 'sm' && summary && (
          <div style={{ fontSize: '0.7rem', color: '#666', lineHeight: 1.4 }}>{summary}</div>
        )}
      </div>

      {size !== 'sm' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
          <Pill label="MENTIONS" value={mention_count} color="#888" />
          <Pill label="PRIMARY" value={canon_docs} color={STATUS_COLORS.canon} muted={canon_docs === 0} />
          <Pill label="WORK" value={working_docs} color={STATUS_COLORS.working} muted={working_docs === 0} />
          <span style={{ marginLeft: 'auto', fontSize: '0.55rem', color: '#333' }}>
            {document_count} docs
          </span>
        </div>
      )}
    </button>
  );
}

function Pill({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: number;
  color: string;
  muted?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <div
        style={{
          fontSize: '0.95rem',
          fontWeight: 300,
          color: muted ? '#333' : color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.5rem',
          letterSpacing: '0.14em',
          color: muted ? '#222' : '#555',
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}
