import { runCursorAgent, CursorAgentError } from '../ai/cursor-agent';
import type { Engine, EngineConfig, EngineTestResult, GenerateOptions } from './types';
import { EngineError } from './types';

// Wraps the existing Cursor Agent CLI runner in the Engine interface.
// This keeps the binary + logged-in Cursor account as the default path
// so an existing Cursor Pro+ user doesn't need to paste API keys.

export class CursorCliEngine implements Engine {
  readonly provider = 'cursor-cli' as const;
  readonly defaultModel: string;

  constructor(config: EngineConfig) {
    this.defaultModel = config.model || process.env.CURSOR_AGENT_MODEL || 'opus-4.7';
  }

  async generate(options: GenerateOptions): Promise<string> {
    try {
      return await runCursorAgent({
        prompt: options.prompt,
        model: options.model || this.defaultModel,
        timeoutMs: options.timeoutMs,
      });
    } catch (err) {
      if (err instanceof CursorAgentError) {
        const code =
          err.code === 'not-installed'
            ? 'not-installed'
            : err.code === 'not-logged-in'
            ? 'not-authenticated'
            : err.code;
        throw new EngineError(this.provider, code, err.message, err.details);
      }
      throw err;
    }
  }

  async test(): Promise<EngineTestResult> {
    try {
      const text = await this.generate({
        prompt: 'Reply with the single word "ok" and nothing else.',
        timeoutMs: 30_000,
      });
      const ok = /\bok\b/i.test(text.trim());
      return {
        ok,
        message: ok
          ? `cursor-agent responded with ${this.defaultModel}.`
          : `cursor-agent responded but the answer was unexpected: ${text.slice(0, 80)}`,
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
