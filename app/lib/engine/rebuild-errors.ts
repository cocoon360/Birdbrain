import { EngineError } from './types';

/** JSON shape returned by POST /api/startup/rebuild on failure. */
export interface RebuildErrorBody {
  error: string;
  code?: string;
  provider?: string;
  hint?: string;
  steps?: string[];
}

export function rebuildErrorBody(error: unknown): RebuildErrorBody {
  if (error instanceof EngineError) {
    return engineErrorBody(error);
  }
  const msg = error instanceof Error ? error.message : 'Ontology rebuild failed.';
  if (/corpus not ingested/i.test(msg)) {
    return {
      error: msg,
      steps: [
        'Tap “re-ingest corpus” on the startup screen so files are scanned into the local database.',
        'Wait until “Corpus ingested” shows ok, then tap “build overview” again.',
      ],
    };
  }
  return {
    error: msg,
    steps: [
      'If this keeps happening, open Engine settings and run “Test connection” for your AI provider.',
      'Desktop app: ensure Node.js is installed and, for Cursor CLI, that `cursor-agent` works in Terminal.',
    ],
  };
}

function engineErrorBody(err: EngineError): RebuildErrorBody {
  const base: RebuildErrorBody = {
    error: err.message,
    code: err.code,
    provider: err.provider,
    hint: err.details,
  };

  if (err.provider === 'cursor-cli') {
    switch (err.code) {
      case 'not-installed':
        return {
          ...base,
          steps: [
            'The “overview” step calls Cursor’s `cursor-agent` tool on your Mac (same as in dev). It is separate from file ingestion.',
            'In Terminal: curl https://cursor.com/install -fsS | bash',
            'That usually installs to ~/.local/bin/cursor-agent. Bird Brain looks there automatically.',
            'If you installed it elsewhere, set environment variable CURSOR_AGENT_PATH to the full path of the binary, then restart Bird Brain.',
          ],
        };
      case 'not-authenticated':
        return {
          ...base,
          steps: [
            'In Terminal, run: cursor-agent login',
            'Finish the browser login, then return here and tap “build overview” again.',
          ],
        };
      case 'timeout':
        return {
          ...base,
          steps: [
            'The model took too long. Try again, or pick a faster model in Engine settings.',
            'Very large folders can make the first overview slow.',
          ],
        };
      default:
        return {
          ...base,
          steps: [
            'Open Engine settings → test the Cursor CLI connection.',
            'If stderr mentioned a model name, pick that model in settings or set CURSOR_AGENT_MODEL.',
          ],
        };
    }
  }

  if (err.provider === 'openai' || err.provider === 'anthropic') {
    return {
      ...base,
      steps: [
        'Open Engine settings and confirm your API key env var is set for this shell / app.',
        'Use “Test connection” to verify the provider before rebuilding.',
      ],
    };
  }

  if (err.provider === 'ollama') {
    return {
      ...base,
      steps: [
        'Make sure Ollama is running locally (`ollama serve`) and the model name in settings matches an installed model.',
      ],
    };
  }

  return {
    ...base,
    steps: ['Open Engine settings and verify your AI provider configuration.'],
  };
}
