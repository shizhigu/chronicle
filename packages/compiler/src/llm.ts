/**
 * Thin LLM helper abstraction for the compiler.
 *
 * Uses @mariozechner/pi-ai under the hood so we stay model-agnostic.
 * The compiler isn't a pi-agent (no tools, no state). It's single-shot calls
 * returning structured JSON.
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

/**
 * Default impl using pi-ai.
 * In tests, substitute a mock that returns prepared strings.
 */
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
      const model = anyMod.getModel(opts.provider, opts.modelId);

      const context = {
        systemPrompt: opts.system,
        messages: [{ role: 'user' as const, content: opts.user }],
      };

      const result = await anyMod.complete(model, context, {
        temperature: opts.temperature ?? 0.5,
        maxTokens: opts.maxTokens ?? 4096,
      });

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
