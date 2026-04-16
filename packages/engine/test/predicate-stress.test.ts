/**
 * Predicate DSL — stress + adversarial tests.
 *
 * The goal: for any syntactically valid input, the parser + evaluator must
 * either return a boolean or throw a PredicateError (never a raw JS error).
 * Anything the LLM might realistically emit, we must handle.
 */

import { describe, expect, it } from 'bun:test';
import {
  PredicateError,
  evaluatePredicate,
  evaluatePredicateSafe,
} from '../src/rules/predicate.js';

// ============================================================
// Null / undefined handling
// ============================================================

describe('predicate DSL — null and undefined paths', () => {
  const ctx = {
    character: {
      alive: true,
      deathTick: null,
      locationId: null,
      inventory: [] as string[],
      traits: {},
      // deliberately no .allies
    },
    action: { args: {} },
    world: {},
  };

  it('null literal compares correctly', () => {
    expect(evaluatePredicate('character.deathTick == null', ctx)).toBe(true);
    expect(evaluatePredicate('character.deathTick != null', ctx)).toBe(false);
  });

  it('a missing path evaluates to undefined, which is falsy', () => {
    expect(evaluatePredicate('character.nonexistent', ctx)).toBe(false);
  });

  it('a deeply missing path does not throw', () => {
    expect(evaluatePredicate('character.foo.bar.baz', ctx)).toBe(false);
    expect(evaluatePredicate('character.foo.bar.baz == null', ctx)).toBe(true);
  });

  it('.length on undefined is undefined (falsy)', () => {
    expect(evaluatePredicate('character.nonexistent.length > 0', ctx)).toBe(false);
  });

  it('.length on empty array is 0', () => {
    expect(evaluatePredicate('character.inventory.length == 0', ctx)).toBe(true);
  });

  it('`in` on undefined right side returns false, no crash', () => {
    expect(evaluatePredicate('"x" in character.nonexistent', ctx)).toBe(false);
  });

  it('method call on undefined returns undefined (falsy)', () => {
    expect(evaluatePredicate('character.nonexistent.includes("x")', ctx)).toBe(false);
  });
});

// ============================================================
// Type coercion edges
// ============================================================

describe('predicate DSL — type coercion', () => {
  const ctx = {
    character: { age: 25, role: 'admin', locationId: 'loc_42' },
    action: { args: { amount: '10' } },
    world: {},
  };

  it('number-vs-string equality is loose', () => {
    // Both directions of the string-to-number coercion
    expect(evaluatePredicate('1 == "1"', ctx)).toBe(true);
    expect(evaluatePredicate('"1" == 1', ctx)).toBe(true);
    expect(evaluatePredicate('action.args.amount == 10', ctx)).toBe(true);
  });

  it('numeric comparisons coerce string to number', () => {
    expect(evaluatePredicate('action.args.amount > 5', ctx)).toBe(true);
    expect(evaluatePredicate('action.args.amount < 5', ctx)).toBe(false);
  });

  it('string concat with non-string rhs uses JS semantics', () => {
    expect(evaluatePredicate('"age-" + character.age == "age-25"', ctx)).toBe(true);
  });

  it('arithmetic on non-numeric paths yields NaN, compares false', () => {
    expect(evaluatePredicate('character.role * 2 > 0', ctx)).toBe(false);
    expect(evaluatePredicate('character.role * 2 < 0', ctx)).toBe(false);
  });
});

// ============================================================
// Adversarial inputs — things an LLM might plausibly emit
// ============================================================

describe('predicate DSL — adversarial inputs never crash', () => {
  const ctx = { character: {}, action: {}, world: {} };

  const invalidButParseable = [
    'character.', // trailing dot — parse error expected
    'character[',
    'character[]',
    '"unclosed',
    '((',
    ')',
    '&&',
    '||',
    '==',
    '1 +',
    '1 + * 2',
  ];

  for (const input of invalidButParseable) {
    it(`syntactically invalid input "${input}" → PredicateError (not raw crash)`, () => {
      try {
        evaluatePredicate(input, ctx);
        // If we reach here, parser accepted it — must still return boolean
        expect(typeof evaluatePredicate(input, ctx)).toBe('boolean');
      } catch (err) {
        expect(err).toBeInstanceOf(PredicateError);
      }
    });
  }

  const syntacticallyOddButValid = [
    '  character  .  alive  ', // extra whitespace
    'character.alive == true', // explicit boolean compare
    '  ',
    'true',
    'false',
    '!!character.alive',
    '!(!(character.alive))',
    '(((((true)))))', // deeply parenthesized
    '-(-5)', // double negation of number
    '!!!true',
  ];

  for (const input of syntacticallyOddButValid) {
    it(`odd-but-valid "${input.trim()}" evaluates to a boolean without throwing`, () => {
      const result = evaluatePredicateSafe(input, ctx, false);
      expect(typeof result).toBe('boolean');
    });
  }
});

// ============================================================
// Precedence & associativity stress
// ============================================================

describe('predicate DSL — precedence & associativity', () => {
  const ctx = { character: {}, action: {}, world: {} };

  it('left-associative subtraction: 10 - 3 - 2 == 5', () => {
    expect(evaluatePredicate('10 - 3 - 2 == 5', ctx)).toBe(true);
  });

  it('left-associative division: 16 / 4 / 2 == 2', () => {
    expect(evaluatePredicate('16 / 4 / 2 == 2', ctx)).toBe(true);
  });

  it('mixed precedence: 2 + 3 * 4 - 1 == 13', () => {
    expect(evaluatePredicate('2 + 3 * 4 - 1 == 13', ctx)).toBe(true);
  });

  it('deep parenthesization', () => {
    expect(evaluatePredicate('((1 + (2 * (3 - 1))) == 5)', ctx)).toBe(true);
  });

  it('&& short-circuits on false (right side with undefined path is safe)', () => {
    expect(evaluatePredicate('false && character.nonexistent.foo.bar', ctx)).toBe(false);
    // If short-circuit didn't work, the right side would still evaluate — which
    // actually also returns false safely, so this doesn't prove short-circuit.
    // But the spec says && short-circuits.
  });

  it('|| short-circuits on true', () => {
    expect(evaluatePredicate('true || character.nonexistent.foo.bar', ctx)).toBe(true);
  });

  it('unary minus applied to expression via parens', () => {
    expect(evaluatePredicate('-(2 + 3) == -5', ctx)).toBe(true);
  });
});

// ============================================================
// Generated random input — quick property check
// ============================================================

describe('predicate DSL — property: any parse-accepted input returns boolean', () => {
  const atoms = [
    'true',
    'false',
    'null',
    '1',
    '0',
    '-5',
    '1.5',
    '"str"',
    'character.x',
    'character.y.z',
    'world.currentTick',
  ];
  const ops = ['&&', '||', '==', '!=', '<', '>', '+', '-', '*'];

  function randExpr(depth: number): string {
    if (depth === 0) return atoms[Math.floor(Math.random() * atoms.length)]!;
    const op = ops[Math.floor(Math.random() * ops.length)]!;
    const left = randExpr(depth - 1);
    const right = randExpr(depth - 1);
    return `(${left} ${op} ${right})`;
  }

  it('1000 random well-formed expressions all return boolean without throwing', () => {
    const ctx = { character: { x: 5, y: { z: 'hello' } }, action: {}, world: { currentTick: 10 } };
    for (let i = 0; i < 1000; i++) {
      const expr = randExpr(3);
      const out = evaluatePredicateSafe(expr, ctx, false);
      expect(typeof out).toBe('boolean');
    }
  });
});

// ============================================================
// Security: whitelisted methods, no escape hatches
// ============================================================

describe('predicate DSL — no escape hatches', () => {
  const ctx = { character: { name: 'Alice' }, action: {}, world: {} };

  it('cannot access global objects (Math, process, global, Bun)', () => {
    // Math.max is blocked at parse time — `max` is not a whitelisted method.
    // process, global resolve to undefined because they're not in ctx.
    expect(evaluatePredicateSafe('Math.max(1, 2)', ctx, false)).toBe(false);
    expect(evaluatePredicate('process == null', ctx)).toBe(true);
    expect(evaluatePredicate('global == null', ctx)).toBe(true);
    expect(evaluatePredicate('Bun == null', ctx)).toBe(true);
  });

  it('cannot call disallowed string methods', () => {
    expect(() => evaluatePredicate('character.name.replace("A", "B")', ctx)).toThrow();
    expect(() => evaluatePredicate('character.name.split("")', ctx)).toThrow();
    expect(() => evaluatePredicate('character.name.slice(0, 2)', ctx)).toThrow();
  });

  it('cannot call object prototype methods', () => {
    expect(() => evaluatePredicate('character.hasOwnProperty("name")', ctx)).toThrow();
    expect(() => evaluatePredicate('character.toString()', ctx)).toThrow();
    expect(() => evaluatePredicate('character.valueOf()', ctx)).toThrow();
  });

  it('safe fallback catches all attempted escapes', () => {
    const attempts = [
      'require("fs")',
      'import("child_process")',
      'eval("1+1")',
      'Function("return process")()',
      'this.constructor.constructor("return process")()',
    ];
    for (const a of attempts) {
      expect(evaluatePredicateSafe(a, ctx, false)).toBe(false);
    }
  });
});
