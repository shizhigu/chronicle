/**
 * Hard-rule predicate DSL — behavioral tests.
 *
 * The DSL is load-bearing: if the compiler emits `character.energy >= 5` and we
 * can't evaluate it, the rule is silently ignored. These tests lock the grammar.
 */

import { describe, expect, it } from 'bun:test';
import {
  PredicateError,
  evaluatePredicate,
  evaluatePredicateSafe,
} from '../src/rules/predicate.js';

const ctx = {
  character: {
    id: 'agt_1',
    alive: true,
    energy: 73,
    mood: 'calm',
    role: 'admin',
    locationId: 'loc_kitchen',
    inventory: ['apple', 'bread', 'key'],
    traits: { boldness: 0.7, honesty: 0.3 },
  },
  action: {
    name: 'speak',
    args: {
      to: 'Alice',
      content: 'Hello there.',
      loud: false,
      destination: 'loc_garden',
    },
  },
  world: {
    currentTick: 42,
    atmosphere: 'tense',
  },
};

describe('predicate DSL — literals and paths', () => {
  it('reads dotted path', () => {
    expect(evaluatePredicate('character.alive', ctx)).toBe(true);
    expect(evaluatePredicate('character.mood', ctx)).toBe(true); // 'calm' is truthy
  });

  it('reads nested path', () => {
    expect(evaluatePredicate('character.traits.boldness > 0.5', ctx)).toBe(true);
    expect(evaluatePredicate('character.traits.honesty > 0.5', ctx)).toBe(false);
  });

  it('handles .length on string and array', () => {
    expect(evaluatePredicate('action.args.content.length > 0', ctx)).toBe(true);
    expect(evaluatePredicate('action.args.content.length < 5', ctx)).toBe(false);
    expect(evaluatePredicate('character.inventory.length == 3', ctx)).toBe(true);
  });

  it('handles bracket index and string key', () => {
    expect(evaluatePredicate('character.inventory[0] == "apple"', ctx)).toBe(true);
    expect(evaluatePredicate('character.inventory[2] == "key"', ctx)).toBe(true);
    expect(evaluatePredicate('character.traits["boldness"] > 0.5', ctx)).toBe(true);
  });

  it('returns false for paths hitting undefined', () => {
    expect(evaluatePredicate('character.nonexistent == null', ctx)).toBe(true);
    expect(evaluatePredicate('character.nonexistent.deep == "foo"', ctx)).toBe(false);
  });
});

describe('predicate DSL — comparisons', () => {
  it('numeric comparisons', () => {
    expect(evaluatePredicate('character.energy >= 5', ctx)).toBe(true);
    expect(evaluatePredicate('character.energy > 100', ctx)).toBe(false);
    expect(evaluatePredicate('character.energy <= 73', ctx)).toBe(true);
    expect(evaluatePredicate('character.energy < 73', ctx)).toBe(false);
  });

  it('string equality', () => {
    expect(evaluatePredicate('character.mood == "calm"', ctx)).toBe(true);
    expect(evaluatePredicate('character.mood != "enraged"', ctx)).toBe(true);
  });

  it('boolean literals', () => {
    expect(evaluatePredicate('character.alive == true', ctx)).toBe(true);
    expect(evaluatePredicate('action.args.loud == false', ctx)).toBe(true);
  });

  it('null comparison', () => {
    expect(evaluatePredicate('character.deathTick == null', ctx)).toBe(true);
  });
});

describe('predicate DSL — boolean logic', () => {
  it('&& short-circuits conjunction', () => {
    expect(evaluatePredicate('character.alive && character.energy >= 50', ctx)).toBe(true);
    expect(evaluatePredicate('character.alive && character.energy >= 200', ctx)).toBe(false);
  });

  it('|| short-circuits disjunction', () => {
    expect(evaluatePredicate('character.energy >= 200 || character.role == "admin"', ctx)).toBe(
      true,
    );
    expect(evaluatePredicate('character.energy >= 200 || character.role == "guest"', ctx)).toBe(
      false,
    );
  });

  it('! negation', () => {
    expect(evaluatePredicate('!character.alive', ctx)).toBe(false);
    expect(evaluatePredicate('!(character.mood == "enraged")', ctx)).toBe(true);
  });

  it('precedence: && binds tighter than ||', () => {
    // A || B && C  →  A || (B && C)
    expect(
      evaluatePredicate(
        'character.role == "guest" || character.alive && character.energy > 0',
        ctx,
      ),
    ).toBe(true);
  });

  it('parentheses group correctly', () => {
    expect(
      evaluatePredicate(
        '(character.role == "guest" || character.role == "admin") && character.alive',
        ctx,
      ),
    ).toBe(true);
  });
});

describe('predicate DSL — error handling', () => {
  it('throws PredicateError on unterminated string', () => {
    expect(() => evaluatePredicate('character.mood == "unterm', ctx)).toThrow(PredicateError);
  });

  it('throws on missing closing paren', () => {
    expect(() => evaluatePredicate('(character.alive && character.energy > 0', ctx)).toThrow(
      PredicateError,
    );
  });

  it('throws on trailing garbage', () => {
    expect(() => evaluatePredicate('character.alive )', ctx)).toThrow(PredicateError);
  });

  it('evaluatePredicateSafe returns fallback on error', () => {
    expect(evaluatePredicateSafe('bogus expression )(', ctx, true)).toBe(true);
    expect(evaluatePredicateSafe('bogus expression )(', ctx, false)).toBe(false);
  });
});

describe('predicate DSL — real-world compiled rules', () => {
  it('dinner-party "do not interrupt" as economic-gate', () => {
    // e.g. if tone is "shouted", this expression evaluates false → action gets blocked
    const expr = 'action.args.loud == false';
    expect(evaluatePredicate(expr, ctx)).toBe(true);
  });

  it('desert-island "must be alive to act"', () => {
    expect(evaluatePredicate('character.alive && character.energy >= 5', ctx)).toBe(true);
    expect(
      evaluatePredicate('character.alive && character.energy >= 5', {
        ...ctx,
        character: { ...ctx.character, alive: false },
      }),
    ).toBe(false);
  });

  it('social "admin override" disjunction', () => {
    const expr = '(character.role == "admin") || (character.alive && character.energy >= 100)';
    expect(evaluatePredicate(expr, ctx)).toBe(true);
  });

  it('startup-founders "message length cap"', () => {
    expect(evaluatePredicate('action.args.content.length <= 500', ctx)).toBe(true);
    expect(evaluatePredicate('action.args.content.length <= 5', ctx)).toBe(false);
  });
});
