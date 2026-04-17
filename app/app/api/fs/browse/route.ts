import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Local-only folder browser. This is safe because Bird Brain runs on the
// user's own machine (dev server or Tauri sidecar on 127.0.0.1). We only
// list directory entries — never file contents — so the worst a rogue
// request can do is enumerate folder names, which any local user process
// could already do. In the bundled desktop build the native folder picker
// is preferred and this endpoint becomes a fallback.

interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const requested = url.searchParams.get('path');
  const home = os.homedir();
  let target = requested && requested.trim() ? requested : home;
  if (target === '~') target = home;
  else if (target.startsWith('~/')) target = path.join(home, target.slice(2));

  target = path.resolve(target);

  try {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: `Not a directory: ${target}` }, { status: 400 });
    }

    const entries = await fs.readdir(target, { withFileTypes: true });
    const folders: Entry[] = entries
      .filter((entry) => {
        if (entry.name.startsWith('.')) return false;
        try {
          return entry.isDirectory();
        } catch {
          return false;
        }
      })
      .map((entry) => ({
        name: entry.name,
        path: path.join(target, entry.name),
        is_dir: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(target);
    const quick: Entry[] = [];
    const pushQuick = (label: string, dir: string) => {
      if (dir && dir !== target) {
        quick.push({ name: label, path: dir, is_dir: true });
      }
    };
    pushQuick('Home', home);
    pushQuick('Desktop', path.join(home, 'Desktop'));
    pushQuick('Documents', path.join(home, 'Documents'));
    pushQuick('Downloads', path.join(home, 'Downloads'));

    return NextResponse.json({
      path: target,
      parent: parent !== target ? parent : null,
      folders,
      quick,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not read directory ${target}: ${message}` },
      { status: 400 }
    );
  }
}
