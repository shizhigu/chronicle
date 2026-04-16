/**
 * Thin LLM helper abstraction for the compiler.
 *
 * Uses @mariozechner/pi-ai under the hood so we stay model-agnostic.
 * The compiler isn't a pi-agent (no tools, no state). It's single-shot calls
 * returning structured JSON.
 *
 * ### Provider resolution
 *
 * 1. Look the provider up in `@chronicle/core`'s `BUILT_IN_PROVIDERS`.
 * 2. If the spec ships a `baseUrlDefault` (or the user overrode it via
 *    `baseUrlEnvVar`) and the transport is `openai-chat`, we hand-build a
 *    pi-ai Model using that base URL. This covers **every** local server
 *    (LM Studio / Ollama / vLLM / llama.cpp) and **every** OpenAI-compatible
 *    cloud (OpenRouter, Groq, DeepSeek, Kimi/Moonshot, Zhipu/GLM, MiniMax,
 *    Qwen/DashScope, Together, Fireworks, Cerebras, HF, Xiaomi MiMo…).
 * 3. Otherwise we fall through to pi-ai's native `getModel(provider, id)` —
 *    this covers Anthropic, Google, OpenAI, and any provider pi-ai ships
 *    with a first-class implementation.
 * 4. Unknown provider ids still fall through to pi-ai so users on
 *    pre-release / custom forks can reach providers we don't catalogue yet.
 *
 * Previously this file special-cased `provider === 'lmstudio'` with a
 * hand-written model. Generalising removes that branch and gives every
 * OpenAI-compatible endpoint the same treatment, including the Chinese
 * coding-plan endpoints users now expect to Just Work.
 */

import {
  type ProviderSpec,
  findProviderSpec,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
} from '@chronicle/core';

export interface LlmCallOpts {
  provider: string;
  modelId: string;
  system: string;
  user: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface Llm {
  call(opts: LlmCallOpts): Promise<string>;
}

export function createLlm(): Llm {
  return {
    async call(opts: LlmCallOpts): Promise<string> {
      // Dynamic import to keep compiler loadable even if pi-ai isn't installed
      // (e.g., in pure-unit-test contexts).
      const mod = await import('@mariozechner/pi-ai').catch(() => null);
      if (!mod) {
        throw new Error('@mariozechner/pi-ai is not installed. Install it or inject a mock Llm.');
      }

      // pi-ai's real API: `getModel(provider, id)` returns a Model config,
      // and `complete(model, context, options)` is a top-level function.
      // We loosen types at this boundary because pi-ai's generics are
      // parameterized over a model literal we don't carry through.
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai boundary
      const anyMod = mod as any;

      const spec = findProviderSpec(opts.provider);
      const handBuilt = shouldHandBuild(spec, process.env);
      const model = handBuilt
        ? buildOpenAiCompatModel(spec as ProviderSpec, opts.modelId, process.env)
        : anyMod.getModel(opts.provider, opts.modelId);

      const context = {
        systemPrompt: opts.system,
        messages: [{ role: 'user' as const, content: opts.user }],
      };

      const completeOptions: Record<string, unknown> = {
        temperature: opts.temperature ?? 0.5,
        maxTokens: opts.maxTokens ?? 4096,
      };

      // Inject an api key for hand-built models. Local servers accept any
      // string (LM Studio/Ollama/vLLM don't authenticate); cloud providers
      // need the env-var value picked up from the spec. pi-ai's native path
      // sources the key itself from its own env-key lookup.
      if (handBuilt) {
        completeOptions.apiKey = resolveApiKeyForHandBuilt(spec as ProviderSpec, process.env);
      }

      const result = await anyMod.complete(model, context, completeOptions);

      // Extract the text payload from the AssistantMessage content blocks.
      if (typeof result === 'string') return result;
      const content = result?.content;
      if (Array.isArray(content)) {
        return content
          .filter((c: { type?: string }) => c?.type === 'text')
          .map((c: { text?: string }) => c.text ?? '')
          .join('\n');
      }
      if (typeof content === 'string') return content;
      return '';
    },
  };
}

/**
 * Decide whether to hand-build a pi-ai Model from the catalog spec or let
 * pi-ai resolve the provider natively.
 *
 * Rule: hand-build iff (a) we have a spec, (b) transport is `openai-chat`,
 * and (c) we can resolve a concrete base URL. This picks up local servers
 * (always have a default), Chinese clouds, inference hosts, and
 * aggregators — none of which pi-ai ships native support for. Anthropic
 * and Google have their own transports and go through pi-ai natively;
 * OpenAI has no `baseUrlDefault` in our catalog so it also flows to pi-ai.
 */
export function shouldHandBuild(
  spec: ProviderSpec | undefined,
  env: Record<string, string | undefined>,
): spec is ProviderSpec {
  if (!spec) return false;
  if (spec.transport !== 'openai-chat') return false;
  const baseUrl = resolveProviderBaseUrl(spec, env);
  return typeof baseUrl === 'string' && baseUrl.length > 0;
}

/**
 * Build a pi-ai Model from a catalog spec for an OpenAI-compatible endpoint.
 *
 * The `compat` fields matter for a lot of the endpoints in our catalog:
 * local servers, Chinese clouds, and older OpenAI-compat shims often don't
 * understand the `developer` role or `reasoning_effort`. Defaulting these
 * off is the safe, widely-compatible choice. If a specific provider later
 * proves it *does* support them, we can opt in per-spec.
 *
 * We set `provider: 'openai'` at the pi-ai level so its openai-completions
 * transport handles the request; the vendor identity lives in our catalog,
 * not in pi-ai's routing.
 */
export function buildOpenAiCompatModel(
  spec: ProviderSpec,
  modelId: string,
  env: Record<string, string | undefined>,
) {
  const baseUrl = resolveProviderBaseUrl(spec, env);
  if (!baseUrl) {
    throw new Error(
      `Provider '${spec.id}' has no resolvable base URL. Set ${spec.baseUrlEnvVar ?? `${spec.id.toUpperCase()}_BASE_URL`} or declare a baseUrlDefault in the spec.`,
    );
  }
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    // pi-ai routes by the model's `provider` field; for openai-compat
    // transports we always use 'openai' regardless of vendor identity.
    provider: 'openai',
    baseUrl,
    reasoning: false,
    input: ['text'] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 8_192,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: 'max_tokens',
    },
  };
}

/**
 * Resolve the api key to hand to pi-ai for a hand-built model.
 *
 * Local servers: they accept any string, so we fall back to a placeholder.
 * Cloud providers: pull the first non-empty env var from the spec's
 * priority list. Undefined means "user's env doesn't carry a key" — pi-ai
 * will surface the auth error itself when the request fails.
 */
function resolveApiKeyForHandBuilt(
  spec: ProviderSpec,
  env: Record<string, string | undefined>,
): string | undefined {
  if (spec.authType === 'local-server') {
    // Some servers read their configured api key from env even though they
    // don't enforce; honour it if present, placeholder otherwise.
    const explicit = resolveProviderApiKey(spec, env);
    return explicit?.value ?? env.LMSTUDIO_API_KEY ?? 'lm-studio';
  }
  const resolved = resolveProviderApiKey(spec, env);
  return resolved?.value;
}

export async function parseJsonResponse<T>(raw: string): Promise<T> {
  // Strip any code fences the model likes to add
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/```$/, '')
      .trim();
  }
  // Sometimes models wrap JSON in prose — try to find the outer object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace > 0 || lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned) as T;
}
