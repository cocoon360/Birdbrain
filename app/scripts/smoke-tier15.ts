// One-off smoke test for tier-1.5 ingest.
//   npm test   (uses ../fixtures/smoke-corpus from app/)
//   npx tsx app/scripts/smoke-tier15.ts /path/to/folder
//
// Walks the given folder with the new allowlist, parses every file, and
// prints a compact summary so we can eyeball that text + SVG paths produce
// usable chunks before opening the app.

import { walkIngestableFiles, parseIngestableFile } from '../lib/ingest/parse';

const root = process.argv[2];
if (!root) {
  console.error('usage: npx tsx app/scripts/smoke-tier15.ts <folder>');
  process.exit(1);
}

const files = walkIngestableFiles(root);
console.log(`\nwalkIngestableFiles → ${files.length} file(s)`);
for (const f of files) {
  console.log(`  ${f.kind.padEnd(8)} ${f.ext.padEnd(6)} ${f.path}`);
}

console.log('\nparseIngestableFile output:');
for (const f of files) {
  const doc = parseIngestableFile(f, root);
  console.log(
    `\n  [${doc.source_kind}] ${doc.title}  (${doc.word_count} words, ${doc.chunks.length} chunk(s))`
  );
  doc.chunks.forEach((c) => {
    const preview = c.body.slice(0, 120).replace(/\s+/g, ' ');
    console.log(`    #${c.chunk_index} ${c.heading ?? '(no heading)'}: ${preview}${c.body.length > 120 ? '…' : ''}`);
  });
}
