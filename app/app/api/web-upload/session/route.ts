import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase, WEB_UPLOAD_BUCKET, WEB_UPLOAD_MAX_BYTES } from '@/lib/supabase/server';
import { safeUploadRelativePath, shouldAcceptUploadPath } from '@/lib/web-upload/filter';

export const maxDuration = 30;

interface SessionBody {
  workspaceName?: string;
  files?: Array<{
    relativePath?: string;
    size?: number;
  }>;
}

export async function POST(req: NextRequest) {
  let body: SessionBody = {};
  try {
    body = (await req.json()) as SessionBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const files = (body.files || [])
    .map((file) => ({
      relativePath: safeUploadRelativePath((file.relativePath || '').trim()),
      size: Number(file.size || 0),
    }))
    .filter((file): file is { relativePath: string; size: number } =>
      Boolean(file.relativePath && shouldAcceptUploadPath(file.relativePath) && Number.isFinite(file.size) && file.size > 0)
    );

  if (files.length === 0) {
    return NextResponse.json({ error: 'Choose a folder with readable text or code files.' }, { status: 400 });
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > WEB_UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { error: `Selected readable files must be smaller than ${Math.floor(WEB_UPLOAD_MAX_BYTES / 1024 / 1024)} MB.` },
      { status: 400 }
    );
  }

  try {
    const supabase = getServerSupabase();
    const uploadId = crypto.randomBytes(10).toString('hex');
    const workspaceName = safeWorkspaceName(body.workspaceName) || inferWorkspaceName(files) || `Upload ${uploadId.slice(0, 6)}`;
    const signedFiles = await Promise.all(files.map(async (file) => {
      const objectPath = `uploads/${uploadId}/files/${file.relativePath}`;
      const { data, error } = await supabase.storage
        .from(WEB_UPLOAD_BUCKET)
        .createSignedUploadUrl(objectPath);
      if (error || !data?.token) {
        throw new Error(error?.message || `Could not create upload URL for ${file.relativePath}.`);
      }
      return {
        relativePath: file.relativePath,
        objectPath,
        size: file.size,
        token: data.token,
      };
    }));

    return NextResponse.json({
      uploadId,
      bucket: WEB_UPLOAD_BUCKET,
      workspaceName,
      files: signedFiles,
      maxBytes: WEB_UPLOAD_MAX_BYTES,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Supabase upload is not configured.' },
      { status: 500 }
    );
  }
}

function safeWorkspaceName(name?: string) {
  const normalized = (name || '').replace(/[^\w .()'&-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 80);
}

function inferWorkspaceName(files: Array<{ relativePath: string }>) {
  const root = files[0]?.relativePath.split('/').filter(Boolean)[0];
  return safeWorkspaceName(root);
}
