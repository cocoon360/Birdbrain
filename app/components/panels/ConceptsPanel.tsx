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
  { type: 'person', label: 'PEOPLE' },
  { type: 'place', label: 'PLACES' },
  { type: 'event', label: 'EVENTS' },
  { type: 'theme', label: 'THEMES' },
  { type: 'system', label: 'SYSTEMS' },
  { type: 'organization', label: 'ORGANIZATIONS' },
  { type: 'artifact', label: 'ARTIFACTS' },
  { type: 'practice', label: 'PRACTICES' },
  { type: 'state', label: 'STATES' },
  { type: 'work', label: 'WORKS' },
  { type: 'concept', label: 'CONCEPTS' },
];

const DEFAULT_VISIBLE_CONCEPTS = 36;

export function ConceptsPanel() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);
  const [ready, setReady] = useState(true);

  useEffect(() => {
    fetch('/api/concepts?limit=500')
      .then((r) => r.json())
      .then((data) => {
        setConcepts(data.concepts ?? []);
        setReady(Boolean(data.startup?.ready ?? true));
      });
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, Concept[]> = {};
    const visible = showAll ? concepts : concepts.slice(0, DEFAULT_VISIBLE_CONCEPTS);
    for (const c of visible) {
      if (filter !== 'all' && c.type !== filter) continue;
      (map[c.type] ??= []).push(c);
    }
    return map;
  }, [concepts, filter, showAll]);

  const hiddenCount = Math.max(0, concepts.length - DEFAULT_VISIBLE_CONCEPTS);
  const groupedTypes = useMemo(() => {
    const known = new Set(TYPE_GROUPS.map((group) => group.type));
    const ordered = TYPE_GROUPS.filter((group) => grouped[group.type]?.length);
    const extraTypes = Object.keys(grouped)
      .filter((type) => !known.has(type))
      .sort()
      .map((type) => ({ type, label: type.toUpperCase() }));
    return [...ordered, ...extraTypes];
  }, [grouped]);

  return (
    <div className="metro-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 18 }}>
        <div className="metro-subtitle" style={{ marginBottom: 6 }}>hypertext</div>
        <h1 className="metro-title">concepts</h1>
        <p className="metro-lead" style={{ maxWidth: 540 }}>
          Every named concept detected across ingested files. Click a tile to open its dossier:
          primary-path mentions, in-progress overlap, older supporting material, and related concepts.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        {['all', ...TYPE_GROUPS.map((g) => g.type)].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            style={{
              fontSize: 11,
              letterSpacing: '0.1em',
              padding: '6px 10px',
              background: 'transparent',
              color: filter === t ? 'var(--accent)' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderBottomWidth: filter === t ? 3 : 1,
              borderBottomColor: filter === t ? 'var(--accent)' : 'var(--border)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              fontWeight: 600,
              transition: 'border-color 150ms ease-out, color 150ms ease-out',
            }}
          >
            {t}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            style={{
              fontSize: 11,
              letterSpacing: '0.1em',
              padding: '6px 10px',
              background: showAll ? 'rgba(0, 214, 143, 0.08)' : 'transparent',
              color: showAll ? 'var(--accent)' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderBottomWidth: showAll ? 3 : 1,
              borderBottomColor: showAll ? 'var(--accent)' : 'var(--border)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
            title={
              showAll
                ? 'Return to the highest-ranked concepts.'
                : `Show ${hiddenCount} lower-ranked concepts.`
            }
          >
            {showAll ? 'show ranked' : `show all ${concepts.length}`}
          </button>
        )}
      </div>
      {ready && concepts.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            marginTop: -8,
            marginBottom: 16,
            fontSize: '0.68rem',
            color: '#555',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {showAll
            ? `Showing all ${concepts.length} concepts, ranked by grounding.`
            : `Showing top ${Math.min(DEFAULT_VISIBLE_CONCEPTS, concepts.length)} of ${concepts.length} concepts.`}
        </div>
      )}

      <div
        style={{ flex: 1, overflowY: 'auto', paddingRight: 18 }}
        className="thin-scrollbar"
      >
        {groupedTypes.map((group) => {
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
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
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
            Concepts are blocked until the project map has been built from the start screen.
          </div>
        )}
        {ready && concepts.length === 0 && (
          <div style={{ color: '#444', fontSize: '0.82rem', marginTop: 40 }}>
            No concepts yet. Scan the folder and build the project map first.
          </div>
        )}
      </div>
    </div>
  );
}
