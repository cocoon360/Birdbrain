import { getProjectMeta, setProjectEngineConfig } from '../db/queries';
import type { Engine, EngineConfig, EngineProvider } from './types';
import { CursorCliEngine } from './cursor-cli';
import { OpenAIEngine } from './openai';
import { AnthropicEngine } from './anthropic';
import { OllamaEngine } from './ollama';
import { LocalEngine } from './local';

// Engine factory + cached resolver. The active engine is stored in
// project_meta (per workspace) and built on demand. Cache is keyed by the
// full config so switching providers at runtime produces a fresh adapter.

export * from './types';
export { CursorCliEngine, OpenAIEngine, AnthropicEngine, OllamaEngine, LocalEngine };

const VALID_PROVIDERS: EngineProvider[] = ['local', 'cursor-cli', 'openai', 'anthropic', 'ollama'];

export function isEngineProvider(value: string): value is EngineProvider {
  return (VALID_PROVIDERS as string[]).includes(value);
}

export function buildEngine(config: EngineConfig): Engine {
  switch (config.provider) {
    case 'local':
      return new LocalEngine();
    case 'cursor-cli':
      return new CursorCliEngine(config);
    case 'openai':
      return new OpenAIEngine(config);
    case 'anthropic':
      return new AnthropicEngine(config);
    case 'ollama':
      return new OllamaEngine(config);
    default:
      throw new Error(`Unknown engine provider: ${config.provider}`);
  }
}

// Cache is per-workspace because getDb() is workspace-scoped via
// AsyncLocalStorage. Keeping the cache at module scope is fine: we key on
// the config signature, and the adapter objects are cheap to hold.
const cache = new Map<string, Engine>();

function cacheKey(config: EngineConfig): string {
  return JSON.stringify([config.provider, config.model, config.endpoint, config.apiKeyEnvVar]);
}

export function getEngineForWorkspace(): Engine {
  const meta = getProjectMeta();
  const provider: EngineProvider = isEngineProvider(meta.engine_provider)
    ? meta.engine_provider
    : 'local';
  const config: EngineConfig = {
    provider,
    model: meta.engine_model || null,
    endpoint: meta.engine_endpoint || null,
    apiKeyEnvVar: meta.engine_api_key_env || null,
  };
  const key = cacheKey(config);
  const hit = cache.get(key);
  if (hit) return hit;
  const engine = buildEngine(config);
  cache.set(key, engine);
  return engine;
}

export function updateWorkspaceEngineConfig(partial: Partial<EngineConfig>) {
  const meta = getProjectMeta();
  const nextProvider: EngineProvider = partial.provider && isEngineProvider(partial.provider)
    ? partial.provider
    : (isEngineProvider(meta.engine_provider) ? meta.engine_provider : 'local');
  const next: EngineConfig = {
    provider: nextProvider,
    model: partial.model ?? meta.engine_model ?? null,
    endpoint: partial.endpoint ?? meta.engine_endpoint ?? null,
    apiKeyEnvVar: partial.apiKeyEnvVar ?? meta.engine_api_key_env ?? null,
  };
  setProjectEngineConfig(next);
  cache.clear();
  return next;
}

export function clearEngineCache() {
  cache.clear();
}
