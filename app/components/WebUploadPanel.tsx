'use client';

import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { WEB_UPLOAD_MAX_MB, WEB_UPLOAD_BUCKET } from '@/lib/web-upload/config';
import { safeUploadRelativePath, shouldAcceptUploadPath } from '@/lib/web-upload/filter';

interface UploadSessionResponse {
  uploadId: string;
  bucket: string;
  workspaceName: string;
  maxBytes: number;
  files: Array<{
    relativePath: string;
    objectPath: string;
    size: number;
    token: string;
  }>;
  error?: string;
}

interface ProcessResponse {
  workspace?: { id: string; name: string };
  error?: string;
}

interface SelectedUploadFile {
  file: File;
  relativePath: string;
  size: number;
}

export function WebUploadPanel({ onOpenWorkspace }: { onOpenWorkspace: (workspaceId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function upload(fileList: FileList | null) {
    const files = getReadableFolderFiles(fileList);
    if (files.length === 0) {
      setMessage('Choose a folder with readable text or code files.');
      return;
    }

    const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
    if (totalBytes > WEB_UPLOAD_MAX_MB * 1024 * 1024) {
      setMessage(`Folder is too large for this demo server. Limit: ${WEB_UPLOAD_MAX_MB} MB of readable files.`);
      return;
    }

    const workspaceName = getFolderName(files);
    setBusy(true);
    setMessage(`Preparing ${files.length} readable file${files.length === 1 ? '' : 's'}...`);
    try {
      const sessionRes = await fetch('/api/web-upload/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceName,
          files: files.map((file) => ({ relativePath: file.relativePath, size: file.size })),
        }),
      });
      const session = (await sessionRes.json()) as UploadSessionResponse;
      if (!sessionRes.ok) throw new Error(session.error || 'Could not create upload session.');

      setMessage(`Uploading ${session.files.length} file${session.files.length === 1 ? '' : 's'}...`);
      const supabase = getBrowserSupabase();
      await uploadSignedFiles({
        bucket: session.bucket || WEB_UPLOAD_BUCKET,
        selectedFiles: files,
        signedFiles: session.files,
        onProgress: (done, total) => setMessage(`Uploading files... ${done}/${total}`),
      });

      setMessage('Building temporary workspace...');
      const processRes = await fetch('/api/web-upload/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: session.uploadId,
          bucket: session.bucket,
          workspaceName: session.workspaceName,
          files: session.files.map(({ relativePath, objectPath, size }) => ({ relativePath, objectPath, size })),
        }),
      });
      const processed = (await processRes.json()) as ProcessResponse;
      if (!processRes.ok || !processed.workspace) {
        throw new Error(processed.error || 'Could not process uploaded workspace.');
      }

      setMessage('Workspace ready.');
      onOpenWorkspace(processed.workspace.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  const folderInputProps: React.InputHTMLAttributes<HTMLInputElement> & {
    webkitdirectory?: string;
    directory?: string;
  } = {
    type: 'file',
    multiple: true,
    webkitdirectory: '',
    directory: '',
    disabled: busy,
    onChange: (event) => {
      void upload(event.target.files);
      event.target.value = '';
    },
    style: { display: 'none' },
  };

  return (
    <div className="metro-surface" style={{ padding: 14, marginTop: 16 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--accent)', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700 }}>
        hosted browser upload
      </div>
      <p style={{ margin: '8px 0 12px', color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.45 }}>
        Choose a project folder. Bird Brain uploads readable notes, docs, and source files while
        skipping media, binaries, dependencies, and build folders.
      </p>
      <label style={{ ...uploadButtonStyle(busy), display: 'inline-block' }}>
        {busy ? 'working...' : `choose folder (max ${WEB_UPLOAD_MAX_MB} MB)`}
        <input {...folderInputProps} />
      </label>
      {message && <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>{message}</div>}
    </div>
  );
}

function getReadableFolderFiles(fileList: FileList | null): SelectedUploadFile[] {
  if (!fileList) return [];

  return Array.from(fileList)
    .map((file) => {
      const browserRelativePath = file.webkitRelativePath || file.name;
      const relativePath = safeUploadRelativePath(browserRelativePath);
      if (!relativePath || !shouldAcceptUploadPath(relativePath)) return null;
      return { file, relativePath, size: file.size };
    })
    .filter((file): file is SelectedUploadFile => Boolean(file));
}

function getFolderName(files: SelectedUploadFile[]) {
  const firstPath = files[0]?.relativePath ?? '';
  const root = firstPath.split('/').filter(Boolean)[0];
  return root || 'Uploaded folder';
}

async function uploadSignedFiles({
  bucket,
  selectedFiles,
  signedFiles,
  onProgress,
}: {
  bucket: string;
  selectedFiles: SelectedUploadFile[];
  signedFiles: UploadSessionResponse['files'];
  onProgress: (done: number, total: number) => void;
}) {
  const supabase = getBrowserSupabase();
  const byPath = new Map(selectedFiles.map((item) => [item.relativePath, item.file]));
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.min(5, signedFiles.length);

  async function worker() {
    while (nextIndex < signedFiles.length) {
      const signedFile = signedFiles[nextIndex++];
      const file = byPath.get(signedFile.relativePath);
      if (!file) throw new Error(`Missing selected file: ${signedFile.relativePath}`);
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(signedFile.objectPath, signedFile.token, file);
      if (uploadError) throw uploadError;
      completed++;
      onProgress(completed, signedFiles.length);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

function uploadButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    padding: '10px 14px',
    cursor: disabled ? 'wait' : 'pointer',
    fontSize: '0.68rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 700,
    opacity: disabled ? 0.7 : 1,
  };
}
