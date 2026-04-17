// The Engine abstraction Bird Brain uses for every LLM call (dossier
// synthesis, ontology startup, briefs). Concrete adapters below satisfy
// this interface so higher layers can swap providers per workspace
// without code changes.

export type EngineProvider = 'cursor-cli' | 'openai' | 'anthropic' | 'ollama';

export interface EngineConfig {
  provider: EngineProvider;
  model?: string | null;
  endpoint?: string | null; // Ollama / self-hosted
  apiKeyEnvVar?: string | null; // name of env var containing the key
}

export interface GenerateOptions {
  prompt: string;
  model?: string;
  timeoutMs?: number;
}

export interface EngineTestResult {
  ok: boolean;
  message: string;
  model?: string | null;
}

export interface Engine {
  readonly provider: EngineProvider;
  readonly defaultModel: string;
  generate(options: GenerateOptions): Promise<string>;
  test?(): Promise<EngineTestResult>;
}

export class EngineError extends Error {
  provider: EngineProvider;
  code:
    | 'not-installed'
    | 'not-authenticated'
    | 'timeout'
    | 'nonzero-exit'
    | 'empty-output'
    | 'bad-response'
    | 'network'
    | 'misconfigured';
  details?: string;
  constructor(
    provider: EngineProvider,
    code: EngineError['code'],
    message: string,
    details?: string
  ) {
    super(message);
    this.provider = provider;
    this.code = code;
    this.details = details;
  }
}
