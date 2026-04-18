'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDossier } from '../DossierContext';
import { StatusBadge } from '../StatusBadge';

interface Doc {
  id: number;
  title: string;
  path: string;
  status: string;
  category: string;
  file_mtime: number;
  word_count: number;
}

export function TimelinePanel() {
  const { openDoc } = useDossier();
  const [docs, setDocs] = useState<Doc[]>([]);

  useEffect(() => {
    fetch('/api/timeline?limit=80')
      .then((r) => r.json())
      .then((data) => setDocs(data.documents ?? []));
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, Doc[]> = {};
    for (const d of docs) {
      const date = new Date(d.file_mtime * 1000);
      const key = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      (map[key] ??= []).push(d);
    }
    return map;
  }, [docs]);

  return (
    <div className="metro-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>what changed</div>
        <h1 className="metro-title">timeline</h1>
        <p className="metro-lead" style={{ maxWidth: 540 }}>
          Documents in modification order. Useful for catching up on recent decisions and spotting
          drift across days.
        </p>
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', paddingRight: 18 }}
        className="thin-scrollbar"
      >
        {Object.entries(grouped).map(([date, rows]) => (
          <div key={date} style={{ marginBottom: 22 }}>
            <div
              className="metro-subtitle"
              style={{
                marginBottom: 10,
                color: 'var(--accent)',
              }}
            >
              {date}
              <span style={{ color: '#333', marginLeft: 8 }}>{rows.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {rows.map((d) => (
                <button
                  key={d.id}
                  onClick={() => openDoc(d.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: '#0f0f0f',
                    border: '1px solid #181818',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    color: '#ddd',
                    textAlign: 'left',
                  }}
                >
                  <StatusBadge status={d.status} />
                  <span style={{ fontSize: '0.82rem', color: '#eee', flex: 1 }}>{d.title}</span>
                  <span style={{ fontSize: '0.6rem', color: '#444' }}>
                    {d.category.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: '#444' }}>
                    {d.word_count.toLocaleString()}w
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {docs.length === 0 && (
          <div style={{ color: '#444', fontSize: '0.82rem' }}>No documents yet.</div>
        )}
      </div>
    </div>
  );
}
