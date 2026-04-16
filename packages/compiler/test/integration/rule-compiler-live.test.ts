/**
 * RuleCompiler live test — real call against local LM Studio.
 *
 * Two LLM calls per successful run (classify + hard-rule parse). The hard-rule
 * output must parse with our runtime DSL — that's the whole point of the
 * validation step in RuleCompiler. If the local model emits syntax the DSL
 * can't handle, the compiler falls back to a safe default and annotates notes.
 *
 * Gated: auto-skips if LM Studio's local server isn't reachable.
 */

import { describe, expect, it } from 'bun:test';
import { evaluatePredicate } from '@chronicle/engine';
import { RuleCompiler } from '../../src/rule-compiler.js';
import { lmStudioReady, resolveLmStudioModel } from './lmstudio-helper.js';

const READY = await lmStudioReady();
const MODEL = resolveLmStudioModel();
const LIVE_TESTS_ENABLED = process.env.CHRONICLE_LIVE_TESTS === '1';

describe.skipIf(!READY || !LIVE_TESTS_ENABLED)('RuleCompiler live · LM Studio', () => {
  it('compiles a simple hard rule → DSL that actually parses', async () => {
    const compiler = new RuleCompiler({ provider: 'lmstudio', modelId: MODEL });
    const rule = await compiler.compileOne(
      'chr_live_test',
      'A character cannot speak if they have 0 energy.',
    );

    expect(['hard', 'soft', 'economic']).toContain(rule.tier);

    if (rule.tier === 'hard') {
      expect(rule.hardCheck).toBeTruthy();
      // The DSL parser must accept whatever the LLM produced
      expect(() =>
        evaluatePredicate(rule.hardCheck!, {
          character: { alive: true, energy: 10 },
          action: { name: 'speak' },
          world: {},
        }),
      ).not.toThrow();
    }

    if (rule.compilerNotes?.includes('dsl_unparseable_fallback')) {
      console.warn(
        `[rule-compiler-live] DSL fallback fired (expected occasionally with smaller local models): ${rule.compilerNotes.slice(0, 120)}`,
      );
    }
  }, 60_000);
});
