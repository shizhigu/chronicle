/**
 * Provider detection — the canonical list of what Chronicle *knows about*
 * (`BUILT_IN_PROVIDERS`) and a runtime probe that checks which of those are
 * *actually usable* on this machine right now.
 *
 * Chronicle does not privilege any provider. Whatever the user has
 * available — local server, western cloud, Chinese cloud, aggregator,
 * enterprise — is equally valid. Detection surfaces everything; the user
 * (or their agent) picks.
 *
 * ### Architecture — why the split between `ProviderSpec` and `ProviderProbe`
 *
 * `ProviderSpec` is the **static catalog**: purely declarative, safe to
 * reason over at build time, diff in code review, and document. Every row
 * has the same shape (transport + auth + env vars + optional base-URL
 * override) so adding a provider is "one row, two tests".
 *
 * `ProviderProbe` is the **runtime outcome** of evaluating a spec against
 * the current environment. It carries backwards-compatible fields
 * (`kind`/`available`/`note`) that older callers and tests rely on.
 *
 * Credit: the table shape borrows from hermes-agent's `HermesOverlay`
 * (hermes_cli/providers.py) and pi-mono's per-provider env-var priority
 * list (packages/ai/src/env-api-keys.ts). We extend it with per-provider
 * `baseUrlEnvVar` so users can point `DEEPSEEK_BASE_URL` at a reverse
 * proxy, or flip `GLM_BASE_URL` between api.z.ai (global) and
 * open.bigmodel.cn (China), without Chronicle code changes.
 */

// ============================================================
// Types
// ============================================================

/**
 * Wire protocol this provider speaks. Independent of the vendor's identity —
 * Anthropic, MiniMax, and Zhipu's Anthropic-compat endpoint all speak
 * `anthropic-messages`; OpenAI, DeepSeek, Kimi, and every local server all
 * speak `openai-chat`. Runtime code can dispatch on this alone.
 */
export type ProviderTransport =
  | 'openai-chat'
  | 'anthropic-messages'
  | 'google-generative'
  | 'codex-responses';

/**
 * How the provider is authenticated. `oauth-*` variants are catalogued now
 * so docs/help text can describe them even before Chronicle implements the
 * actual flow; probing currently treats them as env-only (import token into
 * a recognised env var and we'll pick it up).
 */
export type ProviderAuth =
  | 'api-key'
  | 'oauth-device-code'
  | 'oauth-external'
  | 'local-server'
  | 'none';

/** Static, declarative record of a provider Chronicle can talk to. */
export interface ProviderSpec {
  /** Canonical id, e.g. "anthropic", "zai", "lmstudio". Lowercase, stable. */
  id: string;
  /** Human label shown in CLI output. */
  label: string;
  transport: ProviderTransport;
  authType: ProviderAuth;
  /** Env vars checked in priority order; first non-empty match wins. */
  apiKeyEnvVars: readonly string[];
  /** Env var name the user can set to override the base URL. */
  baseUrlEnvVar?: string;
  /** Fallback base URL if neither env var nor explicit config is set. */
  baseUrlDefault?: string;
  /** An aggregator (multiple vendors behind one key). Informational. */
  isAggregator?: boolean;
  /**
   * Initial model suggestion shown alongside this provider in onboarding.
   * User-overridable; never a hard default.
   */
  suggestedModel?: string;
  /** How availability is decided at runtime. */
  probe: 'env' | 'server';
  /**
   * For `probe: 'server'`. Path appended to the resolved base URL to probe.
   * Default `/models` (OpenAI-compatible). Ollama overrides with `/api/tags`.
   */
  serverProbePath?: string;
  /**
   * For `probe: 'server'`. JSON key under which the server reports its model
   * list. Default `data` (OpenAI). Ollama uses `models`.
   */
  serverProbeModelKey?: 'data' | 'models';
}

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
  // New, optional — older tests don't set these but newer callers can use them.
  transport?: ProviderTransport;
  authType?: ProviderAuth;
  /** Which env var actually carried a key (only when `available`). */
  resolvedKeyEnvVar?: string;
  /** Base URL in effect after applying env-var override + default. */
  resolvedBaseUrl?: string;
  /** True if this provider is an aggregator (OpenRouter, Vercel AI Gateway, …). */
  isAggregator?: boolean;
}

// ============================================================
// Built-in provider catalog
// ============================================================

/**
 * The full set of providers Chronicle knows about out-of-the-box.
 *
 * This list is deliberately broad — a user who has imported a DeepSeek key
 * or a Kimi coding-plan token shouldn't need a Chronicle PR to be
 * recognised. New entries are cheap: add one row and a fixture test.
 *
 * Ordering is loose-by-category (local → western → chinese → enterprise →
 * oauth), but Chronicle does not use the order as a priority — all are
 * treated equally. Keep like with like for human readability only.
 */
export const BUILT_IN_PROVIDERS: readonly ProviderSpec[] = [
  // ---------- Local servers ----------
  {
    id: 'lmstudio',
    label: 'LM Studio',
    transport: 'openai-chat',
    authType: 'local-server',
    apiKeyEnvVars: [],
    baseUrlEnvVar: 'LMSTUDIO_BASE_URL',
    baseUrlDefault: 'http://localhost:1234/v1',
    probe: 'server',
  },
  {
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
  },
  {
    id: 'vllm',
    label: 'vLLM',
    transport: 'openai-chat',
    authType: 'local-server',
    apiKeyEnvVars: [],
    baseUrlEnvVar: 'VLLM_BASE_URL',
    baseUrlDefault: 'http://localhost:8000/v1',
    probe: 'server',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp server',
    transport: 'openai-chat',
    authType: 'local-server',
    apiKeyEnvVars: [],
    baseUrlEnvVar: 'LLAMACPP_BASE_URL',
    baseUrlDefault: 'http://localhost:8080/v1',
    probe: 'server',
  },

  // ---------- Western clouds ----------
  {
    id: 'anthropic',
    label: 'Anthropic',
    transport: 'anthropic-messages',
    authType: 'api-key',
    apiKeyEnvVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'],
    baseUrlEnvVar: 'ANTHROPIC_BASE_URL',
    probe: 'env',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    baseUrlEnvVar: 'OPENAI_BASE_URL',
    probe: 'env',
  },
  {
    id: 'google',
    label: 'Google AI Studio',
    transport: 'google-generative',
    authType: 'api-key',
    apiKeyEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    probe: 'env',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['OPENROUTER_API_KEY'],
    baseUrlEnvVar: 'OPENROUTER_BASE_URL',
    baseUrlDefault: 'https://openrouter.ai/api/v1',
    isAggregator: true,
    probe: 'env',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['MISTRAL_API_KEY'],
    probe: 'env',
  },
  {
    id: 'groq',
    label: 'Groq',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['GROQ_API_KEY'],
    baseUrlEnvVar: 'GROQ_BASE_URL',
    baseUrlDefault: 'https://api.groq.com/openai/v1',
    probe: 'env',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['CEREBRAS_API_KEY'],
    baseUrlEnvVar: 'CEREBRAS_BASE_URL',
    baseUrlDefault: 'https://api.cerebras.ai/v1',
    probe: 'env',
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['FIREWORKS_API_KEY'],
    baseUrlEnvVar: 'FIREWORKS_BASE_URL',
    baseUrlDefault: 'https://api.fireworks.ai/inference/v1',
    probe: 'env',
  },
  {
    id: 'together',
    label: 'Together',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['TOGETHER_API_KEY'],
    baseUrlEnvVar: 'TOGETHER_BASE_URL',
    baseUrlDefault: 'https://api.together.xyz/v1',
    probe: 'env',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face Inference',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
    baseUrlEnvVar: 'HF_BASE_URL',
    baseUrlDefault: 'https://router.huggingface.co/v1',
    probe: 'env',
  },

  // ---------- Chinese providers (global + mainland endpoints) ----------
  // Users on coding plans for these services should be able to point their
  // keys at Chronicle without config gymnastics. Base-URL env vars let the
  // same key reach either the global or the .cn endpoint.
  {
    id: 'zai',
    label: 'Zhipu / GLM',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['ZAI_API_KEY', 'ZHIPU_API_KEY', 'GLM_API_KEY'],
    baseUrlEnvVar: 'GLM_BASE_URL',
    baseUrlDefault: 'https://api.z.ai/api/paas/v4',
    probe: 'env',
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi (global)',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    baseUrlEnvVar: 'MOONSHOT_BASE_URL',
    baseUrlDefault: 'https://api.moonshot.ai/v1',
    probe: 'env',
  },
  {
    id: 'moonshot-cn',
    label: 'Moonshot / Kimi (China)',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['MOONSHOT_CN_API_KEY', 'KIMI_CN_API_KEY'],
    baseUrlEnvVar: 'MOONSHOT_CN_BASE_URL',
    baseUrlDefault: 'https://api.moonshot.cn/v1',
    probe: 'env',
  },
  {
    id: 'minimax',
    label: 'MiniMax (global)',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['MINIMAX_API_KEY'],
    baseUrlEnvVar: 'MINIMAX_BASE_URL',
    baseUrlDefault: 'https://api.minimaxi.com/v1',
    probe: 'env',
  },
  {
    id: 'minimax-cn',
    label: 'MiniMax (China)',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['MINIMAX_CN_API_KEY'],
    baseUrlEnvVar: 'MINIMAX_CN_BASE_URL',
    baseUrlDefault: 'https://api.minimax.chat/v1',
    probe: 'env',
  },
  {
    id: 'dashscope',
    label: 'Alibaba DashScope / Qwen',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    baseUrlEnvVar: 'DASHSCOPE_BASE_URL',
    baseUrlDefault: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    probe: 'env',
  },
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
  {
    id: 'mimo',
    label: 'Xiaomi MiMo',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['MIMO_API_KEY', 'XIAOMI_API_KEY'],
    baseUrlEnvVar: 'MIMO_BASE_URL',
    probe: 'env',
  },

  // ---------- Enterprise / gateway ----------
  {
    id: 'azure-openai-responses',
    label: 'Azure OpenAI',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['AZURE_OPENAI_API_KEY'],
    baseUrlEnvVar: 'AZURE_OPENAI_ENDPOINT',
    probe: 'env',
  },
  {
    id: 'vercel-ai-gateway',
    label: 'Vercel AI Gateway',
    transport: 'openai-chat',
    authType: 'api-key',
    apiKeyEnvVars: ['AI_GATEWAY_API_KEY'],
    baseUrlDefault: 'https://gateway.ai.vercel.dev/v1',
    isAggregator: true,
    probe: 'env',
  },

  // ---------- OAuth (catalogued; probed via imported env tokens for now) ----------
  // Full device-code flows will land as standalone modules per
  // pi-mono's pattern (packages/ai/src/utils/oauth/*). Until then, users
  // who've authenticated via the vendor's own CLI can export the resulting
  // token into one of these env vars and Chronicle will pick it up.
  {
    id: 'github-copilot',
    label: 'GitHub Copilot',
    transport: 'openai-chat',
    authType: 'oauth-external',
    apiKeyEnvVars: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
    probe: 'env',
  },
  {
    id: 'codex',
    label: 'OpenAI Codex',
    transport: 'codex-responses',
    authType: 'oauth-device-code',
    apiKeyEnvVars: ['CODEX_OAUTH_TOKEN', 'OPENAI_CODEX_AUTH'],
    baseUrlDefault: 'https://chatgpt.com/backend-api/codex',
    probe: 'env',
  },
];

// ============================================================
// Runtime probe
// ============================================================

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

/**
 * Compute the effective base URL: env-var override beats declared default.
 * Returns `undefined` if neither is present (only possible for providers
 * that have no default and expect user configuration).
 */
function resolveBaseUrl(
  spec: ProviderSpec,
  env: Record<string, string | undefined>,
): string | undefined {
  if (spec.baseUrlEnvVar) {
    const override = env[spec.baseUrlEnvVar];
    if (override && override.length > 0) return override;
  }
  return spec.baseUrlDefault;
}

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
    resolvedBaseUrl: resolveBaseUrl(spec, env),
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
  const baseUrl = resolveBaseUrl(spec, env);
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
