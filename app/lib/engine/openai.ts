import type { Engine, EngineConfig, EngineTestResult, GenerateOptions } from './types';
import { EngineError } from './types';
import { resolveSecret } from './secrets';

// Minimal OpenAI Chat Completions adapter. We intentionally keep the HTTP
// surface narrow (one endpoint, one response shape) so this stays easy to
// reason about and swap out. The OpenAI SDK is not required.

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_ENV = 'OPENAI_API_KEY';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export class OpenAIEngine implements Engine {
  readonly provider = 'openai' as const;
  readonly defaultModel: string;
  private readonly endpoint: string;
  private readonly apiKeyEnv: string;

  constructor(config: EngineConfig) {
    this.defaultModel = config.model || DEFAULT_MODEL;
    this.endpoint = config.endpoint || DEFAULT_ENDPOINT;
    this.apiKeyEnv = config.apiKeyEnvVar || DEFAULT_ENV;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const key = await resolveSecret(this.apiKeyEnv);
    if (!key) {
      throw new EngineError(
        this.provider,
        'not-authenticated',
        `OpenAI API key missing. Set ${this.apiKeyEnv} or store it in the desktop keychain.`
      );
    }
    const model = options.model || this.defaultModel;
    const timeout = options.timeoutMs ?? 120_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: options.prompt }],
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new EngineError(this.provider, 'timeout', `OpenAI request timed out after ${timeout}ms`);
      }
      throw new EngineError(
        this.provider,
        'network',
        `OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    clearTimeout(timer);

    const text = await res.text();
    let body: ChatCompletionResponse | null = null;
    try {
      body = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      // non-JSON response — treated below
    }

    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      const code = res.status === 401 ? 'not-authenticated' : 'nonzero-exit';
      throw new EngineError(this.provider, code, `OpenAI API error: ${msg}`, text.slice(0, 500));
    }

    const content = body?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new EngineError(this.provider, 'empty-output', 'OpenAI returned empty content', text.slice(0, 500));
    }
    return content;
  }

  async test(): Promise<EngineTestResult> {
    try {
      const text = await this.generate({
        prompt: 'Reply with only the word "ok".',
        timeoutMs: 30_000,
      });
      const ok = /\bok\b/i.test(text.trim());
      return {
        ok,
        message: ok
          ? `OpenAI responded with ${this.defaultModel}.`
          : `OpenAI responded but the answer was unexpected: ${text.slice(0, 80)}`,
        model: this.defaultModel,
      };
    } catch (err) {
      if (err instanceof EngineError) {
        return { ok: false, message: err.message, model: this.defaultModel };
      }
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        model: this.defaultModel,
      };
    }
  }
}
