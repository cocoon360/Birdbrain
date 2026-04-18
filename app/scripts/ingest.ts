#!/usr/bin/env tsx
/**
 * Bird Brain ingestion script
 * Usage:
 *   npm run ingest                                      # legacy single-DB mode
 *   DOCS_PATH=/path/to/docs npm run ingest
 *   WORKSPACE_ID=ws_xxx npm run ingest                  # use an existing workspace
 *   WORKSPACE_FOLDER=/path/to/folder npm run ingest     # pick / create workspace by folder
 *   INGEST_INCLUDE_CODE=1 npm run ingest                 # force code-file ingest on (0 = off)
 *   Omit INGEST_INCLUDE_CODE to use the value stored in the workspace DB.
 */

import path from 'path';
import {
  addWorkspace,
  adoptLegacyWorkspace,
  getWorkspace,
  getWorkspaceByFolder,
} from '../lib/workspaces/registry';
import { withWorkspaceId } from '../lib/workspaces/context';
import { runIngestion } from '../lib/ingest/ingest';

async function main() {
  adoptLegacyWorkspace();

  const docsPath = process.env.DOCS_PATH
    ? path.resolve(process.env.DOCS_PATH)
    : path.resolve(process.cwd(), '..', 'birdsong game copy', 'Game_Development');

  let workspaceId = process.env.WORKSPACE_ID || '';

  if (!workspaceId && process.env.WORKSPACE_FOLDER) {
    const folder = path.resolve(process.env.WORKSPACE_FOLDER);
    const existing = getWorkspaceByFolder(folder);
    workspaceId = (existing ?? addWorkspace({ folderPath: folder })).id;
  }

  if (!workspaceId) {
    // Fall back to adopting the legacy DB as a workspace (done above) and
    // picking the folder whose name matches DOCS_PATH.
    const existing = getWorkspaceByFolder(docsPath);
    if (existing) {
      workspaceId = existing.id;
    } else {
      workspaceId = addWorkspace({ folderPath: docsPath }).id;
    }
  }

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  console.log('Bird Brain ingestion starting...');
  console.log(`Workspace: ${workspace.name} (${workspace.id})`);
  console.log(`Docs root: ${docsPath}`);
  console.log(`DB path:   ${workspace.db_path}`);

  const envIc = process.env.INGEST_INCLUDE_CODE?.trim();
  let includeCodeOpt: boolean | undefined;
  if (envIc === '1' || envIc?.toLowerCase() === 'true') includeCodeOpt = true;
  else if (envIc === '0' || envIc?.toLowerCase() === 'false') includeCodeOpt = false;

  const stats = await withWorkspaceId(workspace.id, () =>
    runIngestion(docsPath, { includeCode: includeCodeOpt })
  );

  console.log('');
  console.log('Ingestion complete:');
  console.log(`  Total files scanned : ${stats.total}`);
  console.log(`  Added               : ${stats.added}`);
  console.log(`  Updated             : ${stats.updated}`);
  console.log(`  Removed             : ${stats.removed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
