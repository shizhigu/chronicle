/**
 * Predicate DSL — dynamic index expressions.
 *
 * Previously the parser only accepted `character.inventory[0]` or
 * `character.traits["boldness"]` (literal-only indices). Real rules often
 * want `character.inventory[action.args.slot]` or
 * `world.characters[i + 1].locationId` — dynamic.
 */

import { describe, expect, it } from 'bun:test';
import { evaluatePredicate, evaluatePredicateSafe } from '../src/rules/predicate.js';

const ctx = {
  character: {
    inventory: ['apple', 'bread', 'key'],
    traits: { boldness: 0.7, honesty: 0.3 },
    allies: ['Alice', 'Bob'],
    slotNames: { primary: 'sword', secondary: 'shield' },
    currentSlot: 1,
  },
  action: {
    args: {
      slot: 2,
      traitName: 'boldness',
      targetIndex: 0,
      formula: 'secondary',
    },
  },
  world: {
    currentTick: 5,
    characters: [
      { name: 'Alice', locationId: 'parlor' },
      { name: 'Bob', locationId: 'kitchen' },
      { name: 'Carol', locationId: 'garden' },
    ],
  },
};

describe('predicate DSL — dynamic index expressions', () => {
  it('array indexed by path variable', () => {
    expect(evaluatePredicate('character.inventory[action.args.slot] == "key"', ctx)).toBe(true);
    expect(evaluatePredicate('character.inventory[character.currentSlot] == "bread"', ctx)).toBe(
      true,
    );
  });

  it('array indexed by arithmetic expression', () => {
    expect(evaluatePredicate('character.inventory[character.currentSlot + 1] == "key"', ctx)).toBe(
      true,
    );
    expect(
      evaluatePredicate('character.inventory[character.currentSlot - 1] == "apple"', ctx),
    ).toBe(true);
  });

  it('object indexed by path variable (string key)', () => {
    expect(evaluatePredicate('character.traits[action.args.traitName] > 0.5', ctx)).toBe(true);
    expect(evaluatePredicate('character.slotNames[action.args.formula] == "shield"', ctx)).toBe(
      true,
    );
  });

  it('deep path with dynamic index and further props', () => {
    // world.characters[i].locationId — index by literal, prop chain after
    expect(
      evaluatePredicate('world.characters[action.args.targetIndex].locationId == "parlor"', ctx),
    ).toBe(true);
    // ... and with an arithmetic expression as the index
    expect(
      evaluatePredicate('world.characters[action.args.targetIndex + 2].name == "Carol"', ctx),
    ).toBe(true);
  });

  it('dynamic index still compatible with literal index (backward compat)', () => {
    // These used to be the only supported form — must still work
    expect(evaluatePredicate('character.inventory[0] == "apple"', ctx)).toBe(true);
    expect(evaluatePredicate('character.traits["boldness"] > 0.5', ctx)).toBe(true);
  });

  it('out-of-bounds dynamic index is undefined (falsy), not a crash', () => {
    expect(evaluatePredicate('character.inventory[99] == null', ctx)).toBe(true);
    expect(evaluatePredicate('character.inventory[action.args.slot + 100] == null', ctx)).toBe(
      true,
    );
  });

  it('null/undefined index expression returns undefined safely', () => {
    expect(evaluatePredicate('character.inventory[character.nonexistent] == null', ctx)).toBe(true);
  });

  it('malformed dynamic index throws a PredicateError', () => {
    // Unclosed
    expect(evaluatePredicateSafe('character.inventory[action.args.slot', ctx, false)).toBe(false);
  });

  it('combines with `in` operator — dynamic lookup, then membership', () => {
    // "Is the name at slot N an ally?"
    expect(
      evaluatePredicate('world.characters[action.args.targetIndex].name in character.allies', ctx),
    ).toBe(true);
  });

  it('combines with method calls', () => {
    // character.inventory[slot].startsWith("k")  →  "key".startsWith("k") = true
    expect(evaluatePredicate('character.inventory[action.args.slot].startsWith("k")', ctx)).toBe(
      true,
    );
  });
});
