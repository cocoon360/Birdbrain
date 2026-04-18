/**
 * Metro / Windows Phone 7–inspired layout tokens for inline styles.
 * Pair with `app/app/globals.css` (:root + .metro-* classes).
 */

import type { CSSProperties } from 'react';

export const metroFont =
  "'Segoe UI', 'Segoe UI Web (West European)', Segoe UI, system-ui, -apple-system, sans-serif";

export const motion = {
  easeOut: '150ms ease-out',
  easeOutCubic: '180ms cubic-bezier(0.33, 1, 0.68, 1)',
} as const;

/** Fixed type steps (px) — prefer over arbitrary rem in chrome. */
export const type = {
  stamp: 11,
  label: 12,
  body: 15,
  lead: 18,
  titleSm: 28,
  titleLg: 42,
} as const;

export const space = {
  xs: 6,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
  hub: 48,
} as const;

export const chrome = {
  barMinHeight: 52,
  controlHeight: 36,
  pivotGap: 20,
  pivotUnderline: 3,
} as const;

export const colors = {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  border: 'var(--border)',
  text: 'var(--text)',
  dim: 'var(--text-dim)',
  muted: 'var(--text-muted)',
  accent: 'var(--accent)',
  ok: 'var(--status-canon)',
  warn: 'var(--status-working)',
  danger: '#e74c9b',
} as const;

export function chromeButtonStyle(opts: {
  active?: boolean;
  disabled?: boolean;
  flex?: boolean;
}): CSSProperties {
  const { active, disabled, flex } = opts;
  return {
    fontFamily: metroFont,
    background: 'transparent',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    color: active ? 'var(--accent)' : 'var(--text-dim)',
    cursor: disabled ? 'wait' : 'pointer',
    minHeight: chrome.controlHeight,
    padding: '0 14px',
    fontSize: type.stamp,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    opacity: disabled ? 0.65 : 1,
    transition: `border-color ${motion.easeOut}, color ${motion.easeOut}`,
    display: flex ? 'flex' : 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    lineHeight: 1,
  };
}

export function pivotItemStyle(active: boolean): CSSProperties {
  return {
    fontFamily: metroFont,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: `8px 0 ${chrome.pivotUnderline}px`,
    fontSize: type.label,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: `${chrome.pivotUnderline}px solid ${active ? 'var(--accent)' : 'transparent'}`,
    transition: `color ${motion.easeOut}, border-color ${motion.easeOut}`,
    marginBottom: -1,
  };
}

export function segmentedItemStyle(active: boolean): CSSProperties {
  return {
    fontFamily: metroFont,
    flex: 1,
    background: 'transparent',
    border: 'none',
    borderBottom: `${chrome.pivotUnderline}px solid ${active ? 'var(--accent)' : 'transparent'}`,
    color: active ? 'var(--accent)' : 'var(--text-dim)',
    cursor: 'pointer',
    minHeight: chrome.controlHeight,
    padding: '0 10px',
    fontSize: type.stamp,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    transition: `color ${motion.easeOut}, border-color ${motion.easeOut}`,
  };
}
