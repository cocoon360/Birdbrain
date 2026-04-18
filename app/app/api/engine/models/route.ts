import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { withWorkspaceRoute } from '@/lib/workspaces/route';

// Returns the list of models the local cursor-agent CLI actually accepts,
// parsed from `agent models`. We curate a small grouped shortlist (newest
// few per provider) for the dropdown, but also return the raw list so the
// UI can offer a "show all" toggle.

export interface ModelRow {
  id: string;
  label: string;
  note?: string; // "(current)" | "(default)"
}

export interface ModelGroup {
  name: string;
  ids: string[];
}

// Curated shortlist. IDs only appear in the dropdown if the local CLI
// actually reports them — keeps us honest across CLI version bumps.
const CURATED_GROUPS: ModelGroup[] = [
  {
    name: 'Cursor (fast / default)',
    ids: ['auto', 'composer-2-fast', 'composer-2'],
  },
  {
    name: 'Anthropic (Claude)',
    ids: [
      'claude-opus-4-7-high',
      'claude-opus-4-7-thinking-high',
      'claude-4.6-sonnet-medium',
      'claude-4.5-opus-high',
      'claude-4-sonnet',
    ],
  },
  {
    name: 'OpenAI (GPT)',
    ids: ['gpt-5.4-high', 'gpt-5.4-medium', 'gpt-5.4-mini-medium'],
  },
  {
    name: 'Google (Gemini)',
    ids: ['gemini-3.1-pro', 'gemini-3-flash'],
  },
  {
    name: 'xAI (Grok)',
    ids: ['grok-4-20', 'grok-4-20-thinking'],
  },
  {
    name: 'Other',
    ids: ['kimi-k2.5'],
  },
];

function resolveBinary(): string | null {
  const explicit = process.env.CURSOR_AGENT_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'cursor-agent'),
    path.join(os.homedir(), '.local', 'bin', 'agent'),
    '/usr/local/bin/cursor-agent',
    '/usr/local/bin/agent',
    '/opt/homebrew/bin/cursor-agent',
    '/opt/homebrew/bin/agent',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function runModels(): Promise<string> {
  const bin = resolveBinary();
  if (!bin) return Promise.reject(new Error('cursor-agent binary not found'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['models'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('cursor-agent models timed out'));
    }, 30_000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `models exited with code ${code}`));
      resolve(out);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function parseModels(raw: string): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    // Match: "id - Label" optionally followed by "  (current)" or "(default)"
    const m = line.match(/^\s*([a-z0-9][a-z0-9.\-_]*)\s+-\s+(.+?)(?:\s*\((current|default)\))?\s*$/i);
    if (!m) continue;
    rows.push({ id: m[1], label: m[2].trim(), note: m[3]?.toLowerCase() });
  }
  return rows;
}

function buildCuratedGroups(all: ModelRow[]): Array<{ name: string; models: ModelRow[] }> {
  const byId = new Map(all.map((m) => [m.id, m]));
  return CURATED_GROUPS.map((group) => ({
    name: group.name,
    models: group.ids.map((id) => byId.get(id)).filter((m): m is ModelRow => Boolean(m)),
  })).filter((group) => group.models.length > 0);
}

export async function GET(req: NextRequest) {
  return withWorkspaceRoute(req, async () => {
    try {
      const raw = await runModels();
      const all = parseModels(raw);
      const groups = buildCuratedGroups(all);
      return NextResponse.json({ ok: true, groups, all });
    } catch (err) {
      return NextResponse.json(
        { ok: false, groups: [], all: [], error: err instanceof Error ? err.message : String(err) },
        { status: 200 }
      );
    }
  });
}
