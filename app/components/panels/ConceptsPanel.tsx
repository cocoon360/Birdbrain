'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConceptTile } from '../ConceptTile';

interface Concept {
  slug: string;
  name: string;
  type: string;
  summary: string;
  mention_count: number;
  canon_docs: number;
  working_docs: number;
  document_count: number;
}

const TYPE_GROUPS: { type: string; label: string }[] = [
  { type: 'character', label: 'CHARACTERS' },
  { type: 'location', label: 'LOCATIONS' },
  { type: 'event', label: 'EVENTS' },
  { type: 'theme', label: 'THEMES' },
  { type: 'system', label: 'SYSTEMS' },
  { type: 'organization', label: 'ORGANIZATIONS' },
];

export function ConceptsPanel() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [ready, setReady] = useState(true);

  useEffect(() => {
    fetch('/api/concepts?limit=100')
      .then((r) => r.json())
      .then((data) => {
        setConcepts(data.concepts ?? []);
        setReady(Boolean(data.startup?.ready ?? true));
      });
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, Concept[]> = {};
    for (const c of concepts) {
      if (filter !== 'all' && c.type !== filter) continue;
      (map[c.type] ??= []).push(c);
    }
    return map;
  }, [concepts, filter]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '32px 48px 32px',
      }}
    >
      <div style={{ flexShrink: 0, marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>hypertext</div>
        <h1 className="metro-title">concepts</h1>
        <p
          style={{
            marginTop: 10,
            fontSize: '0.78rem',
            color: '#555',
            maxWidth: 540,
            lineHeight: 1.5,
          }}
        >
          Every named concept detected across ingested files. Click a tile to open its dossier:
          primary-path mentions, in-progress overlap, older supporting material, and related concepts.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          flexShrink: 0,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        {['all', ...TYPE_GROUPS.map((g) => g.type)].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              fontSize: '0.58rem',
              letterSpacing: '0.14em',
              padding: '6px 12px',
              background: filter === t ? '#00b4d8' : 'transparent',
              color: filter === t ? '#000' : '#777',
              border: `1px solid ${filter === t ? '#00b4d8' : '#2a2a2a'}`,
              cursor: 'pointer',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', paddingRight: 18 }}
        className="thin-scrollbar"
      >
        {TYPE_GROUPS.map((group) => {
          const rows = grouped[group.type];
          if (!rows?.length) return null;
          return (
            <div key={group.type} style={{ marginBottom: 26 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    letterSpacing: '0.18em',
                    color: '#888',
                    textTransform: 'uppercase',
                  }}
                >
                  {group.label}
                </span>
                <span style={{ fontSize: '0.62rem', color: '#333' }}>{rows.length}</span>
                <div style={{ flex: 1, height: 1, background: '#181818' }} />
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 10,
                }}
              >
                {rows.map((c) => (
                  <ConceptTile key={c.slug} {...c} size="md" />
                ))}
              </div>
            </div>
          );
        })}
        {!ready && (
          <div style={{ color: '#777', fontSize: '0.82rem', marginTop: 40, lineHeight: 1.6 }}>
            Ontology concepts are blocked until the startup overview has been built from the start
            screen.
          </div>
        )}
        {ready && concepts.length === 0 && (
          <div style={{ color: '#444', fontSize: '0.82rem', marginTop: 40 }}>
            No ontology concepts yet. Ingest the corpus and build the startup overview first.
          </div>
        )}
      </div>
    </div>
  );
}
