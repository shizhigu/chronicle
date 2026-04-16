/**
 * Expanded predicate DSL — arithmetic, `in`, method calls, unary minus.
 * These lock the v0.2 grammar that closes real-world rule gaps.
 */

import { describe, expect, it } from 'bun:test';
import { evaluatePredicate, evaluatePredicateSafe } from '../src/rules/predicate.js';

const ctx = {
  character: {
    id: 'agt_1',
    alive: true,
    energy: 73,
    mood: 'Calm',
    role: 'admin',
    roles: ['admin', 'moderator'],
    allies: ['Alice', 'Bob'],
    inventory: ['apple', 'bread', 'key'],
    traits: { boldness: 0.7 },
    name: 'Marcus',
  },
  action: {
    name: 'speak',
    cost: 5,
    args: {
      to: 'Alice',
      content: '@Alice have you seen the secret?',
      target: 'Bob',
      item: 'dagger',
      amount: 7,
    },
  },
  world: {
    currentTick: 42,
    population: 10,
    forbidden: ['password', 'secret'],
  },
};

describe('predicate DSL v2 — arithmetic', () => {
  it('addition', () => {
    expect(evaluatePredicate('character.energy + 10 > 80', ctx)).toBe(true);
    expect(evaluatePredicate('character.energy + 10 > 90', ctx)).toBe(false);
  });

  it('subtraction — most common: remaining-budget check', () => {
    expect(evaluatePredicate('character.energy - action.cost >= 0', ctx)).toBe(true);
    expect(evaluatePredicate('character.energy - 100 >= 0', ctx)).toBe(false);
  });

  it('multiplication', () => {
    expect(evaluatePredicate('action.args.amount * 2 == 14', ctx)).toBe(true);
  });

  it('division', () => {
    expect(evaluatePredicate('world.population / 2 == 5', ctx)).toBe(true);
  });

  it('modulo', () => {
    expect(evaluatePredicate('world.currentTick % 2 == 0', ctx)).toBe(true);
    expect(evaluatePredicate('world.currentTick % 3 == 0', ctx)).toBe(true); // 42 % 3 = 0
  });

  it('division by zero yields NaN, which is falsy in comparisons', () => {
    expect(evaluatePredicate('10 / 0 > 0', ctx)).toBe(false);
    expect(evaluatePredicate('10 / 0 < 0', ctx)).toBe(false);
  });

  it('precedence: multiplication before addition', () => {
    // 2 + 3 * 4 = 14 (not 20)
    expect(evaluatePredicate('2 + 3 * 4 == 14', ctx)).toBe(true);
  });

  it('parentheses override precedence', () => {
    expect(evaluatePredicate('(2 + 3) * 4 == 20', ctx)).toBe(true);
  });

  it('unary minus on literal', () => {
    expect(evaluatePredicate('-5 < 0', ctx)).toBe(true);
    expect(evaluatePredicate('character.energy >= -10', ctx)).toBe(true);
  });

  it('unary minus on path', () => {
    expect(evaluatePredicate('-character.energy < 0', ctx)).toBe(true);
  });

  it('string concatenation with +', () => {
    expect(
      evaluatePredicate('character.name + " the " + character.role == "Marcus the admin"', ctx),
    ).toBe(true);
  });
});

describe('predicate DSL v2 — `in` operator', () => {
  it('value in array', () => {
    expect(evaluatePredicate('"admin" in character.roles', ctx)).toBe(true);
    expect(evaluatePredicate('"guest" in character.roles', ctx)).toBe(false);
  });

  it('target in ally list', () => {
    expect(evaluatePredicate('action.args.target in character.allies', ctx)).toBe(true);
    expect(evaluatePredicate('"Enemy" in character.allies', ctx)).toBe(false);
  });

  it('combine with not', () => {
    expect(evaluatePredicate('!(action.args.item in character.inventory)', ctx)).toBe(true);
    expect(evaluatePredicate('!("apple" in character.inventory)', ctx)).toBe(false);
  });

  it('substring in a string', () => {
    expect(evaluatePredicate('"secret" in action.args.content', ctx)).toBe(true);
    expect(evaluatePredicate('"nuke" in action.args.content', ctx)).toBe(false);
  });

  it('works with compound boolean', () => {
    expect(
      evaluatePredicate('"admin" in character.roles || "moderator" in character.roles', ctx),
    ).toBe(true);
  });
});

describe('predicate DSL v2 — method calls', () => {
  it('startsWith', () => {
    expect(evaluatePredicate('action.args.content.startsWith("@")', ctx)).toBe(true);
    expect(evaluatePredicate('action.args.content.startsWith("#")', ctx)).toBe(false);
  });

  it('endsWith', () => {
    expect(evaluatePredicate('action.args.content.endsWith("?")', ctx)).toBe(true);
  });

  it('includes on string', () => {
    expect(evaluatePredicate('action.args.content.includes("secret")', ctx)).toBe(true);
    expect(evaluatePredicate('!action.args.content.includes("nuke")', ctx)).toBe(true);
  });

  it('includes on array', () => {
    expect(evaluatePredicate('character.roles.includes("admin")', ctx)).toBe(true);
    expect(evaluatePredicate('character.inventory.includes("sword")', ctx)).toBe(false);
  });

  it('toLowerCase for case-insensitive match', () => {
    expect(evaluatePredicate('character.mood.toLowerCase() == "calm"', ctx)).toBe(true);
  });

  it('chained methods', () => {
    expect(evaluatePredicate('"  HELLO  ".trim().toLowerCase() == "hello"', ctx)).toBe(true);
  });

  it('disallowed methods throw', () => {
    expect(() => evaluatePredicate('action.args.content.fetch()', ctx)).toThrow();
    expect(() => evaluatePredicate('character.toString()', ctx)).toThrow();
  });

  it('evaluatePredicateSafe contains a disallowed method → fallback', () => {
    expect(evaluatePredicateSafe('character.constructor()', ctx, false)).toBe(false);
  });
});

describe('predicate DSL v2 — real-world compiled rules', () => {
  it('"target must be an ally"', () => {
    expect(evaluatePredicate('action.args.target in character.allies', ctx)).toBe(true);
  });

  it('"no forbidden words in speech"', () => {
    // `forbidden` is an array; we want: none of them appear in the content
    // Compiler would emit: !(action.args.content.includes(world.forbidden[0]) || ...).
    // Using just the first forbidden word here:
    expect(evaluatePredicate('!action.args.content.includes("password")', ctx)).toBe(true);
    expect(evaluatePredicate('!action.args.content.includes("secret")', ctx)).toBe(false);
  });

  it('"remaining energy after action ≥ 0"', () => {
    expect(evaluatePredicate('character.energy - action.cost >= 0', ctx)).toBe(true);
  });

  it('"only @-mentions allowed"', () => {
    expect(evaluatePredicate('action.args.content.startsWith("@")', ctx)).toBe(true);
  });

  it('"@ of known ally"', () => {
    // Strip the @ and check membership — grammar can compose via arithmetic on strings
    // Example uses a literal after stripping, which real compilation would compute
    // but we test the structural primitives here
    expect(evaluatePredicate('"@Alice" == "@" + "Alice"', ctx)).toBe(true);
  });

  it('"vote threshold: ≥ half the population"', () => {
    expect(evaluatePredicate('action.args.amount >= world.population / 2', ctx)).toBe(true);
  });
});

describe('predicate DSL v2 — precedence preservation', () => {
  it('arithmetic binds tighter than comparison', () => {
    // 3 + 4 > 5 → 7 > 5 → true
    expect(evaluatePredicate('3 + 4 > 5', ctx)).toBe(true);
  });

  it('comparison binds tighter than `in`', () => {
    // Without parens: `1 + 1 == 2 in [...]` is weird, but we expect `(1+1==2) in [...]`
    // which doesn't make type sense — still shouldn't crash
    expect(() => evaluatePredicateSafe('1 == 1 in character.roles', ctx)).not.toThrow();
  });

  it('unary minus binds tighter than multiplication', () => {
    // -2 * 3 = -6
    expect(evaluatePredicate('-2 * 3 == -6', ctx)).toBe(true);
  });

  it('method call chains through indexing', () => {
    // character.inventory[0].toUpperCase() == "APPLE"
    expect(evaluatePredicate('character.inventory[0].toUpperCase() == "APPLE"', ctx)).toBe(true);
  });
});
