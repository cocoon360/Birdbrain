'use client';

import { useEffect, useState, type CSSProperties } from 'react';

interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface BrowsePayload {
  path: string;
  parent: string | null;
  folders: Entry[];
  quick: Entry[];
  error?: string;
}

// Web fallback for the native folder picker. Since Bird Brain's backend
// runs on the user's own machine, we can safely expose a directory-only
// browser that pages through the real filesystem.

export function FolderBrowserDialog({
  initialPath,
  initialGuidance,
  onCancel,
  onPick,
}: {
  initialPath?: string;
  initialGuidance?: string;
  onCancel: () => void;
  onPick: (picked: { path: string; name: string; guidance: string }) => void;
}) {
  const [current, setCurrent] = useState<string | null>(initialPath ?? null);
  const [payload, setPayload] = useState<BrowsePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(initialPath ?? '');
  const [guidance, setGuidance] = useState(initialGuidance ?? '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (current) params.set('path', current);
    fetch(`/api/fs/browse?${params.toString()}`, { cache: 'no-store' })
      .then(async (r) => {
        const body = (await r.json()) as BrowsePayload;
        if (cancelled) return;
        if (!r.ok || body.error) {
          setError(body.error ?? 'Could not read folder.');
          setLoading(false);
          return;
        }
        setPayload(body);
        setCurrent(body.path);
        setManual(body.path);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  function choose() {
    if (!payload) return;
    const segments = payload.path.split('/').filter(Boolean);
    const name = segments.length ? segments[segments.length - 1] : payload.path;
    onPick({ path: payload.path, name, guidance: guidance.trim() });
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.78)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0a0a0a',
          border: '1px solid #1e1e1e',
          color: '#f0f0f0',
          width: 'min(720px, 96vw)',
          height: 'min(860px, 90vh)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid #181818',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: '0.6rem',
                color: '#00b4d8',
                letterSpacing: '0.22em',
                fontWeight: 700,
              }}
            >
              BROWSE FOLDERS
            </div>
            <div style={{ fontSize: '0.76rem', color: '#777', marginTop: 4, maxWidth: 480, lineHeight: 1.5 }}>
              Navigate to the folder on top. Add optional project context on the bottom. Hit{' '}
              <span style={{ color: '#00d68f' }}>use this folder</span> and Bird Brain starts
              ingesting.
            </div>
            <div
              style={{
                fontSize: '0.62rem',
                color: '#4a5157',
                marginTop: 6,
                lineHeight: 1.5,
                maxWidth: 480,
              }}
            >
              Reads{' '}
              <code style={{ color: '#7a8288' }}>.md</code>{' '}
              <code style={{ color: '#7a8288' }}>.txt</code>{' '}
              <code style={{ color: '#7a8288' }}>.rst</code>{' '}
              <code style={{ color: '#7a8288' }}>.org</code>{' '}
              <code style={{ color: '#7a8288' }}>.adoc</code>{' '}
              <code style={{ color: '#7a8288' }}>.json</code>{' '}
              <code style={{ color: '#7a8288' }}>.yaml</code>{' '}
              <code style={{ color: '#7a8288' }}>.csv</code>{' '}
              <code style={{ color: '#7a8288' }}>.log</code>{' '}
              <code style={{ color: '#7a8288' }}>.toml</code>{' '}
              <code style={{ color: '#7a8288' }}>.ini</code>{' '}
              <code style={{ color: '#7a8288' }}>.html</code>{' '}
              <code style={{ color: '#7a8288' }}>.htm</code>{' '}
              <code style={{ color: '#7a8288' }}>.xml</code>{' '}
              <code style={{ color: '#7a8288' }}>.svg</code>. Skips{' '}
              <code style={{ color: '#7a8288' }}>node_modules</code>, build folders, and dot-folders.
            </div>
          </div>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              color: '#888',
              border: '1px solid #252525',
              padding: '6px 10px',
              cursor: 'pointer',
              fontSize: '0.58rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            close
          </button>
        </div>

        <div style={{ padding: '14px 22px', borderBottom: '1px solid #181818' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <button
              onClick={() => payload?.parent && setCurrent(payload.parent)}
              disabled={!payload?.parent || loading}
              style={iconButtonStyle(!payload?.parent || loading)}
              title="Parent folder"
            >
              ↑
            </button>
            <input
              type="text"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manual.trim()) setCurrent(manual.trim());
              }}
              style={{
                flex: 1,
                background: '#0f0f0f',
                border: '1px solid #1c1c1c',
                color: '#eee',
                padding: '10px 12px',
                fontSize: '0.78rem',
                outline: 'none',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            />
            <button
              onClick={() => manual.trim() && setCurrent(manual.trim())}
              disabled={loading}
              style={iconButtonStyle(loading)}
              title="Go to path"
            >
              go
            </button>
          </div>
        </div>

        {payload?.quick && payload.quick.length > 0 && (
          <div
            style={{
              padding: '10px 22px',
              borderBottom: '1px solid #181818',
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: '0.56rem',
                color: '#555',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
                alignSelf: 'center',
                marginRight: 4,
              }}
            >
              quick
            </span>
            {payload.quick.map((q) => (
              <button
                key={q.path}
                onClick={() => setCurrent(q.path)}
                style={chipButtonStyle(false)}
              >
                {q.name}
              </button>
            ))}
          </div>
        )}

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px 10px 16px',
            minHeight: 0,
            borderBottom: '1px solid #181818',
          }}
          className="thin-scrollbar"
        >
          {loading && <div style={{ padding: '12px 8px', color: '#666' }}>loading…</div>}
          {error && (
            <div style={{ padding: '12px 8px', color: '#e74c9b', fontSize: '0.78rem' }}>
              {error}
            </div>
          )}
          {!loading && !error && payload && (
            <>
              {payload.folders.length === 0 ? (
                <div style={{ padding: '12px 8px', color: '#555', fontSize: '0.78rem' }}>
                  (no subfolders — you can still pick this folder with Choose below)
                </div>
              ) : (
                payload.folders.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => setCurrent(entry.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      color: '#ddd',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#101010')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ color: '#00b4d8', fontSize: '0.85rem' }}>📁</span>
                    <span>{entry.name}</span>
                  </button>
                ))
              )}
            </>
          )}
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '14px 22px 12px',
            minHeight: 0,
            gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '0.58rem',
                  color: '#e7b24c',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                project context · optional
              </div>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: '#777',
                  lineHeight: 1.5,
                  marginTop: 4,
                  maxWidth: 520,
                }}
              >
                Tell Bird Brain what this folder is. One paragraph is enough — what the
                project is, what kinds of concepts matter, what to ignore. The more specific the
                lens, the better the dossiers.
              </div>
            </div>
            <div
              style={{
                fontSize: '0.56rem',
                color: guidance.trim().length ? '#00d68f' : '#444',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              {guidance.trim().length ? `${guidance.trim().length} chars` : 'blank ok'}
            </div>
          </div>
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder={
              'e.g. A daily mindfulness journal. Concepts I care about: practices, mental states, people, places. Ignore book titles and generic verbs.'
            }
            spellCheck={false}
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              background: '#0c0c0c',
              border: '1px solid #1c1c1c',
              color: '#e8e8e8',
              padding: '10px 12px',
              fontSize: '0.8rem',
              lineHeight: 1.55,
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid #181818',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div
              style={{
                fontSize: '0.52rem',
                color: '#555',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              current path
            </div>
            <div
              style={{
                fontSize: '0.78rem',
                color: '#d0d0d0',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={payload?.path}
            >
              {payload?.path ?? '…'}
            </div>
          </div>
          <button onClick={onCancel} style={secondaryButton}>
            cancel
          </button>
          <button onClick={choose} disabled={!payload || loading} style={primaryButton(!payload || loading)}>
            use this folder →
          </button>
        </div>
      </div>
    </div>
  );
}

function iconButtonStyle(busy: boolean): CSSProperties {
  return {
    background: 'transparent',
    border: '1px solid #252525',
    color: '#ddd',
    padding: '0 14px',
    cursor: busy ? 'wait' : 'pointer',
    fontSize: '0.78rem',
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    opacity: busy ? 0.6 : 1,
  };
}

function chipButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? '#101d21' : '#0f0f0f',
    border: `1px solid ${active ? '#00b4d8' : '#1c1c1c'}`,
    color: active ? '#00b4d8' : '#bbb',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '0.66rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 700,
  };
}

const secondaryButton: CSSProperties = {
  background: 'transparent',
  border: '1px solid #2c2c2c',
  color: '#ddd',
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: '0.64rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

function primaryButton(busy: boolean): CSSProperties {
  return {
    background: busy ? '#1a1a1a' : '#00d68f',
    color: busy ? '#555' : '#041015',
    border: 'none',
    padding: '10px 16px',
    cursor: busy ? 'not-allowed' : 'pointer',
    fontSize: '0.66rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
  };
}
