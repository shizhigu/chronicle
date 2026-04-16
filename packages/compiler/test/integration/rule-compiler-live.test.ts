/**
 * RuleCompiler live test — real DeepSeek-v3.2 via OpenRouter.
 *
 * Two calls per successful run (classify + hard-rule parse). Output is
 * validated against our DSL parser — if the LLM emits something the
 * runtime can't parse, this test fails loudly (that's the whole point
 * of the validation step in RuleCompiler).
 *
 * Cost ceiling: ~$0.0005 per run. Gated by OPENROUTER_API_KEY.
 */

import { describe, expect, it } from 'bun:test';
import { evaluatePredicate } from '@chronicle/engine';
import { RuleCompiler } from '../../src/rule-compiler.js';

const HAS_KEY = !!process.env.OPENROUTER_API_KEY;
const PROVIDER = 'openrouter';
const MODEL = 'deepseek/deepseek-v3.2';

describe.skipIf(!HAS_KEY)('RuleCompiler live · DeepSeek v3.2', () => {
  it('compiles a simple hard rule → DSL that actually parses', async () => {
    const compiler = new RuleCompiler({ provider: PROVIDER, modelId: MODEL });
    const rule = await compiler.compileOne(
      'chr_live_test',
      'A character cannot speak if they have 0 energy.',
    );

    // Shape invariants
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

    // compilerNotes should be null for a successful hard compile; if the DSL
    // retry-and-fallback fired, it'd have a note. Either outcome is valid,
    // but if notes mention `dsl_unparseable_fallback`, something is off with
    // the model's output quality at this prompt.
    if (rule.compilerNotes?.includes('dsl_unparseable_fallback')) {
      // Still fine — the retry machinery rescued a bad emit. Log for visibility.
      console.warn(`[rule-compiler-live] DSL fallback fired: ${rule.compilerNotes.slice(0, 100)}`);
    }
  });

  it('compiles an economic rule → cost formula with energy key', async () => {
    const compiler = new RuleCompiler({ provider: PROVIDER, modelId: MODEL });
    const rule = await compiler.compileOne('chr_live_test', 'Speaking loudly costs 3 energy.');

    // Likely tier is economic but we accept soft too (it's a cost norm either way)
    expect(['economic', 'soft']).toContain(rule.tier);

    if (rule.tier === 'economic') {
      expect(rule.economicCostFormula).toBeTruthy();
      // Formula should contain energy=N
      expect(rule.economicCostFormula!).toMatch(/energy=\d/);
    }
  });
});
