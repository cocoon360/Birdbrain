'use client';

import { STATUS_COLORS, documentStatusBadgeLabel } from '@/lib/ui/semantic';

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
  const label = documentStatusBadgeLabel(status);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '0.6rem',
        fontWeight: 600,
        letterSpacing: '0.1em',
        padding: '2px 6px',
        border: `1px solid ${color}`,
        color,
        borderRadius: '2px',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}
