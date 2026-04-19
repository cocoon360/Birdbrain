import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Workspace registry. A workspace is a folder on disk that Bird Brain has
// ingested into its own self-contained `.birdbrain/app.db` SQLite file. The
// registry at ~/.birdbrain/workspaces.json is the only source of truth for
// which folders exist as workspaces and where their databases live.

export interface WorkspaceRecord {
  id: string;
  name: string;
  folder_path: string;
  db_path: string;
  created_at: number;
  last_opened_at: number | null;
}

interface RegistryFile {
  schemaVersion: number;
  workspaces: WorkspaceRecord[];
}

const REGISTRY_DIR = path.join(os.homedir(), '.birdbrain');
const REGISTRY_PATH = path.join(REGISTRY_DIR, 'workspaces.json');
const DEFAULT_FILE: RegistryFile = { schemaVersion: 1, workspaces: [] };

function ensureRegistryDir() {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  }
}

function readRegistry(): RegistryFile {
  ensureRegistryDir();
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { ...DEFAULT_FILE };
  }
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (typeof parsed !== 'object' || !Array.isArray(parsed.workspaces)) {
      return { ...DEFAULT_FILE };
    }
    return parsed;
  } catch {
    return { ...DEFAULT_FILE };
  }
}

function writeRegistry(data: RegistryFile) {
  ensureRegistryDir();
  const tmp = REGISTRY_PATH + `.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, REGISTRY_PATH);
}

function newWorkspaceId() {
  const rand = crypto.randomBytes(6).toString('hex');
  return `ws_${rand}`;
}

function deriveWorkspaceName(folderPath: string) {
  const base = path.basename(path.resolve(folderPath));
  return (
    base
      .replace(/^[_\d]+/, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ') || base
  );
}

function defaultDbPathFor(folderPath: string) {
  return path.join(path.resolve(folderPath), '.birdbrain', 'app.db');
}

export function listWorkspaces(): WorkspaceRecord[] {
  return readRegistry().workspaces;
}

export function getWorkspace(id: string): WorkspaceRecord | null {
  const reg = readRegistry();
  return reg.workspaces.find((w) => w.id === id) ?? null;
}

export function getWorkspaceByFolder(folderPath: string): WorkspaceRecord | null {
  const abs = path.resolve(folderPath);
  const reg = readRegistry();
  return reg.workspaces.find((w) => path.resolve(w.folder_path) === abs) ?? null;
}

export interface AddWorkspaceInput {
  folderPath: string;
  name?: string;
  dbPath?: string;
}

export function addWorkspace(input: AddWorkspaceInput): WorkspaceRecord {
  const folderAbs = path.resolve(input.folderPath);
  if (!fs.existsSync(folderAbs)) {
    throw new Error(`Folder does not exist: ${folderAbs}`);
  }
  if (!fs.statSync(folderAbs).isDirectory()) {
    throw new Error(`Path is not a directory: ${folderAbs}`);
  }
  const existing = getWorkspaceByFolder(folderAbs);
  if (existing) return existing;

  const record: WorkspaceRecord = {
    id: newWorkspaceId(),
    name: (input.name ?? '').trim() || deriveWorkspaceName(folderAbs),
    folder_path: folderAbs,
    db_path: path.resolve(input.dbPath ?? defaultDbPathFor(folderAbs)),
    created_at: Math.floor(Date.now() / 1000),
    last_opened_at: null,
  };

  // Make sure the .birdbrain/ dir exists next to the workspace folder (or
  // wherever the caller asked for the DB to live).
  const dbDir = path.dirname(record.db_path);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const reg = readRegistry();
  reg.workspaces.push(record);
  writeRegistry(reg);
  return record;
}

export function removeWorkspace(id: string): boolean {
  const reg = readRegistry();
  const next = reg.workspaces.filter((w) => w.id !== id);
  if (next.length === reg.workspaces.length) return false;
  writeRegistry({ ...reg, workspaces: next });
  return true;
}

export function touchWorkspace(id: string) {
  const reg = readRegistry();
  const idx = reg.workspaces.findIndex((w) => w.id === id);
  if (idx < 0) return;
  reg.workspaces[idx] = {
    ...reg.workspaces[idx],
    last_opened_at: Math.floor(Date.now() / 1000),
  };
  writeRegistry(reg);
}

export function renameWorkspace(id: string, name: string): WorkspaceRecord | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const reg = readRegistry();
  const idx = reg.workspaces.findIndex((w) => w.id === id);
  if (idx < 0) return null;
  reg.workspaces[idx] = { ...reg.workspaces[idx], name: trimmed };
  writeRegistry(reg);
  return reg.workspaces[idx];
}

// One-time migration: if there is a legacy single-DB at data/birdbrain.sqlite
// (configured via DB_PATH or the default) and no registry entry already points
// to it, adopt it as a workspace named after whatever DOCS_PATH pointed to.
// This runs every request but is cheap and idempotent: once the workspace is
// in the registry it is skipped.
export function adoptLegacyWorkspace() {
  const legacyDb = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(process.cwd(), '..', 'data', 'birdbrain.sqlite');
  if (!fs.existsSync(legacyDb)) return;

  const reg = readRegistry();
  const already = reg.workspaces.some(
    (w) => path.resolve(w.db_path) === path.resolve(legacyDb)
  );
  if (already) return;

  // Only use DOCS_PATH when adopting legacy DBs; avoid guessing an in-repo
  // game folder (those often live outside the clone or are gitignored).
  const legacyDocs = process.env.DOCS_PATH?.trim()
    ? path.resolve(process.env.DOCS_PATH.trim())
    : '';
  const folderPath =
    legacyDocs && fs.existsSync(legacyDocs) ? legacyDocs : path.dirname(legacyDb);

  const record: WorkspaceRecord = {
    id: newWorkspaceId(),
    name: `${deriveWorkspaceName(folderPath)} (imported)`,
    folder_path: folderPath,
    db_path: legacyDb,
    created_at: Math.floor(Date.now() / 1000),
    last_opened_at: null,
  };
  reg.workspaces.push(record);
  writeRegistry(reg);
}

// Exposed for tests / tools that need the raw file path.
export function registryFilePath() {
  return REGISTRY_PATH;
}
