'use client';

import { StatusBadge } from './StatusBadge';

interface DocCardProps {
  id: number;
  title: string;
  status: string;
  category: string;
  path: string;
  file_mtime: number;
  word_count: number;
  onClick: (id: number) => void;
  selected?: boolean;
  selectable?: boolean;
}

export function DocCard({ id, title, status, category, path, file_mtime, word_count, onClick, selected, selectable }: DocCardProps) {
  const date = new Date(file_mtime * 1000);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const parts = path.split('/');
  const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

  return (
    <button
      onClick={() => onClick(id)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '14px 16px',
        background: selected ? 'rgba(0,180,216,0.08)' : '#111111',
        border: selected ? '1px solid rgba(0,180,216,0.4)' : '1px solid #1e1e1e',
        borderRadius: '3px',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'border-color 0.1s, background 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#f0f0f0', lineHeight: 1.3 }}>
          {selectable && (
            <span style={{
              display: 'inline-block',
              width: 12, height: 12,
              border: `1px solid ${selected ? '#00b4d8' : '#444'}`,
              background: selected ? '#00b4d8' : 'transparent',
              borderRadius: 2,
              marginRight: 8,
              flexShrink: 0,
              verticalAlign: 'middle',
            }} />
          )}
          {title}
        </span>
        <StatusBadge status={status} />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.65rem', color: '#555', letterSpacing: '0.05em' }}>
          {category.toUpperCase()}
        </span>
        <span style={{ fontSize: '0.65rem', color: '#333' }}>·</span>
        <span style={{ fontSize: '0.65rem', color: '#555' }}>{dateStr}</span>
        <span style={{ fontSize: '0.65rem', color: '#333' }}>·</span>
        <span style={{ fontSize: '0.65rem', color: '#555' }}>{word_count.toLocaleString()} words</span>
      </div>

      {folder && (
        <div style={{ fontSize: '0.6rem', color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {folder}
        </div>
      )}
    </button>
  );
}
