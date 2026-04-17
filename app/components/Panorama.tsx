'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDossier } from './DossierContext';
import { EngineSettingsDrawer } from './EngineSettingsDrawer';

export interface PanoramaPanel {
  id: string;
  label: string;
  content: ReactNode;
}

interface PanoramaProps {
  panels: PanoramaPanel[];
  initial?: string;
  onBeginAgain?: () => void;
  workspaceName?: string;
  onSwitchWorkspace?: () => void;
}

export function Panorama({
  panels,
  initial,
  onBeginAgain,
  workspaceName,
  onSwitchWorkspace,
}: PanoramaProps) {
  const { synthesisMode, setSynthesisMode, branches } = useDossier();
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [active, setActive] = useState<string>(initial ?? panels[0]?.id ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [engineSummary, setEngineSummary] = useState<{ provider: string; model: string } | null>(null);
  const [wheelScroll, setWheelScroll] = useState<boolean>(true);
  const unreadBranches = branches.filter((branch) => branch.unread).length;

  // Load wheel-scroll preference from localStorage on mount (client-only) so
  // SSR markup matches the default (on) and we avoid hydration mismatches.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('birdbrain.wheelScroll');
    if (stored === '0') setWheelScroll(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('birdbrain.wheelScroll', wheelScroll ? '1' : '0');
  }, [wheelScroll]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/engine', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { provider: string; model: string; default_model: string }) => {
        if (cancelled) return;
        setEngineSummary({ provider: data.provider, model: data.model || data.default_model });
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const center = el.scrollLeft + el.clientWidth / 2;
      let closest = panels[0]?.id ?? '';
      let minDist = Infinity;
      for (const panel of panels) {
        const node = panelRefs.current[panel.id];
        if (!node) continue;
        const nodeCenter = node.offsetLeft + node.clientWidth / 2;
        const dist = Math.abs(nodeCenter - center);
        if (dist < minDist) {
          minDist = dist;
          closest = panel.id;
        }
      }
      setActive(closest);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [panels]);

  // Scroll-chaining wheel handler.
  //
  // Priority: if the cursor is over a nested vertical scroller that still has
  // room in the wheel's direction, let that scroller consume the wheel. Only
  // when the nested content hits its top/bottom boundary (or there's no nested
  // scroller at all) does the wheel spill over into horizontal panorama scroll.
  //
  // This works for both mouse wheel and trackpad. Horizontal two-finger swipes
  // (deltaX dominant) are always left to the browser, so sideways scrolling
  // with a trackpad continues to feel native.
  useEffect(() => {
    if (!wheelScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      if (absY === 0) return;
      if (absX >= absY) return; // horizontal intent already; let the browser handle it.

      let node: HTMLElement | null = event.target as HTMLElement | null;
      while (node && node !== el) {
        if (node.nodeType === 1) {
          const style = window.getComputedStyle(node);
          const overflowY = style.overflowY;
          const canScrollY =
            (overflowY === 'auto' || overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight + 1;
          if (canScrollY) {
            const atTop = node.scrollTop <= 0;
            const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
            if ((event.deltaY < 0 && !atTop) || (event.deltaY > 0 && !atBottom)) {
              return;
            }
          }
        }
        node = node.parentElement;
      }

      event.preventDefault();
      el.scrollBy({ left: event.deltaY, behavior: 'auto' });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [panels, wheelScroll]);

  // Click-and-drag to scroll the panorama. Independent of the wheel toggle:
  // even if wheel is locked, a user can still grab the backdrop and drag to
  // another tab. We use a small distance threshold so ordinary clicks on
  // text / buttons still work, and we bail out entirely if the mousedown is
  // on an interactive element or inside an input/textarea so text selection
  // in dossiers isn't trampled.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const DRAG_THRESHOLD = 6;

    function isDraggableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;
      if (
        target.closest(
          'button, a, input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="button"]'
        )
      ) {
        return false;
      }
      return true;
    }

    let pointerId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let dragging = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (!isDraggableTarget(event.target)) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScroll = el.scrollLeft;
      dragging = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        dragging = true;
        try {
          el.setPointerCapture(pointerId);
        } catch {
          // ignore: some environments disallow capture
        }
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
        // Clear any in-flight text selection that would look ugly mid-drag.
        window.getSelection()?.removeAllRanges();
      }
      el.scrollLeft = startScroll - dx;
      event.preventDefault();
    };

    const release = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const wasDragging = dragging;
      pointerId = null;
      dragging = false;
      el.style.cursor = '';
      el.style.userSelect = '';
      // Swallow the click that would fire right after a real drag.
      if (wasDragging) {
        const blocker = (clickEvent: MouseEvent) => {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
          el.removeEventListener('click', blocker, true);
        };
        el.addEventListener('click', blocker, true);
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
    };
  }, [panels]);

  const scrollTo = (id: string) => {
    const node = panelRefs.current[id];
    const container = scrollRef.current;
    if (!node || !container) return;
    container.scrollTo({ left: node.offsetLeft, behavior: 'smooth' });
  };

  return (
    <div
      style={{
        position: 'relative',
        height: '100vh',
        width: '100vw',
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          padding: '22px 40px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          background:
            'linear-gradient(to bottom, rgba(10,10,10,0.96) 40%, rgba(10,10,10,0.0) 100%)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            pointerEvents: 'auto',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
            <rect x="1" y="1" width="9" height="9" stroke="#00b4d8" strokeWidth="1.5" />
            <rect x="12" y="1" width="9" height="9" fill="#00b4d8" />
            <rect x="1" y="12" width="9" height="9" fill="#00b4d8" opacity="0.3" />
            <rect x="12" y="12" width="9" height="9" stroke="#00b4d8" strokeWidth="1.5" opacity="0.5" />
          </svg>
          <span
            style={{
              fontSize: '0.65rem',
              color: '#00b4d8',
              fontWeight: 700,
              letterSpacing: '0.22em',
            }}
          >
            BIRD BRAIN
          </span>
          {workspaceName && (
            <>
              <span style={{ color: '#333', fontSize: '0.65rem' }}>·</span>
              <span
                style={{
                  fontSize: '0.65rem',
                  color: '#888',
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                }}
              >
                {workspaceName}
              </span>
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 24,
            marginLeft: 20,
            pointerEvents: 'auto',
          }}
        >
          {panels.map((p) => (
            <button
              key={p.id}
              onClick={() => scrollTo(p.id)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 0',
                fontSize: '0.65rem',
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: active === p.id ? '#00b4d8' : '#333',
                borderBottom: active === p.id ? '1px solid #00b4d8' : '1px solid transparent',
                transition: 'color 0.15s',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            pointerEvents: 'auto',
          }}
        >
          <button
            onClick={() => setWheelScroll((v) => !v)}
            title={
              wheelScroll
                ? 'Wheel scrolls between tabs. Click to lock navigation to the tab buttons only.'
                : 'Tab navigation is button-only. Click to re-enable mouse-wheel tab scrolling.'
            }
            aria-pressed={wheelScroll}
            style={{
              background: 'transparent',
              border: `1px solid ${wheelScroll ? '#1f3a47' : '#242424'}`,
              color: wheelScroll ? '#00b4d8' : '#555',
              cursor: 'pointer',
              padding: '6px 8px',
              fontSize: '0.54rem',
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              lineHeight: 1,
            }}
          >
            <span style={{ fontSize: '0.82rem' }}>{wheelScroll ? '↔' : '·'}</span>
            wheel
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title={engineSummary ? `${engineSummary.provider} · ${engineSummary.model}` : 'Engine settings'}
            style={{
              background: 'transparent',
              border: '1px solid #252525',
              color: '#888',
              cursor: 'pointer',
              padding: '7px 10px',
              fontSize: '0.56rem',
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ color: '#00b4d8' }}>engine</span>
            {engineSummary ? (
              <span style={{ color: '#666' }}>
                {engineSummary.provider} · {engineSummary.model}
              </span>
            ) : null}
          </button>
          {onSwitchWorkspace && (
            <button
              onClick={onSwitchWorkspace}
              style={{
                background: 'transparent',
                border: '1px solid #252525',
                color: '#888',
                cursor: 'pointer',
                padding: '7px 10px',
                fontSize: '0.56rem',
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              switch workspace
            </button>
          )}
          {onBeginAgain && (
            <button
              onClick={onBeginAgain}
              style={{
                background: 'transparent',
                border: '1px solid #252525',
                color: '#888',
                cursor: 'pointer',
                padding: '7px 10px',
                fontSize: '0.56rem',
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              begin again
            </button>
          )}
          <div
            style={{
              fontSize: '0.55rem',
              letterSpacing: '0.16em',
              color: unreadBranches > 0 ? '#e74c9b' : '#555',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            {unreadBranches > 0 ? `${unreadBranches} new branches` : 'branches quiet'}
          </div>
          <div
            style={{
              display: 'flex',
              border: '1px solid #1f1f1f',
              background: '#0f0f0f',
            }}
          >
            {(['live', 'queued'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSynthesisMode(mode)}
                style={{
                  background: synthesisMode === mode ? '#00b4d8' : 'transparent',
                  color: synthesisMode === mode ? '#041015' : '#888',
                  border: 'none',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '0.58rem',
                  fontWeight: 700,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                }}
                title={
                  mode === 'live'
                    ? 'Open dossier and synthesize immediately'
                    : 'Queue dossier synthesis and let the preview process it automatically'
                }
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          position: 'absolute',
          inset: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x proximity',
          scrollBehavior: 'smooth',
          paddingTop: 72,
          display: 'flex',
          flexDirection: 'row',
          cursor: 'grab',
        }}
        className="no-scrollbar"
      >
        {panels.map((panel, i) => (
          <div
            key={panel.id}
            ref={(el) => {
              panelRefs.current[panel.id] = el;
            }}
            style={{
              flex: '0 0 auto',
              width: 'min(1100px, 92vw)',
              marginRight: i === panels.length - 1 ? 0 : 24,
              height: 'calc(100vh - 72px)',
              scrollSnapAlign: 'start',
              background: '#0a0a0a',
              borderRight: i === panels.length - 1 ? 'none' : '1px solid #141414',
              overflow: 'hidden',
              cursor: 'auto',
            }}
          >
            {panel.content}
          </div>
        ))}
        <div style={{ flex: '0 0 40px' }} />
      </div>
      <EngineSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(next) =>
          setEngineSummary({ provider: next.provider, model: next.model || next.default_model })
        }
      />
    </div>
  );
}
