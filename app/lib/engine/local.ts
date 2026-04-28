import type { Engine, EngineTestResult, GenerateOptions } from './types';
import { EngineError } from './types';

export class LocalEngine implements Engine {
  readonly provider = 'local' as const;
  readonly defaultModel = 'no-ai';

  async generate(_options: GenerateOptions): Promise<string> {
    throw new EngineError(
      this.provider,
      'misconfigured',
      'Demo mode does not call an AI model.'
    );
  }

  async test(): Promise<EngineTestResult> {
    return {
      ok: true,
      model: this.defaultModel,
      message: 'Demo mode is ready. No Cursor login or API key is required.',
    };
  }
}
