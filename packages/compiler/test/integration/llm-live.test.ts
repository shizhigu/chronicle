/**
 * Live LLM smoke — real call against a LOCAL LM Studio OpenAI-compatible server.
 *
 * Why local: zero cost, zero network dependency, deterministic availability.
 * The user turns on LM Studio's "Start Server" switch; these tests probe the
 * endpoint at load time and auto-skip if it's not reachable — so the default
 * `bun test` run stays fast and offline.
 *
 * Start the server: LM Studio → Developer tab → "Start Server" (port 1234).
 *   Override endpoint: LMSTUDIO_BASE_URL=http://192.168.1.10:1234/v1
 *   Override model:    LMSTUDIO_MODEL=google/gemma-3-e4b
 */

import { describe, expect, it } from 'bun:test';
import { createLlm, parseJsonResponse } from '../../src/llm.js';
import { lmStudioReady, resolveLmStudioModel } from './lmstudio-helper.js';

// Probe once at module load time.
const READY = await lmStudioReady();
const MODEL = resolveLmStudioModel();
const LIVE_TESTS_ENABLED = process.env.CHRONICLE_LIVE_TESTS === '1';

describe.skipIf(!READY || !LIVE_TESTS_ENABLED)('live LLM · LM Studio', () => {
  it('compiler LLM wrapper round-trips a short prompt', async () => {
    const llm = createLlm();
    // Reasoning-capable local models (Gemma w/ thinking, Qwen, DeepSeek-R1)
    // spend tokens on internal reasoning before the answer. Keep the cap
    // generous — wall-clock is the only cost here.
    const answer = await llm.call({
      provider: 'lmstudio',
      modelId: MODEL,
      system: 'You answer with ONLY a single digit, nothing else.',
      user: 'What is 2 + 2?',
      maxTokens: 200,
      temperature: 0,
    });
    expect(typeof answer).toBe('string');
    expect(answer.length).toBeGreaterThan(0);
    expect(answer).toMatch(/4/);
  }, 60_000);

  it('parseJsonResponse works on real model output', async () => {
    const llm = createLlm();
    const raw = await llm.call({
      provider: 'lmstudio',
      modelId: MODEL,
      system:
        'You respond with ONLY valid JSON, no prose, no code fences. Match the user-requested shape exactly.',
      user: 'Return this JSON object verbatim: {"ok": true, "answer": 42}',
      jsonMode: true,
      maxTokens: 80,
      temperature: 0,
    });
    const parsed = await parseJsonResponse<{ ok: boolean; answer: number }>(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.answer).toBe(42);
  });
});

describe('live LLM harness', () => {
  it('probes LM Studio at load time and gates tests accordingly', () => {
    // Whether or not the server is running, this is a valid boolean.
    expect(typeof READY).toBe('boolean');
    if (!READY) {
      // Not an error — just documentation that the gated suite was skipped.
      console.log(
        `[llm-live] LM Studio not reachable at ${process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1'} — gated tests skipped. Start the server in the LM Studio Developer tab to enable.`,
      );
    }
  });
});
