/**
 * Thin LLM helper abstraction for the compiler.
 *
 * Uses @mariozechner/pi-ai under the hood so we stay model-agnostic.
 * The compiler isn't a pi-agent (no tools, no state). It's single-shot calls
 * returning structured JSON.
 */

// Real impl would import from pi-ai. We define a tiny adapter interface here
// so compiler tests can mock without needing network.

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

/**
 * Default impl using pi-ai.
 * In tests, substitute a mock that returns prepared strings.
 */
export function createLlm(): Llm {
  return {
    async call(opts: LlmCallOpts): Promise<string> {
      // Dynamic import to keep compiler loadable even if pi-ai isn't installed
      // (e.g., in pure-unit-test contexts)
      const mod = await import('@mariozechner/pi-ai').catch(() => null);
      if (!mod) {
        throw new Error('@mariozechner/pi-ai is not installed. Install it or inject a mock Llm.');
      }
      // pi-ai's actual API: getModel(provider, id) → model with .complete()
      // This is aligned to what we saw in the pi-mono README.
      const model = (mod as any).getModel(opts.provider, opts.modelId);
      const result = await model.complete({
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        temperature: opts.temperature ?? 0.5,
        maxTokens: opts.maxTokens ?? 4096,
        responseFormat: opts.jsonMode ? { type: 'json_object' } : undefined,
      });
      return typeof result === 'string' ? result : (result.content ?? '');
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
