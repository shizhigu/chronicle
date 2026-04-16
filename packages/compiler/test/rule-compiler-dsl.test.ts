/**
 * Rule compiler DSL validation — guarantees the hardCheck string we put in
 * the DB is always parseable by the runtime predicate DSL.
 *
 * Uses a mock LLM so we can script responses that exercise:
 *   - happy path: valid DSL passes through
 *   - unparseable on first try → retry succeeds
 *   - unparseable even on retry → fallback to safe default + compilerNotes
 */

import { describe, expect, it } from 'bun:test';
import { evaluatePredicate } from '@chronicle/engine';
import type { Llm } from '../src/llm.js';
import { RuleCompiler } from '../src/rule-compiler.js';

function sequencedLlm(seq: string[]): Llm {
  let i = 0;
  return {
    async call(): Promise<string> {
      return seq[i++] ?? '{}';
    },
  };
}

describe('RuleCompiler DSL validation', () => {
  it('stores a valid DSL expression as-is', async () => {
    const llm = sequencedLlm([
      JSON.stringify({ tier: 'hard' }),
      JSON.stringify({
        predicate: 'must be alive',
        check: 'character.alive && character.energy >= 5',
        onViolation: 'reject',
      }),
    ]);
    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'Must be alive with energy.');
    expect(rule.hardCheck).toBe('character.alive && character.energy >= 5');
    expect(rule.compilerNotes).toBeNull();

    // And the DSL really parses it
    expect(() =>
      evaluatePredicate(rule.hardCheck!, {
        character: { alive: true, energy: 10 },
        action: {},
        world: {},
      }),
    ).not.toThrow();
  });

  it('accepts an expression using v2 grammar (in, methods, arithmetic)', async () => {
    const llm = sequencedLlm([
      JSON.stringify({ tier: 'hard' }),
      JSON.stringify({
        predicate: 'no secret mentions + target is ally',
        check: 'action.args.target in character.allies && !action.args.content.includes("secret")',
        onViolation: 'reject',
      }),
    ]);
    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'Target must be an ally and no secrets.');
    expect(rule.hardCheck).toContain('in character.allies');
    expect(rule.hardCheck).toContain('.includes(');
  });

  it('retries when the LLM emits a malformed DSL', async () => {
    const llm = sequencedLlm([
      // classify
      JSON.stringify({ tier: 'hard' }),
      // first parse — invalid DSL (dangling operator)
      JSON.stringify({
        predicate: 'tries to check something',
        check: 'character.energy >=',
        onViolation: 'reject',
      }),
      // retry — corrected
      JSON.stringify({
        predicate: 'min energy',
        check: 'character.energy >= 5',
        onViolation: 'reject',
      }),
    ]);
    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'Energy check.');
    expect(rule.hardCheck).toBe('character.energy >= 5');
    expect(rule.compilerNotes).toBeNull();
  });

  it('falls back to "character.alive" if retry also fails', async () => {
    const bogus = JSON.stringify({
      predicate: 'still broken',
      check: 'character.@@@invalid',
      onViolation: 'reject',
    });
    const llm = sequencedLlm([
      JSON.stringify({ tier: 'hard' }),
      bogus,
      bogus, // retry also bad
    ]);
    const compiler = new RuleCompiler({ llm });
    const rule = await compiler.compileOne('chr_test', 'Broken rule.');
    expect(rule.hardCheck).toBe('character.alive');
    expect(rule.compilerNotes).toContain('dsl_unparseable_fallback');
  });

  it('invariant: the stored hardCheck is always parseable by the runtime DSL', async () => {
    // Cross-check: for a range of nasty-but-legal rule descriptions, the rule
    // that comes out of the compiler always evaluates.
    const cases = [
      {
        classify: { tier: 'hard' },
        parse: {
          predicate: 'admin override',
          check: 'character.role == "admin" || character.energy >= 100',
          onViolation: 'reject',
        },
      },
      {
        classify: { tier: 'hard' },
        parse: {
          predicate: 'half the population votes',
          check: 'action.args.amount >= world.population / 2',
          onViolation: 'reject',
        },
      },
      {
        classify: { tier: 'hard' },
        parse: {
          predicate: 'case-insensitive mood gate',
          check: 'character.mood.toLowerCase() != "enraged"',
          onViolation: 'reject',
        },
      },
    ];

    for (const tc of cases) {
      const llm = sequencedLlm([JSON.stringify(tc.classify), JSON.stringify(tc.parse)]);
      const compiler = new RuleCompiler({ llm });
      const rule = await compiler.compileOne('chr_test', tc.parse.predicate);
      expect(() =>
        evaluatePredicate(rule.hardCheck!, {
          character: { alive: true, energy: 100, role: 'admin', mood: 'Calm' },
          action: { args: { amount: 10 } },
          world: { population: 20 },
        }),
      ).not.toThrow();
    }
  });
});
