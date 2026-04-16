/**
 * Rule compiler tests with mocked LLM.
 *
 * We don't need a real LLM for these — we inject a pre-scripted Llm that
 * returns known JSON. Tests verify the compiler's behavior around
 * classification, parsing, rule building, and graceful degradation.
 */

import { describe, expect, it } from 'bun:test';
import type { Llm, LlmCallOpts } from '../src/llm.js';
import { RuleCompiler } from '../src/rule-compiler.js';

function mockLlm(script: Record<string, string>): Llm {
  return {
    async call(opts: LlmCallOpts): Promise<string> {
      // Naive: match by whether user prompt contains a keyword
      for (const key of Object.keys(script)) {
        if (opts.user.includes(key)) {
          return script[key]!;
        }
      }
      throw new Error(`No script for: ${opts.user.slice(0, 80)}`);
    },
  };
}

describe('RuleCompiler', () => {
  it('classifies a hard rule and builds compiled form', async () => {
    const _llm = mockLlm({
      // 1. classification
      'One action per tick': JSON.stringify({
        tier: 'hard',
        reasoning: 'obvious physical constraint',
      }),
    });
    // The compiler makes multiple calls. We have to chain them via order, which means
    // we need a smarter mock. Let's use a sequence.
    let callIdx = 0;
    const sequence = [
      JSON.stringify({ tier: 'hard' }),
      JSON.stringify({
        predicate: 'at most one action per tick per agent',
        check: 'action_count_per_tick <= 1',
        onViolation: 'reject',
      }),
    ];
    const seqLlm: Llm = {
      async call() {
        return sequence[callIdx++]!;
      },
    };

    const compiler = new RuleCompiler({ llm: seqLlm });
    const rule = await compiler.compileOne('chr_test', 'One action per tick per agent.');

    expect(rule.tier).toBe('hard');
    expect(rule.hardCheck).toBe('action_count_per_tick <= 1');
    expect(rule.hardOnViolation).toBe('reject');
    expect(rule.active).toBe(true);
  });

  it('classifies a soft rule and builds compiled form', async () => {
    let callIdx = 0;
    const sequence = [
      JSON.stringify({ tier: 'soft' }),
      JSON.stringify({
        normText: 'Lying is considered dishonorable in this community.',
        detectionPrompt: 'Did the speaker knowingly make a false statement?',
        consequence: 'Witnesses lose trust in the liar.',
        affectedRelationships: ['trust'],
        reputationDelta: -15,
      }),
    ];
    const llm: Llm = {
      async call() {
        return sequence[callIdx++]!;
      },
    };

    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'Lying is dishonorable.');

    expect(rule.tier).toBe('soft');
    expect(rule.softNormText).toContain('Lying');
    expect(rule.softDetectionPrompt).toContain('false statement');
  });

  it('classifies an economic rule and produces cost formula', async () => {
    let callIdx = 0;
    const sequence = [
      JSON.stringify({ tier: 'economic' }),
      JSON.stringify({
        appliesToAction: 'speak',
        costs: { energy: 1, tokens: 5 },
      }),
    ];
    const llm: Llm = {
      async call() {
        return sequence[callIdx++]!;
      },
    };

    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'Speaking costs 1 energy and 5 tokens.');

    expect(rule.tier).toBe('economic');
    expect(rule.economicActionType).toBe('speak');
    expect(rule.economicCostFormula).toContain('energy=1');
    expect(rule.economicCostFormula).toContain('tokens=5');
  });

  it('defaults ambiguous rules to soft tier with compiler notes', async () => {
    const llm: Llm = {
      async call(opts) {
        if (opts.user.toLowerCase().includes('rule:')) {
          return JSON.stringify({ tier: 'ambiguous', reasoning: 'could be either' });
        }
        throw new Error('unexpected call');
      },
    };

    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'The strong should protect the weak');

    expect(rule.tier).toBe('soft');
    expect(rule.compilerNotes).toContain('ambiguous');
  });

  // ============================================================
  // Robustness to LLM slop in the optional `scope` field.
  //
  // In the wild, small models routinely return `scope` as a prose string
  // ("applies to all agents") or an array instead of the expected object.
  // That used to crash the compile with a Zod dump; now we preprocess
  // non-object values to undefined and keep going.
  // ============================================================

  it('survives LLM returning scope as a string (used to crash with Zod dump)', async () => {
    let callIdx = 0;
    const sequence = [
      JSON.stringify({ tier: 'soft' }),
      JSON.stringify({
        normText: "Don't lie to allies",
        detectionPrompt: 'Did the speaker lie?',
        consequence: 'trust decreases',
        scope: 'applies to everyone', // <— wrong shape; used to crash
      }),
    ];
    const llm: Llm = {
      async call() {
        return sequence[callIdx++]!;
      },
    };
    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'Lying damages trust');
    expect(rule.tier).toBe('soft');
    // scope silently dropped — rule still compiles
    expect(rule.scope).toBeUndefined();
  });

  it('survives LLM returning scope as an array', async () => {
    let callIdx = 0;
    const sequence = [
      JSON.stringify({ tier: 'economic' }),
      JSON.stringify({
        appliesToAction: 'craft',
        costs: { wood: 5 },
        scope: ['everyone', 'always'], // <— also wrong shape
      }),
    ];
    const llm: Llm = {
      async call() {
        return sequence[callIdx++]!;
      },
    };
    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'Crafting costs 5 wood');
    expect(rule.tier).toBe('economic');
    expect(rule.scope).toBeUndefined();
  });

  it('preserves scope when LLM correctly returns an object', async () => {
    let callIdx = 0;
    const sequence = [
      JSON.stringify({ tier: 'hard' }),
      JSON.stringify({
        predicate: 'cannot act while dead',
        check: 'character.alive',
        scope: { locationIds: ['loc_market'] }, // <— correct shape
      }),
    ];
    const llm: Llm = {
      async call() {
        return sequence[callIdx++]!;
      },
    };
    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', "Dead can't act in the market");
    expect(rule.scope).toEqual({ locationIds: ['loc_market'] });
  });
});
