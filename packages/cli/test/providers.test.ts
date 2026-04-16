/**
 * Tests for the provider registry & runtime probe.
 *
 * Two goals:
 *   1. **Catalog invariants** — every built-in entry has a sensible shape,
 *      no brand is accidentally privileged, China + global + local are all
 *      present. These lock in Chronicle's "provider-agnostic" stance.
 *   2. **Runtime probe** — `detectProviders({env, fetch, specs})` picks up
 *      the right env var, honours base-URL overrides, and degrades
 *      gracefully when local servers aren't reachable. All tests inject a
 *      clean `env` + stub `fetch`; zero network calls.
 *
 * Style borrowed from hermes-agent's `tests/hermes_cli/test_api_key_providers.py`
 * (autouse env clear + monkeypatched auth resolver) and pi-mono's
 * table-driven provider suites.
 */

import { describe, expect, it } from 'bun:test';
import {
  BUILT_IN_PROVIDERS,
  type ProviderSpec,
  availableProviders,
  detectProviders,
} from '../src/providers.js';

/**
 * Stub `fetch` that always rejects. Safe default for tests that shouldn't
 * touch the network but include local-server specs in their probe set.
 */
function rejectingFetch(): typeof globalThis.fetch {
  return (async () => {
    throw new Error('network disabled in test');
  }) as unknown as typeof globalThis.fetch;
}

/**
 * Stub `fetch` that returns a configurable JSON body for a specific URL,
 * rejects everything else. Keeps intent visible in each test.
 */
function stubFetch(
  responses: Record<string, { status?: number; body?: unknown } | undefined>,
): typeof globalThis.fetch {
  // `RequestInfo` is a DOM lib type that isn't pulled in under our
  // strict node TS config. Bun's fetch accepts `string | URL | Request`
  // so narrow to that set — the runtime behavior is identical.
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const hit = responses[url];
    if (!hit) throw new Error(`unexpected fetch: ${url}`);
    const status = hit.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => hit.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

// ============================================================
// Catalog invariants
// ============================================================

describe('BUILT_IN_PROVIDERS catalog', () => {
  it('all ids are unique, lowercase, and non-empty', () => {
    const ids = BUILT_IN_PROVIDERS.map((p) => p.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
      expect(id).toBe(id.toLowerCase());
    }
  });

  it('every spec has required declarative fields', () => {
    for (const spec of BUILT_IN_PROVIDERS) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect([
        'openai-chat',
        'anthropic-messages',
        'google-generative',
        'codex-responses',
      ]).toContain(spec.transport);
      expect(['api-key', 'oauth-device-code', 'oauth-external', 'local-server', 'none']).toContain(
        spec.authType,
      );
      expect(['env', 'server']).toContain(spec.probe);
      // Local-server specs must have a default base URL (probe needs somewhere to ping).
      if (spec.authType === 'local-server') {
        expect(spec.baseUrlDefault).toBeDefined();
        expect(Array.isArray(spec.apiKeyEnvVars) && spec.apiKeyEnvVars.length === 0).toBe(true);
      }
      // API-key providers must declare at least one env var, or probing is impossible.
      if (spec.authType === 'api-key') {
        expect(spec.apiKeyEnvVars.length).toBeGreaterThan(0);
      }
    }
  });

  it('covers local servers, Chinese providers, and western clouds — no category missing', () => {
    const ids = new Set(BUILT_IN_PROVIDERS.map((p) => p.id));
    // Local
    expect(ids.has('lmstudio')).toBe(true);
    expect(ids.has('ollama')).toBe(true);
    // Western cloud
    expect(ids.has('anthropic')).toBe(true);
    expect(ids.has('openai')).toBe(true);
    expect(ids.has('openrouter')).toBe(true);
    expect(ids.has('google')).toBe(true);
    // Chinese — presence is the provider-agnosticism guarantee
    expect(ids.has('zai')).toBe(true);
    expect(ids.has('moonshot')).toBe(true);
    expect(ids.has('minimax')).toBe(true);
    expect(ids.has('dashscope')).toBe(true);
    expect(ids.has('deepseek')).toBe(true);
    // OAuth variants catalogued (probing may not be implemented yet)
    expect(ids.has('github-copilot')).toBe(true);
    expect(ids.has('codex')).toBe(true);
  });

  it('every provider with a declared default URL also declares a base-URL env var override', () => {
    // This is the "users can point DeepSeek at a reverse proxy" guarantee.
    // Exceptions: OAuth/OAuth-external providers inherit the upstream URL
    // and aggregators don't need a base-URL override.
    const exemptIds = new Set(['github-copilot', 'codex', 'vercel-ai-gateway']);
    for (const spec of BUILT_IN_PROVIDERS) {
      if (!spec.baseUrlDefault) continue;
      if (exemptIds.has(spec.id)) continue;
      expect(
        spec.baseUrlEnvVar,
        `provider '${spec.id}' has baseUrlDefault but no baseUrlEnvVar — users can't override it`,
      ).toBeDefined();
    }
  });
});

// ============================================================
// probeEnv — api-key probing
// ============================================================

describe('detectProviders (env probe)', () => {
  it('marks provider available when ANY of its env vars is set', async () => {
    const specs: ProviderSpec[] = [
      {
        id: 'anthropic',
        label: 'Anthropic',
        transport: 'anthropic-messages',
        authType: 'api-key',
        apiKeyEnvVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'],
        probe: 'env',
      },
    ];

    const probesA = await detectProviders({
      specs,
      env: { ANTHROPIC_API_KEY: 'sk-x' },
      fetch: rejectingFetch(),
    });
    expect(probesA[0]?.available).toBe(true);
    expect(probesA[0]?.resolvedKeyEnvVar).toBe('ANTHROPIC_API_KEY');

    const probesB = await detectProviders({
      specs,
      env: { ANTHROPIC_OAUTH_TOKEN: 'oat_123' },
      fetch: rejectingFetch(),
    });
    expect(probesB[0]?.available).toBe(true);
    expect(probesB[0]?.resolvedKeyEnvVar).toBe('ANTHROPIC_OAUTH_TOKEN');
  });

  it('checks env vars in declared priority order (first match wins)', async () => {
    const specs: ProviderSpec[] = [
      {
        id: 'zai',
        label: 'Zhipu / GLM',
        transport: 'openai-chat',
        authType: 'api-key',
        apiKeyEnvVars: ['ZAI_API_KEY', 'ZHIPU_API_KEY', 'GLM_API_KEY'],
        probe: 'env',
      },
    ];

    const probes = await detectProviders({
      specs,
      env: { ZHIPU_API_KEY: 'z1', GLM_API_KEY: 'g1' },
      fetch: rejectingFetch(),
    });
    // ZHIPU_API_KEY wins over GLM_API_KEY because it's earlier in the list.
    expect(probes[0]?.resolvedKeyEnvVar).toBe('ZHIPU_API_KEY');
  });

  it('ignores empty-string env values (not a real credential)', async () => {
    const specs: ProviderSpec[] = [
      {
        id: 'openai',
        label: 'OpenAI',
        transport: 'openai-chat',
        authType: 'api-key',
        apiKeyEnvVars: ['OPENAI_API_KEY'],
        probe: 'env',
      },
    ];
    const probes = await detectProviders({
      specs,
      env: { OPENAI_API_KEY: '' },
      fetch: rejectingFetch(),
    });
    expect(probes[0]?.available).toBe(false);
  });

  it('unset provider reports a hint naming every env var a user can set', async () => {
    const specs: ProviderSpec[] = [
      {
        id: 'moonshot',
        label: 'Moonshot',
        transport: 'openai-chat',
        authType: 'api-key',
        apiKeyEnvVars: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
        probe: 'env',
      },
    ];
    const probes = await detectProviders({ specs, env: {}, fetch: rejectingFetch() });
    expect(probes[0]?.note).toContain('MOONSHOT_API_KEY');
    expect(probes[0]?.note).toContain('KIMI_API_KEY');
  });

  it('respects baseUrlEnvVar override (env > default)', async () => {
    const specs: ProviderSpec[] = [
      {
        id: 'deepseek',
        label: 'DeepSeek',
        transport: 'openai-chat',
        authType: 'api-key',
        apiKeyEnvVars: ['DEEPSEEK_API_KEY'],
        baseUrlEnvVar: 'DEEPSEEK_BASE_URL',
        baseUrlDefault: 'https://api.deepseek.com/v1',
        probe: 'env',
      },
    ];
    const probes = await detectProviders({
      specs,
      env: {
        DEEPSEEK_API_KEY: 'sk-x',
        DEEPSEEK_BASE_URL: 'https://my-proxy.example.com/v1',
      },
      fetch: rejectingFetch(),
    });
    expect(probes[0]?.resolvedBaseUrl).toBe('https://my-proxy.example.com/v1');

    // Without override, default kicks in.
    const defaultProbes = await detectProviders({
      specs,
      env: { DEEPSEEK_API_KEY: 'sk-x' },
      fetch: rejectingFetch(),
    });
    expect(defaultProbes[0]?.resolvedBaseUrl).toBe('https://api.deepseek.com/v1');
  });
});

// ============================================================
// probeLocalServer — local server probing
// ============================================================

describe('detectProviders (server probe)', () => {
  const lmstudioSpec: ProviderSpec = {
    id: 'lmstudio',
    label: 'LM Studio',
    transport: 'openai-chat',
    authType: 'local-server',
    apiKeyEnvVars: [],
    baseUrlEnvVar: 'LMSTUDIO_BASE_URL',
    baseUrlDefault: 'http://localhost:1234/v1',
    probe: 'server',
  };

  const ollamaSpec: ProviderSpec = {
    id: 'ollama',
    label: 'Ollama',
    transport: 'openai-chat',
    authType: 'local-server',
    apiKeyEnvVars: [],
    baseUrlEnvVar: 'OLLAMA_HOST',
    baseUrlDefault: 'http://localhost:11434',
    probe: 'server',
    serverProbePath: '/api/tags',
    serverProbeModelKey: 'models',
  };

  it('LM Studio available with a model list → surfaces first model as suggestion', async () => {
    const probes = await detectProviders({
      specs: [lmstudioSpec],
      env: {},
      fetch: stubFetch({
        'http://localhost:1234/v1/models': {
          body: { data: [{ id: 'google/gemma-3-e4b' }, { id: 'other' }] },
        },
      }),
    });
    expect(probes[0]?.available).toBe(true);
    expect(probes[0]?.suggestedModel).toBe('google/gemma-3-e4b');
    expect(probes[0]?.note).toContain('google/gemma-3-e4b');
  });

  it('Ollama probe uses the declared path + response key', async () => {
    const probes = await detectProviders({
      specs: [ollamaSpec],
      env: {},
      fetch: stubFetch({
        'http://localhost:11434/api/tags': {
          body: { models: [{ name: 'llama3.1:8b' }] },
        },
      }),
    });
    expect(probes[0]?.available).toBe(true);
    expect(probes[0]?.suggestedModel).toBe('llama3.1:8b');
  });

  it('baseUrlEnvVar redirects the probe target', async () => {
    const probes = await detectProviders({
      specs: [lmstudioSpec],
      env: { LMSTUDIO_BASE_URL: 'http://remote-box:9999/v1' },
      fetch: stubFetch({
        'http://remote-box:9999/v1/models': { body: { data: [{ id: 'm1' }] } },
      }),
    });
    expect(probes[0]?.resolvedBaseUrl).toBe('http://remote-box:9999/v1');
    expect(probes[0]?.available).toBe(true);
  });

  it('server unreachable → unavailable with helpful note, never throws', async () => {
    const probes = await detectProviders({
      specs: [lmstudioSpec],
      env: {},
      fetch: rejectingFetch(),
    });
    expect(probes[0]?.available).toBe(false);
    expect(probes[0]?.note).toContain('not reachable');
  });

  it('server HTTP error (non-2xx) → unavailable, surface the status code', async () => {
    const probes = await detectProviders({
      specs: [lmstudioSpec],
      env: {},
      fetch: stubFetch({
        'http://localhost:1234/v1/models': { status: 503 },
      }),
    });
    expect(probes[0]?.available).toBe(false);
    expect(probes[0]?.note).toContain('503');
  });

  it('server returns unexpected JSON → still available, just no suggestedModel', async () => {
    // We're lenient here because the point is "server is up". Different
    // OpenAI-compatible servers return slightly different shapes; refusing
    // to mark them available would break users over cosmetic differences.
    const probes = await detectProviders({
      specs: [lmstudioSpec],
      env: {},
      fetch: stubFetch({
        'http://localhost:1234/v1/models': { body: { unexpected: 'shape' } },
      }),
    });
    expect(probes[0]?.available).toBe(true);
    expect(probes[0]?.suggestedModel).toBeUndefined();
  });
});

// ============================================================
// availableProviders
// ============================================================

describe('availableProviders', () => {
  it('filters to only available probes, preserving order', async () => {
    const specs: ProviderSpec[] = [
      {
        id: 'a',
        label: 'A',
        transport: 'openai-chat',
        authType: 'api-key',
        apiKeyEnvVars: ['A_KEY'],
        probe: 'env',
      },
      {
        id: 'b',
        label: 'B',
        transport: 'openai-chat',
        authType: 'api-key',
        apiKeyEnvVars: ['B_KEY'],
        probe: 'env',
      },
      {
        id: 'c',
        label: 'C',
        transport: 'openai-chat',
        authType: 'api-key',
        apiKeyEnvVars: ['C_KEY'],
        probe: 'env',
      },
    ];
    const probes = await detectProviders({
      specs,
      env: { A_KEY: 'x', C_KEY: 'x' },
      fetch: rejectingFetch(),
    });
    const ids = availableProviders(probes).map((p) => p.id);
    expect(ids).toEqual(['a', 'c']);
  });
});
