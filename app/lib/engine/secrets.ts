import fs from 'fs';
import path from 'path';
import os from 'os';

// Secret resolution order for API keys (OpenAI, Anthropic, etc.):
//   1. Registered resolver — used by the Tauri wrapper to proxy to the
//      OS keychain via IPC. Registered at boot from the desktop host.
//   2. Process env vars — covers `npm run dev`, CI, and any sidecar
//      started with the env already set.
//   3. Local fallback file at ~/.birdbrain/secrets.json — convenience for
//      the web preview so users can paste a key into the UI without
//      editing shell profiles. Plain JSON, chmod 600 on create. This is
//      NOT considered secure; the OS keychain replaces it in desktop.
//
// All values are trimmed. Empty strings are treated as "not set".

export type SecretResolver = (envVarName: string) => Promise<string | null> | string | null;

let registered: SecretResolver | null = null;

export function registerSecretResolver(resolver: SecretResolver | null) {
  registered = resolver;
}

const LOCAL_SECRETS_DIR = path.join(os.homedir(), '.birdbrain');
const LOCAL_SECRETS_PATH = path.join(LOCAL_SECRETS_DIR, 'secrets.json');

interface LocalSecretFile {
  [envVarName: string]: string;
}

function readLocalSecrets(): LocalSecretFile {
  try {
    if (!fs.existsSync(LOCAL_SECRETS_PATH)) return {};
    const text = fs.readFileSync(LOCAL_SECRETS_PATH, 'utf8');
    const parsed = JSON.parse(text) as LocalSecretFile;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeLocalSecrets(next: LocalSecretFile) {
  fs.mkdirSync(LOCAL_SECRETS_DIR, { recursive: true });
  fs.writeFileSync(LOCAL_SECRETS_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(LOCAL_SECRETS_PATH, 0o600);
  } catch {
    // chmod is best-effort on platforms that ignore it
  }
}

export async function resolveSecret(envVarName: string): Promise<string | null> {
  if (!envVarName) return null;

  if (registered) {
    try {
      const external = await registered(envVarName);
      if (external && external.trim().length > 0) return external.trim();
    } catch {
      // fall through to env + local
    }
  }

  const fromEnv = process.env[envVarName];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  const local = readLocalSecrets();
  const fromLocal = local[envVarName];
  if (fromLocal && fromLocal.trim().length > 0) return fromLocal.trim();

  return null;
}

export function setLocalSecret(envVarName: string, value: string | null) {
  const current = readLocalSecrets();
  if (value && value.trim().length > 0) {
    current[envVarName] = value.trim();
  } else {
    delete current[envVarName];
  }
  writeLocalSecrets(current);
}

export function listLocalSecretKeys(): string[] {
  return Object.keys(readLocalSecrets());
}

export function hasSecretSource(envVarName: string): {
  env: boolean;
  local: boolean;
  registered: boolean;
} {
  return {
    env: Boolean(process.env[envVarName] && process.env[envVarName]!.trim().length > 0),
    local: Boolean(readLocalSecrets()[envVarName]),
    registered: Boolean(registered),
  };
}
