/**
 * Transcript utilities.
 *
 * Pi-agent's `state.messages` array grows every turn as user prompts,
 * assistant messages, and tool results accumulate. Left unbounded, a
 * 50-tick run on a local model with an 8K context window overflows
 * around message ~180. Durable character state lives in the memory
 * file (hermes pattern), so the transcript only needs to carry
 * recent-turn continuity.
 */

/**
 * Window size (in individual messages, not turns) kept in each agent's
 * pi-agent transcript. At ~5-8 messages per turn (user prompt, assistant
 * rounds with internal tool calls, tool results), 120 keeps ~15-20
 * recent turns in view — enough for inner-monologue continuity without
 * letting the transcript balloon past local-model context limits
 * (gemma-4-26B-A4B has an 8K window; empirically we run out around
 * message ~180).
 */
export const TRANSCRIPT_WINDOW_MESSAGES = 120;

/**
 * Drop the oldest messages so the transcript has at most `window`
 * entries. Preserves message order — we always keep the TAIL, not
 * the head, because the tail is what an LLM needs to stay coherent
 * on the next prompt.
 *
 * Returns the original array by reference when no trim is needed
 * so callers can detect the no-op case via identity check and skip
 * writing it back.
 */
export function trimTranscript<T>(messages: T[], window = TRANSCRIPT_WINDOW_MESSAGES): T[] {
  if (messages.length <= window) return messages;
  return messages.slice(messages.length - window);
}
