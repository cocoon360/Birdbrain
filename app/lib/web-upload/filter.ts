const ALLOWED_EXT = new Set([
  '.md', '.markdown', '.mdown', '.txt', '.rst', '.org', '.adoc',
  '.json', '.yaml', '.yml', '.csv', '.tsv', '.log', '.ini', '.toml',
  '.html', '.htm', '.xml', '.svg',
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.kt', '.kts', '.swift',
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hxx',
  '.cs', '.rb', '.php', '.vue', '.svelte', '.sql', '.sh', '.bash', '.zsh',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'target',
  'vendor', 'coverage', '.turbo', '.venv', 'venv', 'env', '__pycache__',
]);

export function safeUploadRelativePath(filename: string) {
  const normalized = filename
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');

  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return null;

  const parts = normalized.split('/');
  if (parts.some((part) => part === '..')) return null;

  return parts.join('/');
}

export function shouldAcceptUploadPath(filename: string) {
  const safeRelative = safeUploadRelativePath(filename);
  if (!safeRelative) return false;

  const parts = safeRelative.split('/').filter(Boolean);
  if (parts.some((part) => IGNORE_DIRS.has(part) || (part.startsWith('.') && part !== '.cursor'))) {
    return false;
  }

  return ALLOWED_EXT.has(getExtension(safeRelative));
}

function getExtension(filename: string) {
  const basename = filename.split('/').pop() || '';
  const dot = basename.lastIndexOf('.');
  return dot >= 0 ? basename.slice(dot).toLowerCase() : '';
}
