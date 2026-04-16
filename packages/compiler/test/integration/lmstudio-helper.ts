/**
 * Shared helper for LM Studio integration tests.
 *
 * Why a helper file: every integration test needs to (a) detect whether LM
 * Studio's local server is reachable, and (b) use the same model id + base
 * URL. Centralizing this avoids drift.
 *
 * LM Studio exposes an OpenAI-compatible server at http://localhost:1234/v1.
 * Start it in the LM Studio UI → Developer tab → "Start Server".
 */

export const LMSTUDIO_BASE_URL = process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1';

export const LMSTUDIO_MODEL = process.env.LMSTUDIO_MODEL ?? 'google/gemma-3-e4b';

/**
 * Check whether LM Studio's OpenAI-compatible server is reachable and has
 * at least one model loaded. Returns the detected first model id, or null.
 */
export async function probeLmStudio(): Promise<string | null> {
  try {
    const res = await fetch(`${LMSTUDIO_BASE_URL}/models`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const firstId = body.data?.[0]?.id;
    return firstId ?? null;
  } catch {
    return null;
  }
}

/**
 * Call at test-file top level (before describe). Returns true if the server
 * is ready to serve calls; false otherwise. Tests use it with `describe.skipIf`.
 */
let cached: { ready: boolean; model: string | null } | null = null;

export async function lmStudioReady(): Promise<boolean> {
  if (cached) return cached.ready;
  const model = await probeLmStudio();
  cached = { ready: model !== null, model };
  return cached.ready;
}

/** The actual model id served by the running LM Studio instance, or LMSTUDIO_MODEL as fallback. */
export function resolveLmStudioModel(): string {
  return cached?.model ?? LMSTUDIO_MODEL;
}
