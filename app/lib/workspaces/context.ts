import { AsyncLocalStorage } from 'async_hooks';
import { getWorkspace, listWorkspaces, adoptLegacyWorkspace, touchWorkspace } from './registry';

// Request-scoped workspace context. Every HTTP request that touches the DB
// must run inside runWithWorkspace so getDb() in lib/db/database.ts can
// resolve the right per-workspace SQLite file. This keeps the (many) query
// call sites unchanged — they just read the current workspace id out of the
// async-local store.

export interface WorkspaceContext {
  id: string;
  name: string;
  folder_path: string;
  db_path: string;
}

const als = new AsyncLocalStorage<WorkspaceContext>();

export function getCurrentWorkspace(): WorkspaceContext | null {
  return als.getStore() ?? null;
}

export function runWithWorkspace<T>(ctx: WorkspaceContext, fn: () => T): T {
  return als.run(ctx, fn);
}

// Resolve a workspace id from common request transports: ?ws=… query param,
// x-birdbrain-workspace header, or as a fallback the most recently opened
// workspace. If nothing is registered yet, adopt the legacy single-DB as a
// starter workspace so existing data keeps working.
export function resolveWorkspaceContext(req: Request): WorkspaceContext | null {
  adoptLegacyWorkspace();

  const url = new URL(req.url);
  const headerId = req.headers.get('x-birdbrain-workspace');
  const queryId = url.searchParams.get('ws');
  const candidate = (queryId || headerId || '').trim();

  if (candidate) {
    const record = getWorkspace(candidate);
    if (record) return toContext(record);
  }

  const all = listWorkspaces();
  if (all.length === 0) return null;

  // No explicit id on the request → fall back to the most recently opened
  // workspace (or first-added if none have been opened yet). This keeps
  // legacy URLs that don't know about workspaces still working during the
  // migration window.
  const sorted = [...all].sort(
    (a, b) => (b.last_opened_at ?? b.created_at) - (a.last_opened_at ?? a.created_at)
  );
  return toContext(sorted[0]);
}

function toContext(record: {
  id: string;
  name: string;
  folder_path: string;
  db_path: string;
}): WorkspaceContext {
  return {
    id: record.id,
    name: record.name,
    folder_path: record.folder_path,
    db_path: record.db_path,
  };
}

// Convenience wrapper for API route handlers. Pulls the workspace off the
// request, installs it in async-local storage for the duration of `fn`, and
// returns the response. If no workspace exists yet, fn still runs but
// getDb() will throw — callers should check and surface a helpful UI error.
export async function withWorkspace<T>(
  req: Request,
  fn: (ctx: WorkspaceContext | null) => Promise<T> | T
): Promise<T> {
  const ctx = resolveWorkspaceContext(req);
  if (!ctx) return fn(null);
  touchWorkspace(ctx.id);
  return als.run(ctx, () => Promise.resolve(fn(ctx)));
}

// Variant used by long-running tasks (ingestion, ontology rebuild) that have
// an explicit workspace id and don't get it from a request.
export async function withWorkspaceId<T>(
  workspaceId: string,
  fn: (ctx: WorkspaceContext) => Promise<T> | T
): Promise<T> {
  adoptLegacyWorkspace();
  const record = getWorkspace(workspaceId);
  if (!record) throw new Error(`Unknown workspace: ${workspaceId}`);
  const ctx = toContext(record);
  return als.run(ctx, () => Promise.resolve(fn(ctx)));
}
