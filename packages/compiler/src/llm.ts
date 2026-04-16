/**
 * Thin LLM helper abstraction for the compiler.
 *
 * Uses @mariozechner/pi-ai under the hood so we stay model-agnostic.
 * The compiler isn't a pi-agent (no tools, no state). It's single-shot calls
 * returning structured JSON.
 *
 * Provider handling:
 *   - "lmstudio": routes to a local LM Studio OpenAI-compatible server at
 *     LMSTUDIO_BASE_URL (default http://localhost:1234/v1). Any model id the
 *     LM Studio UI lists (e.g. "google/gemma-3-e4b") is accepted; pi-ai's
 *     model registry is bypassed.
 *   - anything else: routed through `getModel(provider, id)` from pi-ai.
 *
 * Rationale: LM Studio gives zero-cost, zero-network-dependency LLM for
 * dev + tests. pi-ai doesn't ship a first-class lmstudio provider, but its
 * openai-completions path accepts any Model with a matching baseUrl.
 */

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
      const anyMod = mod as any;
      const model =
        opts.provider === 'lmstudio'
          ? buildLmStudioModel(opts.modelId)
          : anyMod.getModel(opts.provider, opts.modelId);

      const context = {
        systemPrompt: opts.system,
        messages: [{ role: 'user' as const, content: opts.user }],
      };

      // LM Studio accepts any apiKey string; set a placeholder so pi-ai's
      // "no key" guard doesn't trip. OPENROUTER/OPENAI paths read from env.
      const completeOptions: Record<string, unknown> = {
        temperature: opts.temperature ?? 0.5,
        maxTokens: opts.maxTokens ?? 4096,
      };
      if (opts.provider === 'lmstudio') {
        completeOptions.apiKey = process.env.LMSTUDIO_API_KEY ?? 'lm-studio';
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
 * Construct a pi-ai Model for LM Studio's OpenAI-compatible endpoint.
 *
 * pi-ai doesn't ship an lmstudio provider out of the box, but its
 * openai-completions path reads baseUrl from the model and its compat
 * settings from model.compat — so we hand-build a model here.
 *
 * The `compat` fields are important: LM Studio (like Ollama, vLLM, and
 * other OpenAI-compatible local servers) doesn't understand the `developer`
 * role that pi-ai sends for reasoning-capable models, and doesn't support
 * `reasoning_effort`. Without setting these to false, requests fail with
 * 400s on some models. See pi-ai's Custom Models docs.
 *
 * For permanent project-wide config, users can instead create
 * `~/.pi/agent/models.json` with an `lmstudio` provider entry — pi-ai picks
 * that up automatically via `getModel('lmstudio', ...)`. Either path works.
 */
function buildLmStudioModel(modelId: string) {
  const baseUrl = process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1';
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    // Use "openai" as provider so pi-ai's env-key lookup falls back to
    // OPENAI_API_KEY if apiKey isn't injected explicitly. We always inject
    // one above anyway (LM Studio accepts any string).
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
