import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';

// Workspace registry. A workspace is a folder on disk that Bird Brain reads,
// while Bird Brain's own app data lives under the repo-level data/ folder. We
// intentionally do not create hidden database folders inside the source corpus.

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

const LEGACY_HOME_DIR = path.join(os.homedir(), '.birdbrain');
const LEGACY_REGISTRY_PATH = path.join(LEGACY_HOME_DIR, 'workspaces.json');
const LEGACY_WORKSPACE_DB_DIR = path.join(LEGACY_HOME_DIR, 'workspace-dbs');
const APP_DATA_DIR = process.env.BIRDBRAIN_DATA_DIR
  ? path.resolve(process.env.BIRDBRAIN_DATA_DIR)
  : path.resolve(process.cwd(), path.basename(process.cwd()) === 'app' ? '..' : '.', 'data');
const REGISTRY_PATH = path.join(APP_DATA_DIR, 'workspaces.json');
const WORKSPACE_DB_DIR = path.join(APP_DATA_DIR, 'workspace-dbs');
const DEFAULT_FILE: RegistryFile = { schemaVersion: 1, workspaces: [] };
const DEMO_MODE_WORKSPACE_ID = 'demo_mode';
const DEMO_MODE_WORKSPACE_NAME = 'Demo Mode';

function ensureRegistryDir() {
  if (!fs.existsSync(APP_DATA_DIR)) {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
  }
}

function readRegistryFile(filePath: string): RegistryFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (typeof parsed !== 'object' || !Array.isArray(parsed.workspaces)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function workspaceFolderKey(folderPath: string) {
  return path.resolve(folderPath).toLowerCase();
}

function mergeLegacyRegistry(reg: RegistryFile): RegistryFile {
  const legacy = readRegistryFile(LEGACY_REGISTRY_PATH);
  if (!legacy) return reg;

  const ids = new Set(reg.workspaces.map((workspace) => workspace.id));
  const folders = new Set(reg.workspaces.map((workspace) => workspaceFolderKey(workspace.folder_path)));
  const merged = [...reg.workspaces];
  let changed = false;

  for (const workspace of legacy.workspaces) {
    if (ids.has(workspace.id) || folders.has(workspaceFolderKey(workspace.folder_path))) continue;
    merged.push(workspace);
    ids.add(workspace.id);
    folders.add(workspaceFolderKey(workspace.folder_path));
    changed = true;
  }

  if (!changed) return reg;
  const next = { ...reg, workspaces: merged };
  writeRegistry(next);
  return next;
}

function readRegistry(): RegistryFile {
  ensureRegistryDir();
  if (!fs.existsSync(REGISTRY_PATH) && fs.existsSync(LEGACY_REGISTRY_PATH)) {
    fs.copyFileSync(LEGACY_REGISTRY_PATH, REGISTRY_PATH);
  }
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { ...DEFAULT_FILE };
  }
  return mergeLegacyRegistry(readRegistryFile(REGISTRY_PATH) ?? { ...DEFAULT_FILE });
}

function writeRegistry(data: RegistryFile) {
  ensureRegistryDir();
  const tmp = REGISTRY_PATH + `.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, REGISTRY_PATH);
}

function bundledDemoModeDbPath() {
  const explicit = process.env.BIRDBRAIN_DEMO_MODE_DB?.trim();
  const candidates = [
    explicit ? path.resolve(explicit) : '',
    path.resolve(process.cwd(), 'demo', 'demo-mode', 'app.db'),
    path.resolve(process.cwd(), '..', 'app', 'demo', 'demo-mode', 'app.db'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function forceDemoModeEngine(dbPath: string) {
  const db = new Database(dbPath);
  try {
    const stmt = db.prepare(
      `INSERT INTO project_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    const tx = db.transaction(() => {
      stmt.run('engine_provider', 'local');
      stmt.run('engine_model', '');
      stmt.run('engine_endpoint', '');
      stmt.run('engine_api_key_env', '');
    });
    tx();
  } finally {
    db.close();
  }
}

export function ensureDemoModeWorkspace(): WorkspaceRecord | null {
  const sourceDb = bundledDemoModeDbPath();
  if (!sourceDb) return null;

  ensureRegistryDir();
  const targetBase = path.join(APP_DATA_DIR, 'demo-mode');
  const targetDb = path.join(targetBase, 'app.db');
  fs.mkdirSync(targetBase, { recursive: true });

  const refresh = process.env.BIRDBRAIN_REFRESH_DEMO === '1';
  if (refresh || !fs.existsSync(targetDb)) {
    fs.copyFileSync(sourceDb, targetDb);
  }
  forceDemoModeEngine(targetDb);

  const now = Math.floor(Date.now() / 1000);
  const record: WorkspaceRecord = {
    id: DEMO_MODE_WORKSPACE_ID,
    name: DEMO_MODE_WORKSPACE_NAME,
    folder_path: targetBase,
    db_path: targetDb,
    created_at: now,
    last_opened_at: null,
  };

  const reg = readRegistry();
  const existingIndex = reg.workspaces.findIndex((workspace) => workspace.id === DEMO_MODE_WORKSPACE_ID);
  if (existingIndex >= 0) {
    const existing = reg.workspaces[existingIndex];
    const next = {
      ...existing,
      name: existing.name || DEMO_MODE_WORKSPACE_NAME,
      folder_path: targetBase,
      db_path: targetDb,
    };
    if (
      next.name !== existing.name ||
      next.folder_path !== existing.folder_path ||
      next.db_path !== existing.db_path
    ) {
      reg.workspaces[existingIndex] = next;
      writeRegistry(reg);
    }
    return next;
  }

  reg.workspaces.unshift(record);
  writeRegistry(reg);
  return record;
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

function appOwnedDbPathFor(workspaceId: string) {
  return path.join(WORKSPACE_DB_DIR, workspaceId, 'app.db');
}

function oldInCorpusDbPathFor(folderPath: string) {
  return path.join(path.resolve(folderPath), '.birdbrain', 'app.db');
}

function legacyHomeDbPathFor(workspaceId: string) {
  return path.join(LEGACY_WORKSPACE_DB_DIR, workspaceId, 'app.db');
}

function migrateWorkspaceStorage(reg: RegistryFile): RegistryFile {
  let changed = false;
  const workspaces = reg.workspaces.map((workspace) => {
    const dbPath = path.resolve(workspace.db_path);
    const oldInCorpusPath = oldInCorpusDbPathFor(workspace.folder_path);
    const oldHomePath = legacyHomeDbPathFor(workspace.id);
    const shouldMigrate =
      dbPath === path.resolve(oldInCorpusPath) || dbPath === path.resolve(oldHomePath);
    if (!shouldMigrate) return workspace;

    const nextPath = appOwnedDbPathFor(workspace.id);
    if (!fs.existsSync(path.dirname(nextPath))) fs.mkdirSync(path.dirname(nextPath), { recursive: true });
    if (fs.existsSync(dbPath) && !fs.existsSync(nextPath)) {
      fs.copyFileSync(dbPath, nextPath);
    }
    changed = true;
    return { ...workspace, db_path: nextPath };
  });

  if (!changed) return reg;
  const next = { ...reg, workspaces };
  writeRegistry(next);
  return next;
}

export function listWorkspaces(): WorkspaceRecord[] {
  return migrateWorkspaceStorage(readRegistry()).workspaces;
}

export function getWorkspace(id: string): WorkspaceRecord | null {
  const reg = migrateWorkspaceStorage(readRegistry());
  return reg.workspaces.find((w) => w.id === id) ?? null;
}

export function getWorkspaceByFolder(folderPath: string): WorkspaceRecord | null {
  const abs = path.resolve(folderPath);
  const reg = migrateWorkspaceStorage(readRegistry());
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

  const id = newWorkspaceId();
  const record: WorkspaceRecord = {
    id,
    name: (input.name ?? '').trim() || deriveWorkspaceName(folderAbs),
    folder_path: folderAbs,
    db_path: path.resolve(input.dbPath ?? appOwnedDbPathFor(id)),
    created_at: Math.floor(Date.now() / 1000),
    last_opened_at: null,
  };

  // Make sure Bird Brain's app-owned DB directory exists. The source folder
  // remains read-only from a storage/layout perspective.
  const dbDir = path.dirname(record.db_path);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const reg = readRegistry();
  reg.workspaces.push(record);
  writeRegistry(reg);
  return record;
}

export function removeWorkspace(id: string): boolean {
  const reg = migrateWorkspaceStorage(readRegistry());
  const next = reg.workspaces.filter((w) => w.id !== id);
  if (next.length === reg.workspaces.length) return false;
  writeRegistry({ ...reg, workspaces: next });
  return true;
}

export function touchWorkspace(id: string) {
  const reg = migrateWorkspaceStorage(readRegistry());
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
  const reg = migrateWorkspaceStorage(readRegistry());
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
  // Without an explicit docs path, the legacy DB often points at app fixture
  // data rather than a real project. Do not pollute the picker with a
  // rebuildable/imported "Data" workspace.
  if (!legacyDocs) return;
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
