/**
 * Provider catalog — pure data, no runtime dependencies.
 *
 * Lives in `@chronicle/core` so every package (compiler, engine, cli,
 * runtime) can reason over the same table without pulling in CLI-only
 * helpers. The CLI adds runtime probing on top in
 * `packages/cli/src/providers.ts`; the compiler uses the same table to
 * build LLM clients in `packages/compiler/src/llm.ts`.
 *
 * Chronicle does not privilege any provider. Whatever the user has
 * available — local server, western cloud, Chinese cloud, aggregator,
 * enterprise — is equally valid. The order of this table is readability
 * only; every runtime treats the rows equally.
 *
 * Adding a provider: one row here, one fixture test asserting it's
 * present. No other code edits should be required for the CLI to probe
 * it or the compiler to build a client for it.
 *
 * Shape credit: hermes-agent's `HermesOverlay` (hermes_cli/providers.py)
 * and pi-mono's per-provider env-var priority list
 * (packages/ai/src/env-api-keys.ts). We extend with a per-provider
 * `baseUrlEnvVar` so users can point `DEEPSEEK_BASE_URL` at a reverse
 * proxy, or flip `GLM_BASE_URL` between api.z.ai (global) and
 * open.bigmodel.cn (China), without code changes.
 */

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
  /** How availability is decided at runtime (used by the CLI probe). */
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
 * Full provider catalog.
 *
 * New entries: add one row. If the provider speaks `openai-chat` with an
 * api key or is a local server, no other code changes are required —
 * both the CLI probe and the compiler's LLM factory consume this table.
 *
 * If a new `transport` is required (e.g. a vendor that ships neither
 * OpenAI-chat- nor Anthropic-messages-compatible), `packages/compiler/src/llm.ts`
 * needs a matching branch.
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

/** Lookup helper. Returns `undefined` for unknown ids (user-supplied or typo). */
export function findProviderSpec(id: string): ProviderSpec | undefined {
  return BUILT_IN_PROVIDERS.find((p) => p.id === id);
}

/**
 * Resolve the effective base URL for a spec given an env object. Env-var
 * override beats declared default; both may be absent.
 */
export function resolveProviderBaseUrl(
  spec: ProviderSpec,
  env: Record<string, string | undefined>,
): string | undefined {
  if (spec.baseUrlEnvVar) {
    const override = env[spec.baseUrlEnvVar];
    if (override && override.length > 0) return override;
  }
  return spec.baseUrlDefault;
}

/**
 * Resolve an api key for a spec given an env object. Returns the first
 * non-empty value in the spec's declared priority order, or `undefined`.
 */
export function resolveProviderApiKey(
  spec: ProviderSpec,
  env: Record<string, string | undefined>,
): { value: string; envVar: string } | undefined {
  for (const varName of spec.apiKeyEnvVars) {
    const v = env[varName];
    if (typeof v === 'string' && v.length > 0) return { value: v, envVar: varName };
  }
  return undefined;
}
