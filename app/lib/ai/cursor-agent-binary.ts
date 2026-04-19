import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Shared resolution for the `cursor-agent` / `agent` CLI binary.
 * Used by the engine runner and the `/api/engine/models` route so paths
 * stay in sync.
 */
export function tryResolveCursorAgentBinary(): string | null {
  const explicit = process.env.CURSOR_AGENT_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'cursor-agent'),
    path.join(home, '.local', 'bin', 'agent'),
    '/usr/local/bin/cursor-agent',
    '/usr/local/bin/agent',
    '/opt/homebrew/bin/cursor-agent',
    '/opt/homebrew/bin/agent',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
