'use client';

import { useEffect, useState } from 'react';
import { isTauri, keychainClear, keychainGet, keychainSet } from '@/lib/desktop/tauri-bridge';
import { chromeButtonStyle, metroFont, space, type } from '@/lib/ui/metro-theme';

type Provider = 'cursor-cli' | 'openai' | 'anthropic' | 'ollama';

interface EngineConfig {
  provider: Provider;
  model: string;
  endpoint: string;
  api_key_env: string;
  default_model: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  provider?: string;
  model?: string;
}

interface SecretStatus {
  env_var: string;
  env: boolean;
  local: boolean;
  registered: boolean;
}

const PROVIDER_COPY: Record<Provider, { title: string; blurb: string; modelHint: string; keyHint: string }> = {
  'cursor-cli': {
    title: 'Cursor CLI',
    blurb: 'Uses your logged-in cursor-agent binary. No API key needed.',
    modelHint: 'e.g. gpt-5.5-medium, auto (run: agent models)',
    keyHint: 'not used (auth via cursor-agent login)',
  },
  openai: {
    title: 'OpenAI',
    blurb: 'Chat Completions API. Reads the key from an environment variable.',
    modelHint: 'e.g. gpt-4o-mini, gpt-4o',
    keyHint: 'env var name, default OPENAI_API_KEY',
  },
  anthropic: {
    title: 'Anthropic',
    blurb: 'Messages API for Claude. Reads the key from an environment variable.',
    modelHint: 'e.g. claude-3-5-sonnet-latest',
    keyHint: 'env var name, default ANTHROPIC_API_KEY',
  },
  ollama: {
    title: 'Ollama (local)',
    blurb: 'Talks to a local Ollama server over HTTP. Nothing leaves your machine.',
    modelHint: 'e.g. llama3.1, qwen2.5:7b',
    keyHint: 'not used',
  },
};

export function EngineSettingsDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (next: EngineConfig) => void;
}) {
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [provider, setProvider] = useState<Provider>('cursor-cli');
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKeyEnv, setApiKeyEnv] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [secretValue, setSecretValue] = useState('');
  const [savingSecret, setSavingSecret] = useState(false);
  const [hasKeychain, setHasKeychain] = useState(false);
  type CliModel = { id: string; label: string; note?: string };
  type CliGroup = { name: string; models: CliModel[] };
  const [cliGroups, setCliGroups] = useState<CliGroup[]>([]);
  const [cliAllModels, setCliAllModels] = useState<CliModel[]>([]);
  const [cliShowAll, setCliShowAll] = useState(false);
  const [cliModelsLoading, setCliModelsLoading] = useState(false);
  const [cliModelsError, setCliModelsError] = useState<string | null>(null);

  useEffect(() => {
    setHasKeychain(isTauri());
  }, []);

  useEffect(() => {
    if (!open) return;
    if (provider !== 'cursor-cli') return;
    if (cliAllModels.length > 0) return;
    setCliModelsLoading(true);
    setCliModelsError(null);
    fetch('/api/engine/models', { cache: 'no-store' })
      .then((r) => r.json())
      .then(
        (data: {
          ok: boolean;
          groups?: CliGroup[];
          all?: CliModel[];
          error?: string;
        }) => {
          if (data.ok) {
            setCliGroups(data.groups || []);
            setCliAllModels(data.all || []);
          } else {
            setCliModelsError(data.error || 'Could not read cursor-agent models.');
          }
        }
      )
      .catch((e: unknown) => setCliModelsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCliModelsLoading(false));
  }, [open, provider, cliAllModels.length]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/engine', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: EngineConfig) => {
        setConfig(data);
        setProvider(data.provider);
        setModel(data.model || '');
        setEndpoint(data.endpoint || '');
        setApiKeyEnv(data.api_key_env || '');
      })
      .finally(() => setLoading(false));
  }, [open]);

  const defaultKeyEnvFor = (p: Provider) =>
    p === 'openai' ? 'OPENAI_API_KEY' : p === 'anthropic' ? 'ANTHROPIC_API_KEY' : '';

  useEffect(() => {
    if (!open) return;
    const envVar = apiKeyEnv || defaultKeyEnvFor(provider);
    if (!envVar) {
      setSecretStatus(null);
      return;
    }
    fetch('/api/engine/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env_var: envVar }),
    })
      .then((r) => r.json())
      .then((data: SecretStatus) => setSecretStatus(data))
      .catch(() => setSecretStatus(null));
    setSecretValue('');
  }, [open, provider, apiKeyEnv]);

  async function saveSecret() {
    const envVar = apiKeyEnv || defaultKeyEnvFor(provider);
    if (!envVar || !secretValue.trim()) return;
    setSavingSecret(true);
    try {
      if (hasKeychain) {
        await keychainSet(envVar, secretValue.trim());
        const existing = await keychainGet(envVar);
        setSecretStatus({
          env_var: envVar,
          env: secretStatus?.env ?? false,
          local: secretStatus?.local ?? false,
          registered: Boolean(existing),
        });
      } else {
        const res = await fetch('/api/engine/secrets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env_var: envVar, value: secretValue }),
        });
        const data = (await res.json()) as SecretStatus;
        setSecretStatus(data);
      }
      setSecretValue('');
    } finally {
      setSavingSecret(false);
    }
  }

  async function clearSecret() {
    const envVar = apiKeyEnv || defaultKeyEnvFor(provider);
    if (!envVar) return;
    if (hasKeychain) {
      await keychainClear(envVar);
      setSecretStatus({
        env_var: envVar,
        env: secretStatus?.env ?? false,
        local: secretStatus?.local ?? false,
        registered: false,
      });
      return;
    }
    const res = await fetch(`/api/engine/secrets?env_var=${encodeURIComponent(envVar)}`, {
      method: 'DELETE',
    });
    const data = (await res.json()) as SecretStatus;
    setSecretStatus(data);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/engine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model || undefined,
          endpoint: endpoint || undefined,
          api_key_env: apiKeyEnv || undefined,
        }),
      });
      const data = (await res.json()) as EngineConfig;
      setConfig(data);
      onSaved?.(data);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch('/api/engine/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model || undefined,
          endpoint: endpoint || undefined,
          api_key_env: apiKeyEnv || undefined,
        }),
      });
      const data = (await res.json()) as TestResult;
      setTest(data);
    } finally {
      setTesting(false);
    }
  }

  if (!open) return null;

  const copy = PROVIDER_COPY[provider];
  const dirty = Boolean(
    config &&
      (provider !== config.provider ||
        (model || '') !== (config.model || '') ||
        (endpoint || '') !== (config.endpoint || '') ||
        (apiKeyEnv || '') !== (config.api_key_env || ''))
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        justifyContent: 'flex-end',
        fontFamily: metroFont,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 96vw)',
          height: '100vh',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--border)',
          padding: `${space.xl}px ${space.xl}px ${space.lg}px`,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          color: 'var(--text)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: space.md,
            borderBottom: '1px solid var(--border)',
            paddingBottom: space.sm,
          }}
        >
          <div
            className="metro-subtitle"
            style={{
              color: 'var(--accent)',
            }}
          >
            engine settings
          </div>
          <button type="button" onClick={onClose} style={chromeButtonStyle({})}>
            close
          </button>
        </div>

        <h2 className="metro-drawer-title">engine</h2>
        <div
          style={{
            fontSize: type.body,
            color: 'var(--text-dim)',
            lineHeight: 1.55,
            marginBottom: space.lg,
          }}
        >
          Pick which model Bird Brain calls for project mapping, dossiers, and briefs. This is stored on
          the workspace so different projects can use different engines.
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: type.body }}>loading…</div>
        ) : (
          <>
            <div style={{ marginBottom: space.lg }}>
              <Label>provider</Label>
              <div
                className="metro-surface"
                style={{ marginTop: space.sm, padding: 0, overflow: 'hidden' }}
              >
                {(Object.keys(PROVIDER_COPY) as Provider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`metro-list-row${provider === p ? ' metro-list-row--selected' : ''}`}
                    onClick={() => setProvider(p)}
                  >
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: provider === p ? 'var(--accent)' : 'var(--text)',
                        marginBottom: 4,
                      }}
                    >
                      {PROVIDER_COPY[p].title}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.45 }}>
                      {PROVIDER_COPY[p].blurb}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: space.md }}>
              <Label>model</Label>
              {provider === 'cursor-cli' ? (
                <>
                  <select
                    className="metro-input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    style={{ marginTop: space.sm, cursor: 'pointer' }}
                    disabled={cliModelsLoading || cliAllModels.length === 0}
                  >
                    <option value="">
                      {cliModelsLoading
                        ? 'loading models…'
                        : cliAllModels.length === 0
                          ? '(no models available — is cursor-agent installed?)'
                          : 'auto — use CLI default'}
                    </option>
                    {cliShowAll
                      ? cliAllModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} — {m.id}
                            {m.note ? ` (${m.note})` : ''}
                          </option>
                        ))
                      : cliGroups.map((group) => (
                          <optgroup key={group.name} label={group.name}>
                            {group.models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label} — {m.id}
                                {m.note ? ` (${m.note})` : ''}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                  </select>
                  {cliModelsError && (
                    <div
                      style={{
                        fontSize: 12,
                        color: '#e74c9b',
                        marginTop: space.sm,
                        lineHeight: 1.5,
                      }}
                    >
                      {cliModelsError}
                    </div>
                  )}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: space.sm,
                      fontSize: 12,
                      color: 'var(--text-dim)',
                      marginTop: 10,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={cliShowAll}
                      onChange={(e) => setCliShowAll(e.target.checked)}
                    />
                    show all {cliAllModels.length} models (reasoning tiers, codex, older versions)
                  </label>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginTop: space.sm,
                      lineHeight: 1.5,
                    }}
                  >
                    Curated list shows the newest few from each provider. Leave on{' '}
                    <em>auto</em> to let the CLI choose. Opus 4.7 and Sonnet 4.6 are 1M-context
                    (max mode, expensive); Opus 4.5 and Sonnet 4 are the cheaper standard-context
                    picks.
                  </div>
                </>
              ) : (
                <input
                  type="text"
                  className="metro-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={copy.modelHint}
                  style={{ marginTop: space.sm }}
                />
              )}
            </div>

            {(provider === 'ollama' || provider === 'openai' || provider === 'anthropic') && (
              <div style={{ marginBottom: space.md }}>
                <Label>endpoint (optional)</Label>
                <input
                  type="text"
                  className="metro-input"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder={
                    provider === 'ollama'
                      ? 'http://localhost:11434'
                      : provider === 'openai'
                      ? 'https://api.openai.com/v1/chat/completions'
                      : 'https://api.anthropic.com/v1/messages'
                  }
                  style={{ marginTop: space.sm }}
                />
              </div>
            )}

            {(provider === 'openai' || provider === 'anthropic') && (
              <>
                <div style={{ marginBottom: space.md }}>
                  <Label>api key env var</Label>
                  <input
                    type="text"
                    className="metro-input"
                    value={apiKeyEnv}
                    onChange={(e) => setApiKeyEnv(e.target.value)}
                    placeholder={copy.keyHint}
                    style={{ marginTop: space.sm }}
                  />
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginTop: space.sm,
                      lineHeight: 1.5,
                    }}
                  >
                    In dev, put the key in <code style={{ color: 'var(--text-dim)' }}>.env.local</code>. In the
                    desktop build, the keychain plugin will resolve it automatically.
                  </div>
                </div>

                <div style={{ marginBottom: space.lg }}>
                  <Label>api key value (stored locally)</Label>
                  <input
                    type="password"
                    className="metro-input"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    placeholder={secretStatus?.env || secretStatus?.local ? '•••••••• (set)' : 'paste key to store'}
                    style={{ marginTop: space.sm }}
                  />
                  <div style={{ display: 'flex', gap: space.sm, marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={saveSecret}
                      disabled={savingSecret || !secretValue.trim()}
                      style={primaryButton(savingSecret || !secretValue.trim())}
                    >
                      {savingSecret ? 'saving…' : 'store locally'}
                    </button>
                    {secretStatus?.local && (
                      <button type="button" onClick={clearSecret} style={secondaryButton(false)}>
                        clear stored
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: space.md,
                      marginTop: space.sm,
                      fontSize: 12,
                      color: 'var(--text-dim)',
                    }}
                  >
                    <SourcePill label="env var" ok={secretStatus?.env ?? false} />
                    <SourcePill label="local file" ok={secretStatus?.local ?? false} />
                    <SourcePill label="keychain" ok={secretStatus?.registered ?? false} />
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginTop: space.sm,
                      lineHeight: 1.5,
                    }}
                  >
                    Local file lives at <code style={{ color: 'var(--text-dim)' }}>data/secrets.json</code>{' '}
                    with permissions 600. The desktop build overrides this with the OS keychain.
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 6, marginBottom: space.lg, flexWrap: 'wrap' }}>
              <button type="button" onClick={save} disabled={saving || !dirty} style={primaryButton(saving || !dirty)}>
                {saving ? 'saving…' : dirty ? 'save' : 'saved'}
              </button>
              <button type="button" onClick={runTest} disabled={testing} style={secondaryButton(testing)}>
                {testing ? 'testing…' : 'test connection'}
              </button>
            </div>

            {test && (
              <div
                className="metro-surface"
                style={{
                  borderColor: test.ok ? 'var(--status-canon)' : '#4a1b32',
                  padding: '12px 14px',
                  marginBottom: 10,
                }}
              >
                <div className="metro-subtitle" style={{ marginBottom: 6, color: test.ok ? 'var(--status-canon)' : '#e74c9b' }}>
                  {test.ok ? 'ok' : 'not ready'}
                </div>
                <div style={{ fontSize: type.body, color: 'var(--text-dim)', lineHeight: 1.5 }}>{test.message}</div>
                {test.model && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                    model · {test.model}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SourcePill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className="metro-subtitle"
      style={{
        padding: '4px 8px',
        border: `1px solid ${ok ? 'var(--status-canon)' : 'var(--border)'}`,
        color: ok ? 'var(--status-canon)' : 'var(--text-muted)',
      }}
    >
      {label} · {ok ? 'yes' : 'no'}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="metro-subtitle" style={{ color: 'var(--text-muted)' }}>{children}</div>;
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: metroFont,
    background: disabled ? 'var(--surface-2)' : 'var(--status-canon)',
    color: '#041015',
    border: '1px solid transparent',
    padding: '10px 16px',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: type.stamp,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 700,
    opacity: disabled ? 0.55 : 1,
    minHeight: 36,
  };
}

function secondaryButton(disabled: boolean): React.CSSProperties {
  return {
    ...chromeButtonStyle({ disabled }),
    padding: '10px 16px',
    minHeight: 36,
  };
}
