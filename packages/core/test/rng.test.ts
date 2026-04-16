import { describe, expect, it } from 'bun:test';
import { createRng } from '../src/rng.js';

describe('createRng', () => {
  it('same seed → same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds → different sequences', () => {
    const a = createRng(42);
    const b = createRng(43);
    let differ = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() !== b.next()) differ++;
    }
    expect(differ).toBeGreaterThan(50);
  });

  it('nextInt is in [min, max)', () => {
    const rng = createRng(0);
    for (let i = 0; i < 1000; i++) {
      const n = rng.nextInt(3, 8);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThan(8);
    }
  });

  it('shuffle preserves elements', () => {
    const rng = createRng(7);
    const arr = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(arr);
    expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(arr).toEqual([1, 2, 3, 4, 5]); // original untouched
  });

  it('pick returns an element', () => {
    const rng = createRng(1);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 30; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });
});
