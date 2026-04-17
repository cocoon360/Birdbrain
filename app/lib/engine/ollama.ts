import type { Engine, EngineConfig, EngineTestResult, GenerateOptions } from './types';
import { EngineError } from './types';

// Local Ollama adapter — talks to the HTTP server that `ollama serve`
// exposes at http://localhost:11434 by default. Nice because it lets the
// prototype run fully offline against whatever model the user has pulled.

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.1';

interface GenerateResponse {
  response?: string;
  done?: boolean;
  error?: string;
}

export class OllamaEngine implements Engine {
  readonly provider = 'ollama' as const;
  readonly defaultModel: string;
  private readonly endpoint: string;

  constructor(config: EngineConfig) {
    this.defaultModel = config.model || DEFAULT_MODEL;
    this.endpoint = (config.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
  }

  async generate(options: GenerateOptions): Promise<string> {
    const model = options.model || this.defaultModel;
    const timeout = options.timeoutMs ?? 180_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: options.prompt,
          stream: false,
          options: { temperature: 0.2 },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new EngineError(this.provider, 'timeout', `Ollama request timed out after ${timeout}ms`);
      }
      throw new EngineError(
        this.provider,
        'network',
        `Cannot reach Ollama at ${this.endpoint}. Is 'ollama serve' running?`
      );
    }
    clearTimeout(timer);

    const text = await res.text();
    let body: GenerateResponse | null = null;
    try {
      body = JSON.parse(text) as GenerateResponse;
    } catch {
      // non-JSON response
    }

    if (!res.ok) {
      const msg = body?.error || `HTTP ${res.status}`;
      throw new EngineError(this.provider, 'nonzero-exit', `Ollama error: ${msg}`, text.slice(0, 500));
    }
    const content = body?.response?.trim();
    if (!content) {
      throw new EngineError(this.provider, 'empty-output', 'Ollama returned empty content', text.slice(0, 500));
    }
    return content;
  }

  async test(): Promise<EngineTestResult> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, { method: 'GET' });
      if (!res.ok) {
        return {
          ok: false,
          message: `Ollama at ${this.endpoint} responded with HTTP ${res.status}.`,
          model: this.defaultModel,
        };
      }
      return {
        ok: true,
        message: `Ollama reachable at ${this.endpoint}. Current default model: ${this.defaultModel}.`,
        model: this.defaultModel,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Cannot reach Ollama at ${this.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        model: this.defaultModel,
      };
    }
  }
}
