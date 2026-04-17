import type { Engine, EngineConfig, EngineTestResult, GenerateOptions } from './types';
import { EngineError } from './types';
import { resolveSecret } from './secrets';

// Anthropic Messages API adapter. Mirrors OpenAIEngine; default model is a
// recent Claude for synthesis tasks. The adapter does not depend on the
// Anthropic SDK so it stays portable in the sidecar binary.

const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ENV = 'ANTHROPIC_API_KEY';
const ANTHROPIC_VERSION = '2023-06-01';

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

export class AnthropicEngine implements Engine {
  readonly provider = 'anthropic' as const;
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
        `Anthropic API key missing. Set ${this.apiKeyEnv} or store it in the desktop keychain.`
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
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: options.prompt }],
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new EngineError(this.provider, 'timeout', `Anthropic request timed out after ${timeout}ms`);
      }
      throw new EngineError(
        this.provider,
        'network',
        `Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    clearTimeout(timer);

    const text = await res.text();
    let body: MessagesResponse | null = null;
    try {
      body = JSON.parse(text) as MessagesResponse;
    } catch {
      // non-JSON response
    }

    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      const code = res.status === 401 ? 'not-authenticated' : 'nonzero-exit';
      throw new EngineError(this.provider, code, `Anthropic API error: ${msg}`, text.slice(0, 500));
    }

    const content = (body?.content ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim();
    if (!content) {
      throw new EngineError(
        this.provider,
        'empty-output',
        'Anthropic returned empty content',
        text.slice(0, 500)
      );
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
          ? `Anthropic responded with ${this.defaultModel}.`
          : `Anthropic responded but the answer was unexpected: ${text.slice(0, 80)}`,
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
