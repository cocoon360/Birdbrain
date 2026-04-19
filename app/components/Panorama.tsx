'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDossier } from './DossierContext';
import { EngineSettingsDrawer } from './EngineSettingsDrawer';
import { RobotBirdLogo } from './RobotBirdLogo';
import {
  chrome,
  chromeButtonStyle,
  metroFont,
  pivotItemStyle,
  segmentedItemStyle,
  space,
  type,
} from '@/lib/ui/metro-theme';

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
        background: 'var(--bg)',
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
          minHeight: chrome.barMinHeight,
          padding: `${space.sm}px ${space.xxl}px`,
          display: 'flex',
          alignItems: 'center',
          gap: space.lg,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          pointerEvents: 'none',
          fontFamily: metroFont,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space.sm,
            pointerEvents: 'auto',
          }}
        >
          <RobotBirdLogo size={22} />
          <span
            style={{
              fontSize: type.stamp,
              color: 'var(--accent)',
              fontWeight: 700,
              letterSpacing: '0.14em',
            }}
          >
            BIRD BRAIN
          </span>
          {workspaceName && (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: type.stamp }}>·</span>
              <span
                style={{
                  fontSize: type.stamp,
                  color: 'var(--text-dim)',
                  fontWeight: 600,
                  letterSpacing: '0.1em',
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
            gap: chrome.pivotGap,
            marginLeft: space.md,
            pointerEvents: 'auto',
            alignItems: 'flex-end',
          }}
        >
          {panels.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => scrollTo(p.id)}
              style={pivotItemStyle(active === p.id)}
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
            gap: space.md,
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => setWheelScroll((v) => !v)}
            title={
              wheelScroll
                ? 'Wheel scrolls between tabs. Click to lock navigation to the tab buttons only.'
                : 'Tab navigation is button-only. Click to re-enable mouse-wheel tab scrolling.'
            }
            aria-pressed={wheelScroll}
            style={chromeButtonStyle({ active: wheelScroll, flex: true })}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{wheelScroll ? '↔' : '·'}</span>
            wheel
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={engineSummary ? `${engineSummary.provider} · ${engineSummary.model}` : 'Engine settings'}
            style={chromeButtonStyle({})}
          >
            <span style={{ color: 'var(--accent)' }}>engine</span>
          </button>
          {onSwitchWorkspace && (
            <button type="button" onClick={onSwitchWorkspace} style={chromeButtonStyle({})}>
              switch workspace
            </button>
          )}
          {onBeginAgain && (
            <button type="button" onClick={onBeginAgain} style={chromeButtonStyle({})}>
              begin again
            </button>
          )}
          <div
            style={{
              fontSize: type.stamp,
              letterSpacing: '0.1em',
              color: unreadBranches > 0 ? '#e74c9b' : 'var(--text-muted)',
              textTransform: 'uppercase',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {unreadBranches > 0 ? `${unreadBranches} new branches` : 'branches quiet'}
          </div>
          <div
            style={{
              display: 'flex',
              minWidth: 160,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            {(['live', 'queued'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSynthesisMode(mode)}
                style={segmentedItemStyle(synthesisMode === mode)}
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
          paddingTop: 68,
          display: 'flex',
          flexDirection: 'row',
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
              marginRight: i === panels.length - 1 ? 0 : space.lg,
              height: 'calc(100vh - 68px)',
              scrollSnapAlign: 'start',
              background: 'var(--bg)',
              borderRight: i === panels.length - 1 ? 'none' : '1px solid var(--border)',
              overflow: 'hidden',
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
