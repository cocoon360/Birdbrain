'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useOptionalWorkspace } from './WorkspaceProvider';
import { logParticipation } from '../lib/participation/log';

export type SynthesisMode = 'live' | 'queued';
type BranchSource = 'root' | 'known' | 'candidate' | 'related' | 'external';
type BranchStatus = 'idle' | 'pending' | 'ready';

export interface BranchStep {
  slug: string;
  source: BranchSource;
  at: number;
  fromSlug: string | null;
}

export interface BranchRecord {
  id: string;
  label: string;
  rootSlug: string;
  currentSlug: string;
  parentBranchId: string | null;
  unread: boolean;
  createdAt: number;
  updatedAt: number;
  status: BranchStatus;
  path: BranchStep[];
}

interface OpenConceptOptions {
  branch?: 'new' | 'current';
  source?: BranchSource;
  label?: string;
  spawnSuggestion?: boolean;
}

interface DossierState {
  conceptSlug: string | null;
  docId: number | null;
  synthesisMode: SynthesisMode;
  setSynthesisMode: (mode: SynthesisMode) => void;
  branches: BranchRecord[];
  activeBranchId: string | null;
  activeBranch: BranchRecord | null;
  branchContext: {
    branchId: string | null;
    rootSlug: string | null;
    fromSlug: string | null;
  };
  openConcept: (slug: string, options?: OpenConceptOptions) => void;
  openBranch: (branchId: string) => void;
  openBranchStep: (branchId: string, stepIndex: number) => void;
  openDoc: (id: number) => void;
  markBranchStatus: (slug: string, status: BranchStatus) => void;
  resetSession: () => void;
  close: () => void;
}

const DossierCtx = createContext<DossierState | null>(null);
const LEGACY_BRANCH_KEY = 'birdbrain:branches-v1';

// Each workspace gets its own isolated branches / mode / signature so
// switching between projects does not leak exploration state. When no
// workspace is bound we fall back to the pre-workspace key names so local
// dev and tests keep behaving the same.
function modeKey(workspaceId: string | null) {
  return workspaceId ? `birdbrain:${workspaceId}:synthesis-mode` : 'birdbrain:synthesis-mode';
}
function branchKey(workspaceId: string | null) {
  return workspaceId ? `birdbrain:${workspaceId}:branches-v2` : 'birdbrain:branches-v2';
}
function ontologySignatureKey(workspaceId: string | null) {
  return workspaceId
    ? `birdbrain:${workspaceId}:ontology-signature`
    : 'birdbrain:ontology-signature';
}

interface BranchStore {
  schemaVersion: number;
  branches: BranchRecord[];
  activeBranchId: string | null;
}

function loadMode(workspaceId: string | null): SynthesisMode {
  if (typeof window === 'undefined') return 'live';
  const raw = window.localStorage.getItem(modeKey(workspaceId));
  return raw === 'queued' ? 'queued' : 'live';
}

function loadBranches(workspaceId: string | null): BranchStore {
  if (typeof window === 'undefined') return { schemaVersion: 2, branches: [], activeBranchId: null };
  try {
    const raw = window.localStorage.getItem(branchKey(workspaceId));
    if (!raw) return { schemaVersion: 2, branches: [], activeBranchId: null };
    const parsed = JSON.parse(raw) as BranchStore;
    if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.branches)) {
      return { schemaVersion: 2, branches: [], activeBranchId: null };
    }
    return parsed;
  } catch {
    return { schemaVersion: 2, branches: [], activeBranchId: null };
  }
}

function saveMode(mode: SynthesisMode, workspaceId: string | null) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(modeKey(workspaceId), mode);
  }
}

function saveBranches(store: BranchStore, workspaceId: string | null) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(branchKey(workspaceId), JSON.stringify(store));
  }
}

function branchId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `branch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function humanize(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function sortBranches(branches: BranchRecord[]) {
  return [...branches].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function DossierProvider({ children }: { children: ReactNode }) {
  const workspace = useOptionalWorkspace();
  const workspaceId = workspace?.id ?? null;
  const [conceptSlug, setConceptSlug] = useState<string | null>(null);
  const [docId, setDocId] = useState<number | null>(null);
  const [synthesisMode, setSynthesisModeState] = useState<SynthesisMode>('live');
  const [branchStore, setBranchStore] = useState<BranchStore>({
    schemaVersion: 2,
    branches: [],
    activeBranchId: null,
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LEGACY_BRANCH_KEY);
    }
    setSynthesisModeState(loadMode(workspaceId));
    setBranchStore(loadBranches(workspaceId));
    setConceptSlug(null);
    setDocId(null);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    async function syncOntologySignature() {
      try {
        const res = await fetch('/api/startup/status', { cache: 'no-store' });
        const data = (await res.json()) as {
          status?: { ontology_corpus_signature: string | null };
        };
        if (cancelled || typeof window === 'undefined') return;
        const latest = data.status?.ontology_corpus_signature ?? '';
        const sigKey = ontologySignatureKey(workspaceId);
        const previous = window.localStorage.getItem(sigKey) ?? '';
        if (latest && previous && latest !== previous) {
          setConceptSlug(null);
          setDocId(null);
          setBranchStore({ schemaVersion: 2, branches: [], activeBranchId: null });
          window.localStorage.removeItem(branchKey(workspaceId));
        }
        if (latest) {
          window.localStorage.setItem(sigKey, latest);
        }
      } catch {
        // best-effort cleanup only
      }
    }
    syncOntologySignature();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    saveMode(synthesisMode, workspaceId);
  }, [synthesisMode, workspaceId]);

  useEffect(() => {
    saveBranches(branchStore, workspaceId);
  }, [branchStore, workspaceId]);

  const activeBranch = useMemo(
    () => branchStore.branches.find((branch) => branch.id === branchStore.activeBranchId) ?? null,
    [branchStore]
  );

  const branchContext = useMemo(() => {
    if (!activeBranch) {
      return { branchId: null, rootSlug: null, fromSlug: null };
    }
    const fromSlug =
      activeBranch.path.length > 1
        ? activeBranch.path[activeBranch.path.length - 2]?.slug ?? null
        : activeBranch.path[0]?.fromSlug ?? null;
    return {
      branchId: activeBranch.id,
      rootSlug: activeBranch.rootSlug,
      fromSlug,
    };
  }, [activeBranch]);

  const setSynthesisMode = useCallback((mode: SynthesisMode) => {
    setSynthesisModeState(mode);
  }, []);

  const openConcept = useCallback((slug: string, options: OpenConceptOptions = {}) => {
    const source = options.source ?? 'root';
    const label = options.label ?? humanize(slug);
    const branchMode = options.branch ?? 'new';
    setDocId(null);
    setConceptSlug(slug);

    // Participation log (fire-and-forget) — every concept open is an attention
    // event. fromSlug is taken from whatever is currently active in the
    // branch, so bridging and memesis can reason over it.
    setBranchStore((prev) => {
      const active = prev.branches.find((b) => b.id === prev.activeBranchId) ?? null;
      const fromSlug = branchMode === 'new' ? null : active?.currentSlug ?? null;
      logParticipation(workspaceId, {
        kind: 'open_concept',
        slug,
        fromSlug,
        source,
      });
      return prev;
    });

    setBranchStore((prev) => {
      const now = Date.now();
      const active = prev.branches.find((branch) => branch.id === prev.activeBranchId) ?? null;

      if (branchMode === 'new' || !active) {
        const created: BranchRecord = {
          id: branchId(),
          label,
          rootSlug: slug,
          currentSlug: slug,
          parentBranchId: null,
          unread: false,
          createdAt: now,
          updatedAt: now,
          status: 'idle',
          path: [{ slug, source: 'root', at: now, fromSlug: null }],
        };
        return {
          schemaVersion: 2,
          branches: sortBranches([created, ...prev.branches]),
          activeBranchId: created.id,
        };
      }

      const nextBranches = prev.branches.map((branch) => {
        if (branch.id !== active.id) return branch;
        const previousSlug = branch.currentSlug;
        const alreadyCurrent = previousSlug === slug;
        return {
          ...branch,
          label: branch.label || label,
          currentSlug: slug,
          unread: false,
          updatedAt: now,
          path: alreadyCurrent
            ? branch.path
            : [
                ...branch.path,
                {
                  slug,
                  source,
                  at: now,
                  fromSlug: previousSlug,
                },
              ],
        };
      });

      if (!options.spawnSuggestion) {
        return {
          schemaVersion: 2,
          branches: sortBranches(nextBranches),
          activeBranchId: active.id,
        };
      }

      const suggestionIndex = nextBranches.findIndex(
        (branch) => branch.rootSlug === slug && branch.parentBranchId === active.id
      );
      if (suggestionIndex >= 0) {
        nextBranches[suggestionIndex] = {
          ...nextBranches[suggestionIndex],
          label,
          currentSlug: slug,
          unread: true,
          updatedAt: now,
        };
      } else {
        nextBranches.push({
          id: branchId(),
          label,
          rootSlug: slug,
          currentSlug: slug,
          parentBranchId: active.id,
          unread: true,
          createdAt: now,
          updatedAt: now,
          status: 'idle',
          path: [
            {
              slug,
              source: 'root',
              at: now,
              fromSlug: active.currentSlug,
            },
          ],
        });
      }

      return {
        schemaVersion: 2,
        branches: sortBranches(nextBranches),
        activeBranchId: active.id,
      };
    });
  }, [workspaceId]);

  const openBranch = useCallback((id: string) => {
    const target = branchStore.branches.find((item) => item.id === id);
    if (!target) return;
    setDocId(null);
    setConceptSlug(target.currentSlug);
    setBranchStore((prev) => {
      return {
        schemaVersion: prev.schemaVersion,
        activeBranchId: id,
        branches: sortBranches(
          prev.branches.map((item) =>
            item.id === id ? { ...item, unread: false, updatedAt: Date.now() } : item
          )
        ),
      };
    });
  }, [branchStore.branches]);

  const openBranchStep = useCallback(
    (branchId: string, stepIndex: number) => {
      const target = branchStore.branches.find((item) => item.id === branchId);
      const step = target?.path[stepIndex];
      if (!target || !step) return;
      setDocId(null);
      setConceptSlug(step.slug);
      setBranchStore((prev) => ({
        schemaVersion: prev.schemaVersion,
        activeBranchId: branchId,
        branches: sortBranches(
          prev.branches.map((item) =>
            item.id === branchId
              ? {
                  ...item,
                  unread: false,
                  updatedAt: Date.now(),
                  currentSlug: step.slug,
                }
              : item
          )
        ),
      }));
    },
    [branchStore.branches]
  );

  const openDoc = useCallback((id: number) => {
    setConceptSlug(null);
    setDocId(id);
    logParticipation(workspaceId, { kind: 'open_doc', docId: id });
  }, [workspaceId]);

  const markBranchStatus = useCallback((slug: string, status: BranchStatus) => {
    setBranchStore((prev) => ({
      schemaVersion: prev.schemaVersion,
      activeBranchId: prev.activeBranchId,
      branches: prev.branches.map((branch) => {
        if (branch.currentSlug !== slug && branch.rootSlug !== slug) return branch;
        return { ...branch, status };
      }),
    }));
  }, []);

  const close = useCallback(() => {
    setConceptSlug(null);
    setDocId(null);
  }, []);

  const resetSession = useCallback(() => {
    setConceptSlug(null);
    setDocId(null);
    setBranchStore({ schemaVersion: 2, branches: [], activeBranchId: null });
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(branchKey(workspaceId));
      // A session reset is itself an event worth recording BEFORE the
      // session id rotates, so the Journal retains the shape of the prior
      // reading even after the user nukes their trail in the UI.
      logParticipation(workspaceId, { kind: 'reset' });
      // Rotate the server session id by clearing the participation cell so
      // the next event starts a fresh session.
      const key = workspaceId
        ? `birdbrain:${workspaceId}:participation-session`
        : 'birdbrain:participation-session';
      window.localStorage.removeItem(key);
    }
  }, [workspaceId]);

  return (
    <DossierCtx.Provider
      value={{
        conceptSlug,
        docId,
        synthesisMode,
        setSynthesisMode,
        branches: branchStore.branches,
        activeBranchId: branchStore.activeBranchId,
        activeBranch,
        branchContext,
        openConcept,
        openBranch,
        openBranchStep,
        openDoc,
        markBranchStatus,
        resetSession,
        close,
      }}
    >
      {children}
    </DossierCtx.Provider>
  );
}

export function useDossier(): DossierState {
  const ctx = useContext(DossierCtx);
  if (!ctx) throw new Error('useDossier must be used inside DossierProvider');
  return ctx;
}
