'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

// Client-side plumbing that every Bird Brain view below the workspace
// picker needs. It holds the active workspace id and patches window.fetch
// so every same-origin /api/* request carries the `x-birdbrain-workspace`
// header + `?ws=<id>` query parameter. This means component code written
// for the single-workspace era (plain `fetch('/api/hub')`) still hits the
// right DB without having to know the id.

export interface WorkspaceShape {
  id: string;
  name: string;
  folder_path: string;
}

interface WorkspaceState {
  workspace: WorkspaceShape;
}

const WorkspaceCtx = createContext<WorkspaceState | null>(null);

const FETCH_PATCHED_SYMBOL = Symbol.for('birdbrain.fetch.patched');
const FETCH_WORKSPACE_SYMBOL = Symbol.for('birdbrain.fetch.workspace');

interface PatchableWindow {
  fetch: typeof window.fetch;
  [FETCH_PATCHED_SYMBOL]?: boolean;
  [FETCH_WORKSPACE_SYMBOL]?: string;
}

function patchFetchForWorkspace(id: string) {
  if (typeof window === 'undefined') return;
  const w = window as unknown as PatchableWindow;
  w[FETCH_WORKSPACE_SYMBOL] = id;
  if (w[FETCH_PATCHED_SYMBOL]) return;
  const original = w.fetch.bind(window);
  w[FETCH_PATCHED_SYMBOL] = true;
  w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const activeId = w[FETCH_WORKSPACE_SYMBOL];
    if (!activeId) return original(input as RequestInfo, init);

    let request: Request;
    let targetUrl: URL | null = null;

    const decorate = (url: URL): URL => {
      if (!url.searchParams.has('ws')) {
        url.searchParams.set('ws', activeId);
      }
      return url;
    };

    const withHeader = (headersInit: HeadersInit | undefined): Headers => {
      const headers = new Headers(headersInit ?? {});
      if (!headers.has('x-birdbrain-workspace')) {
        headers.set('x-birdbrain-workspace', activeId);
      }
      return headers;
    };

    // Only rewrite same-origin /api/* requests.
    const isInternal = (url: URL): boolean =>
      url.origin === window.location.origin && url.pathname.startsWith('/api/');

    if (typeof input === 'string' || input instanceof URL) {
      try {
        const url = new URL(input.toString(), window.location.origin);
        if (!isInternal(url)) return original(input as RequestInfo, init);
        targetUrl = decorate(url);
      } catch {
        return original(input as RequestInfo, init);
      }
      const nextInit: RequestInit = {
        ...init,
        headers: withHeader(init?.headers),
      };
      return original(targetUrl.toString(), nextInit);
    }

    if (input instanceof Request) {
      request = input;
      try {
        const url = new URL(request.url);
        if (!isInternal(url)) return original(request, init);
        targetUrl = decorate(url);
      } catch {
        return original(request, init);
      }
      const headers = withHeader(request.headers);
      const nextRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
        mode: request.mode,
        credentials: request.credentials,
        cache: request.cache,
        redirect: request.redirect,
        referrer: request.referrer,
        integrity: request.integrity,
      });
      return original(nextRequest, init);
    }

    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

function clearFetchWorkspace() {
  if (typeof window === 'undefined') return;
  const w = window as unknown as PatchableWindow;
  w[FETCH_WORKSPACE_SYMBOL] = undefined;
}

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceShape;
  children: ReactNode;
}) {
  useEffect(() => {
    patchFetchForWorkspace(workspace.id);
    return () => {
      clearFetchWorkspace();
    };
  }, [workspace.id]);

  const value = useMemo(() => ({ workspace }), [workspace]);

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace(): WorkspaceShape {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx.workspace;
}

export function useOptionalWorkspace(): WorkspaceShape | null {
  const ctx = useContext(WorkspaceCtx);
  return ctx?.workspace ?? null;
}
