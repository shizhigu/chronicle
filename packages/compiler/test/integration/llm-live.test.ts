/**
 * Live LLM smoke test — makes a REAL call to OpenRouter's deepseek/deepseek-v3.2.
 *
 * SAFETY RAILS:
 *   - Skipped entirely when OPENROUTER_API_KEY is not set (never fails CI).
 *   - maxTokens capped at 60 per call.
 *   - temperature = 0 for determinism.
 *   - Only 2 calls per test run, total.
 *   - The API key is never logged, echoed, or interpolated into any string.
 *
 * If a run costs more than a fraction of a cent, something is wrong — bail.
 *
 * Enable locally with:
 *   export OPENROUTER_API_KEY=sk-or-...
 *   bun test packages/compiler/test/integration
 */

import { describe, expect, it } from 'bun:test';
import { createLlm, parseJsonResponse } from '../../src/llm.js';

const HAS_KEY = !!process.env.OPENROUTER_API_KEY;
const PROVIDER = 'openrouter';
const MODEL = 'deepseek/deepseek-v3.2';

describe.skipIf(!HAS_KEY)('live LLM · OpenRouter · deepseek-v3.2', () => {
  it('compiler LLM wrapper can round-trip a short prompt', async () => {
    const llm = createLlm();
    const answer = await llm.call({
      provider: PROVIDER,
      modelId: MODEL,
      system: 'You answer with exactly one word, nothing else.',
      user: 'What is 2 + 2? Reply with the digit only.',
      maxTokens: 20,
      temperature: 0,
    });
    // Model might include punctuation or whitespace; just check the digit is present
    expect(typeof answer).toBe('string');
    expect(answer.length).toBeGreaterThan(0);
    expect(answer).toMatch(/4/);
    // Very short answer expected — guard against runaway output
    expect(answer.length).toBeLessThan(200);
  });

  it('parseJsonResponse works on real model output', async () => {
    const llm = createLlm();
    const raw = await llm.call({
      provider: PROVIDER,
      modelId: MODEL,
      system:
        'You respond with ONLY valid JSON, no prose, no code fences. The JSON must match the user-specified shape exactly.',
      user: 'Return JSON: {"ok": true, "answer": 42}',
      jsonMode: true,
      maxTokens: 60,
      temperature: 0,
    });
    const parsed = await parseJsonResponse<{ ok: boolean; answer: number }>(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.answer).toBe(42);
  });
});

// Show-up test: reminds us the live suite exists and confirms it's gated.
describe('live LLM test harness', () => {
  it('is present and gated behind OPENROUTER_API_KEY', () => {
    // If HAS_KEY is false, the describe.skipIf above skips real tests.
    // If true, the real tests run. Either way this sanity check always passes.
    expect(typeof HAS_KEY).toBe('boolean');
  });

  it('documents the security invariant: never serialize process.env in prod code', () => {
    // No runtime check can prevent a careless `console.log(process.env)` —
    // this test exists so the invariant is visible in the test file and
    // we'd notice if someone removed it.
    const invariant = 'never serialize process.env; env keys are secrets';
    expect(invariant.length).toBeGreaterThan(0);
  });
});
