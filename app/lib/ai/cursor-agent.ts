import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Low-level wrapper around the Cursor Agent CLI. Invokes it in headless,
// read-only ask-mode so the model can't touch the filesystem or shell, and
// returns the assistant's raw stdout text. Higher layers are responsible for
// turning that text into a validated Paragraph.

export class CursorAgentError extends Error {
  code: 'not-installed' | 'not-logged-in' | 'timeout' | 'nonzero-exit' | 'empty-output';
  details?: string;
  constructor(
    code: CursorAgentError['code'],
    message: string,
    details?: string
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export interface RunOptions {
  prompt: string;
  timeoutMs?: number;
  model?: string;
}

// Resolve the absolute path to the cursor-agent binary. We don't assume it's
// on PATH when spawned from a Next.js server process, because GUI-launched
// Node usually doesn't inherit the shell PATH that includes ~/.local/bin.
function resolveBinary(): string {
  const explicit = process.env.CURSOR_AGENT_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'cursor-agent'),
    '/usr/local/bin/cursor-agent',
    '/opt/homebrew/bin/cursor-agent',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new CursorAgentError(
    'not-installed',
    'cursor-agent binary not found. Install it with: curl https://cursor.com/install -fsS | bash'
  );
}

// In-flight dedupe: if two requests ask the same question at the same time,
// they share one CLI invocation. Keyed by the exact prompt hash surrogate
// (here just the prompt itself, truncated). Good enough for per-slug calls.
const inflight = new Map<string, Promise<string>>();

export function runCursorAgent(options: RunOptions): Promise<string> {
  const key = options.prompt.slice(0, 256);
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = runOnce(options).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function runOnce({ prompt, timeoutMs = 120_000, model }: RunOptions): Promise<string> {
  const bin = resolveBinary();
  const args = ['-p', '--mode', 'ask', '--output-format', 'text', '--trust'];
  if (model) args.push('--model', model);
  // The CLI takes the prompt as a trailing positional argument.
  args.push(prompt);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // best-effort
        }
        reject(new CursorAgentError('timeout', `cursor-agent timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish(() =>
        reject(
          new CursorAgentError(
            'nonzero-exit',
            `failed to spawn cursor-agent: ${err.message}`,
            String(err)
          )
        )
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      finish(() => {
        if (code !== 0) {
          const looksLikeAuth =
            /not (?:logged|signed) in|unauthorized|401|authenticate/i.test(stderr + stdout);
          const unsupportedModel =
            Boolean(model) &&
            /unknown model|invalid model|model .* not found|unsupported model|invalid choice/i.test(
              stderr + stdout
            );
          if (unsupportedModel) {
            runOnce({ prompt, timeoutMs }).then(resolve).catch(reject);
            return;
          }
          const errCode = looksLikeAuth ? 'not-logged-in' : 'nonzero-exit';
          const msg = looksLikeAuth
            ? 'cursor-agent is not logged in. Run: cursor-agent login'
            : `cursor-agent exited with code ${code}`;
          reject(new CursorAgentError(errCode, msg, stderr.trim() || stdout.trim()));
          return;
        }
        const text = stdout.trim();
        if (!text) {
          reject(new CursorAgentError('empty-output', 'cursor-agent returned empty output', stderr));
          return;
        }
        resolve(text);
      });
    });
  });
}
