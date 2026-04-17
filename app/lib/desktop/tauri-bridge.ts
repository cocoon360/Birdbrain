// Thin wrapper over @tauri-apps/api. We import lazily so the Next.js
// bundle still runs in a plain browser (and in `next dev`) without the
// library present. When the page is loaded inside the Tauri webview the
// import resolves and we wire IPC commands; otherwise the helpers degrade
// to web-only fallbacks.

export interface TauriPickedFolder {
  path: string;
  name: string;
}

interface TauriInvoke {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
}

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as TauriWindow;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI_IPC__);
}

async function getInvoke(): Promise<TauriInvoke['invoke'] | null> {
  if (!isTauri()) return null;
  try {
    // Webpack ignores this import at build time because the package is only
    // present when running inside the Tauri webview. Cast through unknown to
    // avoid a hard dependency on the @tauri-apps/api types at compile time.
    const mod = (await import(/* webpackIgnore: true */ '@tauri-apps/api/core' as string)) as unknown as {
      invoke: TauriInvoke['invoke'];
    };
    return mod.invoke;
  } catch {
    return null;
  }
}

export async function pickFolderNative(): Promise<TauriPickedFolder | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return (await invoke<TauriPickedFolder | null>('pick_folder')) ?? null;
}

export async function openWorkspaceWindow(
  workspaceId: string,
  title?: string
): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke) return false;
  await invoke('open_workspace_window', { workspaceId, title });
  return true;
}

export async function keychainGet(envVar: string): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return (await invoke<string | null>('keychain_get', { envVar })) ?? null;
}

export async function keychainSet(envVar: string, value: string): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke) return false;
  await invoke('keychain_set', { envVar, value });
  return true;
}

export async function keychainClear(envVar: string): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke) return false;
  await invoke('keychain_clear', { envVar });
  return true;
}
