/**
 * CLI-side provider probing.
 *
 * The static catalog (types + `BUILT_IN_PROVIDERS`) lives in
 * `@chronicle/core` so every package can share it. This module adds the
 * runtime layer: probing env vars + local servers, returning a
 * `ProviderProbe` per spec. Kept here (not in core) because it depends
 * on `fetch` + `process.env` — not appropriate for the pure-data core.
 *
 * Test hygiene: `detectProviders({env, fetch, specs, serverProbeTimeoutMs})`
 * supports full dependency injection so tests never touch real env or
 * real network. This mirrors hermes-agent's autouse-env-clear pattern
 * (tests/hermes_cli/test_api_key_providers.py).
 */

import {
  BUILT_IN_PROVIDERS,
  type ProviderAuth,
  type ProviderSpec,
  type ProviderTransport,
  resolveProviderBaseUrl,
} from '@chronicle/core';

// Re-export catalog types + data so existing CLI callers keep their imports.
// New call sites should prefer importing from `@chronicle/core` directly.
export {
  BUILT_IN_PROVIDERS,
  findProviderSpec,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
  type ProviderAuth,
  type ProviderSpec,
  type ProviderTransport,
} from '@chronicle/core';

/**
 * Result of probing one `ProviderSpec` against the current env/network.
 *
 * Backwards-compatible shape: `kind` is derived from the spec's `authType`
 * for existing callers (`onboard.ts`, `doctor.ts`, their tests) that match
 * on it.
 */
export interface ProviderProbe {
  id: string;
  label: string;
  /** Derived — `server` for local servers, `oauth` for OAuth variants, else `env`. */
  kind: 'env' | 'server' | 'oauth';
  available: boolean;
  suggestedModel?: string;
  note?: string;
  transport?: ProviderTransport;
  authType?: ProviderAuth;
  /** Which env var actually carried a key (only when `available`). */
  resolvedKeyEnvVar?: string;
  /** Base URL in effect after applying env-var override + default. */
  resolvedBaseUrl?: string;
  /** True if this provider is an aggregator (OpenRouter, Vercel AI Gateway, …). */
  isAggregator?: boolean;
}

export interface DetectOpts {
  /**
   * Provider catalog to probe. Defaults to `BUILT_IN_PROVIDERS`. Tests can
   * inject a narrower list to stay deterministic; future user-config
   * overlays will pass a merged list.
   */
  specs?: readonly ProviderSpec[];
  /**
   * Env var source. Defaults to `process.env`. Tests inject a fresh object
   * (hermes's autouse-clear pattern in TypeScript form).
   */
  env?: Record<string, string | undefined>;
  /**
   * Fetch implementation for local-server probes. Defaults to
   * `globalThis.fetch`. Tests inject a stub that resolves without touching
   * the network.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Timeout (ms) for each local-server probe. Keeps onboarding snappy when
   * no local server is running. Default 1000.
   */
  serverProbeTimeoutMs?: number;
}

/**
 * Evaluate each provider spec against the current environment/network.
 *
 * Local-server probes run in parallel with a tight timeout so a single
 * offline server cannot slow onboarding. Env-only probes are synchronous
 * but we route them through the same `Promise.all` for shape consistency.
 */
export async function detectProviders(opts: DetectOpts = {}): Promise<ProviderProbe[]> {
  const specs = opts.specs ?? BUILT_IN_PROVIDERS;
  const env = opts.env ?? process.env;
  const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.serverProbeTimeoutMs ?? 1000;

  return Promise.all(
    specs.map((spec) =>
      spec.probe === 'server'
        ? probeLocalServer(spec, env, fetcher, timeoutMs)
        : Promise.resolve(probeEnv(spec, env)),
    ),
  );
}

/**
 * The subset of probes that are actually usable right now. Chronicle
 * never auto-picks one — ordering-by-preference here would be a brand bias
 * we don't want to ship. Filter only; caller chooses.
 */
export function availableProviders(probes: ProviderProbe[]): ProviderProbe[] {
  return probes.filter((p) => p.available);
}

// ============================================================
// Internal — probe helpers
// ============================================================

function kindFor(spec: ProviderSpec): ProviderProbe['kind'] {
  if (spec.probe === 'server' || spec.authType === 'local-server') return 'server';
  if (spec.authType === 'oauth-device-code' || spec.authType === 'oauth-external') return 'oauth';
  return 'env';
}

function probeEnv(spec: ProviderSpec, env: Record<string, string | undefined>): ProviderProbe {
  const found = spec.apiKeyEnvVars.find((v) => {
    const val = env[v];
    return typeof val === 'string' && val.length > 0;
  });
  const base: ProviderProbe = {
    id: spec.id,
    label: spec.label,
    kind: kindFor(spec),
    available: !!found,
    transport: spec.transport,
    authType: spec.authType,
    isAggregator: spec.isAggregator,
    resolvedBaseUrl: resolveProviderBaseUrl(spec, env),
    suggestedModel: spec.suggestedModel,
  };
  if (found) {
    return { ...base, resolvedKeyEnvVar: found, note: `found ${found}` };
  }
  const hint =
    spec.apiKeyEnvVars.length > 0
      ? `set ${spec.apiKeyEnvVars.join(' or ')} to enable`
      : 'requires auth (not configured)';
  return { ...base, note: hint };
}

async function probeLocalServer(
  spec: ProviderSpec,
  env: Record<string, string | undefined>,
  fetcher: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<ProviderProbe> {
  const baseUrl = resolveProviderBaseUrl(spec, env);
  const base: ProviderProbe = {
    id: spec.id,
    label: spec.label,
    kind: 'server',
    available: false,
    transport: spec.transport,
    authType: spec.authType,
    resolvedBaseUrl: baseUrl,
  };
  if (!baseUrl) {
    return { ...base, note: 'no base URL configured' };
  }
  const probePath = spec.serverProbePath ?? '/models';
  const modelKey = spec.serverProbeModelKey ?? 'data';
  const url = joinUrl(baseUrl, probePath);

  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      return {
        ...base,
        note: `${baseUrl} responded ${res.status}`,
      };
    }
    const body = (await res.json()) as Record<string, unknown>;
    const models = extractModelList(body, modelKey);
    const firstModel = models[0];
    return {
      ...base,
      available: true,
      suggestedModel: firstModel,
      note: firstModel ? `${baseUrl} · serving ${firstModel}` : baseUrl,
    };
  } catch {
    return {
      ...base,
      note: `not reachable at ${baseUrl}`,
    };
  }
}

/** Minimal URL join that tolerates a trailing slash on base or leading on path. */
function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * Pull a model-id list out of the server's probe response. Both shapes we
 * care about (`{ data: [{ id }] }` for OpenAI-compat, `{ models: [{ name }] }`
 * for Ollama) degrade gracefully to `[]` when the server returns something
 * unexpected — we still mark the server available in that case; the probe
 * succeeded, we just don't have a model name to suggest.
 */
function extractModelList(body: Record<string, unknown>, key: 'data' | 'models'): string[] {
  const raw = body[key];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.id === 'string' ? e.id : typeof e.name === 'string' ? e.name : null;
    if (name) out.push(name);
  }
  return out;
}
