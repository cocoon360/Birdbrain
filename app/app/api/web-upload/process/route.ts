import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase, WEB_UPLOAD_BUCKET } from '@/lib/supabase/server';
import { safeUploadRelativePath, shouldAcceptUploadPath } from '@/lib/web-upload/filter';
import { addWorkspace } from '@/lib/workspaces/registry';
import { withWorkspaceId } from '@/lib/workspaces/context';
import { runIngestion } from '@/lib/ingest/ingest';

export const maxDuration = 300;

interface ProcessBody {
  uploadId?: string;
  bucket?: string;
  workspaceName?: string;
  files?: Array<{
    relativePath?: string;
    objectPath?: string;
    size?: number;
  }>;
}

interface MaterializeStats {
  accepted: number;
  skipped: number;
  bytes: number;
  outputDir: string;
}

const DEFAULT_MAX_ACCEPTED_BYTES = Number(process.env.BIRDBRAIN_WEB_ACCEPTED_TEXT_MAX_BYTES || 25 * 1024 * 1024);
const DEFAULT_MAX_FILES = Number(process.env.BIRDBRAIN_WEB_ACCEPTED_FILE_MAX || 1000);

export async function POST(req: NextRequest) {
  let body: ProcessBody = {};
  try {
    body = (await req.json()) as ProcessBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const uploadId = (body.uploadId || '').trim();
  const bucket = (body.bucket || WEB_UPLOAD_BUCKET).trim();
  const workspaceName = safeWorkspaceName(body.workspaceName) || `Upload ${uploadId.slice(0, 6)}`;
  const files = normalizeManifest(uploadId, body.files || []);
  if (!uploadId || files.length === 0) {
    return NextResponse.json({ error: 'uploadId and uploaded files are required' }, { status: 400 });
  }

  try {
    const supabase = getServerSupabase();
    const materialized = await materializeUploadedFiles(supabase, bucket, uploadId, files);
    if (materialized.accepted === 0) {
      return NextResponse.json(
        { error: 'No readable text/code files were found in that folder.' },
        { status: 400 }
      );
    }

    const workspace = addWorkspace({
      folderPath: materialized.outputDir,
      name: workspaceName,
    });
    const stats = await withWorkspaceId(workspace.id, () =>
      runIngestion(materialized.outputDir, { includeCode: true })
    );

    return NextResponse.json({
      ok: true,
      workspace,
      extraction: materialized,
      stats,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not process uploaded folder.' },
      { status: 500 }
    );
  }
}

function safeWorkspaceName(name?: string) {
  const normalized = (name || '').replace(/[^\w .()'&-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 80);
}

function normalizeManifest(uploadId: string, files: NonNullable<ProcessBody['files']>) {
  const prefix = `uploads/${uploadId}/files/`;
  return files
    .map((file) => {
      const relativePath = safeUploadRelativePath((file.relativePath || '').trim());
      const objectPath = (file.objectPath || '').trim();
      const size = Number(file.size || 0);
      return { relativePath, objectPath, size };
    })
    .filter((file): file is { relativePath: string; objectPath: string; size: number } =>
      Boolean(
        file.relativePath &&
          shouldAcceptUploadPath(file.relativePath) &&
          file.objectPath.startsWith(prefix) &&
          file.objectPath.endsWith(file.relativePath) &&
          Number.isFinite(file.size) &&
          file.size > 0
      )
    );
}

async function materializeUploadedFiles(
  supabase: ReturnType<typeof getServerSupabase>,
  bucket: string,
  uploadId: string,
  files: Array<{ relativePath: string; objectPath: string; size: number }>
): Promise<MaterializeStats> {
  const root = path.join(
    process.env.BIRDBRAIN_WEB_UPLOAD_DIR || path.join(os.tmpdir(), 'birdbrain-web-uploads'),
    uploadId,
    'source'
  );
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  const stats: MaterializeStats = { accepted: 0, skipped: 0, bytes: 0, outputDir: root };

  for (const file of files) {
    if (stats.accepted >= DEFAULT_MAX_FILES || stats.bytes + file.size > DEFAULT_MAX_ACCEPTED_BYTES) {
      stats.skipped++;
      continue;
    }

    const dest = path.join(root, file.relativePath);
    if (!dest.startsWith(root + path.sep)) {
      stats.skipped++;
      continue;
    }

    const { data, error } = await supabase.storage.from(bucket).download(file.objectPath);
    if (error || !data) {
      throw new Error(error?.message || `Could not download ${file.relativePath}.`);
    }

    const bytes = Buffer.from(await data.arrayBuffer());
    if (stats.bytes + bytes.byteLength > DEFAULT_MAX_ACCEPTED_BYTES) {
      stats.skipped++;
      continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes, { flag: 'wx' });
    stats.accepted++;
    stats.bytes += bytes.byteLength;
  }

  return stats;
}
