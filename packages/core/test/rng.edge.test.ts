/**
 * Tighter RNG properties — edge cases and statistical sanity.
 */

import { describe, expect, it } from 'bun:test';
import { createRng } from '../src/rng.js';

describe('createRng — edge cases', () => {
  it('next() returns values in [0, 1)', () => {
    const rng = createRng(123);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt with equal bounds returns the single value', () => {
    const rng = createRng(1);
    for (let i = 0; i < 10; i++) {
      expect(rng.nextInt(5, 6)).toBe(5);
    }
  });

  it('shuffle of an empty array is an empty array', () => {
    const rng = createRng(0);
    expect(rng.shuffle([])).toEqual([]);
  });

  it('shuffle of a single-element array returns that element', () => {
    const rng = createRng(0);
    expect(rng.shuffle([7])).toEqual([7]);
  });

  it('pick from a single-element array always returns that element', () => {
    const rng = createRng(99);
    for (let i = 0; i < 20; i++) {
      expect(rng.pick([42])).toBe(42);
    }
  });

  it('roughly uniform distribution on nextInt', () => {
    const rng = createRng(2024);
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 10_000; i++) {
      counts[rng.nextInt(0, 10)]!++;
    }
    for (const c of counts) {
      // Each bucket should be within 25% of the expected 1000
      expect(c).toBeGreaterThan(700);
      expect(c).toBeLessThan(1300);
    }
  });

  it('determinism survives intermixed calls', () => {
    const a = createRng(5);
    const b = createRng(5);
    for (let i = 0; i < 50; i++) {
      expect(a.nextInt(0, 100)).toBe(b.nextInt(0, 100));
      expect(a.pick([1, 2, 3, 4, 5])).toBe(b.pick([1, 2, 3, 4, 5]));
    }
  });
});
