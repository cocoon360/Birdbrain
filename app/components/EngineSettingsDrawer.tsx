'use client';

import { useEffect, useState } from 'react';
import { isTauri, keychainClear, keychainGet, keychainSet } from '@/lib/desktop/tauri-bridge';

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
    modelHint: 'e.g. opus-4.7, sonnet-4.5',
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

  useEffect(() => {
    setHasKeychain(isTauri());
  }, []);

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
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 96vw)',
          height: '100vh',
          background: '#0b0b0b',
          borderLeft: '1px solid #1c1c1c',
          padding: '32px 32px 28px',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          color: '#f0f0f0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div
            style={{
              fontSize: '0.64rem',
              letterSpacing: '0.22em',
              color: '#00b4d8',
              fontWeight: 700,
            }}
          >
            ENGINE SETTINGS
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #2c2c2c',
              color: '#888',
              padding: '6px 10px',
              fontSize: '0.6rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            close
          </button>
        </div>

        <h2 style={{ fontSize: '2.4rem', fontWeight: 200, letterSpacing: '-0.03em', margin: 0, marginBottom: 8 }}>
          engine
        </h2>
        <div style={{ fontSize: '0.78rem', color: '#888', lineHeight: 1.6, marginBottom: 24 }}>
          Pick which model Bird Brain calls for synthesis, ontology, and briefs. This is stored on
          the workspace so different projects can use different engines.
        </div>

        {loading ? (
          <div style={{ color: '#666', fontSize: '0.8rem' }}>loading…</div>
        ) : (
          <>
            <div style={{ marginBottom: 18 }}>
              <Label>provider</Label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 8 }}>
                {(Object.keys(PROVIDER_COPY) as Provider[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    style={{
                      textAlign: 'left',
                      background: provider === p ? '#101d21' : '#0f0f0f',
                      border: `1px solid ${provider === p ? '#00b4d8' : '#1c1c1c'}`,
                      padding: '12px 14px',
                      cursor: 'pointer',
                      color: '#ddd',
                    }}
                  >
                    <div style={{ fontSize: '0.82rem', color: provider === p ? '#00b4d8' : '#f0f0f0', marginBottom: 4 }}>
                      {PROVIDER_COPY[p].title}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#888', lineHeight: 1.5 }}>
                      {PROVIDER_COPY[p].blurb}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <Label>model</Label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={copy.modelHint}
                style={inputStyle}
              />
            </div>

            {(provider === 'ollama' || provider === 'openai' || provider === 'anthropic') && (
              <div style={{ marginBottom: 16 }}>
                <Label>endpoint (optional)</Label>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder={
                    provider === 'ollama'
                      ? 'http://localhost:11434'
                      : provider === 'openai'
                      ? 'https://api.openai.com/v1/chat/completions'
                      : 'https://api.anthropic.com/v1/messages'
                  }
                  style={inputStyle}
                />
              </div>
            )}

            {(provider === 'openai' || provider === 'anthropic') && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Label>api key env var</Label>
                  <input
                    type="text"
                    value={apiKeyEnv}
                    onChange={(e) => setApiKeyEnv(e.target.value)}
                    placeholder={copy.keyHint}
                    style={inputStyle}
                  />
                  <div style={{ fontSize: '0.66rem', color: '#555', marginTop: 6, lineHeight: 1.5 }}>
                    In dev, put the key in <code style={{ color: '#888' }}>.env.local</code>. In the
                    desktop build, the keychain plugin will resolve it automatically.
                  </div>
                </div>

                <div style={{ marginBottom: 18 }}>
                  <Label>api key value (stored locally)</Label>
                  <input
                    type="password"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    placeholder={secretStatus?.env || secretStatus?.local ? '•••••••• (set)' : 'paste key to store'}
                    style={inputStyle}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      onClick={saveSecret}
                      disabled={savingSecret || !secretValue.trim()}
                      style={primaryButton(savingSecret || !secretValue.trim())}
                    >
                      {savingSecret ? 'saving…' : 'store locally'}
                    </button>
                    {secretStatus?.local && (
                      <button onClick={clearSecret} style={secondaryButton(false)}>
                        clear stored
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: '0.66rem', color: '#666' }}>
                    <SourcePill label="env var" ok={secretStatus?.env ?? false} />
                    <SourcePill label="local file" ok={secretStatus?.local ?? false} />
                    <SourcePill label="keychain" ok={secretStatus?.registered ?? false} />
                  </div>
                  <div style={{ fontSize: '0.64rem', color: '#555', marginTop: 6, lineHeight: 1.5 }}>
                    Local file lives at <code style={{ color: '#777' }}>~/.birdbrain/secrets.json</code> with
                    permissions 600. The desktop build overrides this with the OS keychain.
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 6, marginBottom: 18, flexWrap: 'wrap' }}>
              <button onClick={save} disabled={saving || !dirty} style={primaryButton(saving || !dirty)}>
                {saving ? 'saving…' : dirty ? 'save' : 'saved'}
              </button>
              <button onClick={runTest} disabled={testing} style={secondaryButton(testing)}>
                {testing ? 'testing…' : 'test connection'}
              </button>
            </div>

            {test && (
              <div
                style={{
                  background: '#0f0f0f',
                  border: `1px solid ${test.ok ? '#1e4d3a' : '#4a1b32'}`,
                  padding: '12px 14px',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontSize: '0.6rem',
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: test.ok ? '#00d68f' : '#e74c9b',
                    marginBottom: 6,
                  }}
                >
                  {test.ok ? 'ok' : 'not ready'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#ccc', lineHeight: 1.5 }}>{test.message}</div>
                {test.model && (
                  <div style={{ fontSize: '0.68rem', color: '#666', marginTop: 6 }}>
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
      style={{
        padding: '3px 8px',
        border: `1px solid ${ok ? '#1e4d3a' : '#222'}`,
        color: ok ? '#00d68f' : '#555',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}
    >
      {label} · {ok ? 'yes' : 'no'}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.6rem',
        letterSpacing: '0.18em',
        color: '#666',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}
    >
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f0f',
  border: '1px solid #1c1c1c',
  color: '#eee',
  padding: '10px 12px',
  fontSize: '0.82rem',
  outline: 'none',
  marginTop: 8,
};

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#1c3a2f' : '#00d68f',
    color: '#041015',
    border: 'none',
    padding: '10px 14px',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '0.64rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
    opacity: disabled ? 0.7 : 1,
  };
}

function secondaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: '#f0f0f0',
    border: '1px solid #2c2c2c',
    padding: '10px 14px',
    cursor: disabled ? 'wait' : 'pointer',
    fontSize: '0.64rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
    opacity: disabled ? 0.6 : 1,
  };
}
