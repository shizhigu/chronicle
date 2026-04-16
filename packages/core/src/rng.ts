/**
 * Seeded RNG — reproducibility across simulation runs.
 *
 * Each world stores its rngSeed. Using the same seed with the same events
 * should produce the same outcome (mostly — LLM non-determinism is still a
 * thing, but we pin temperature and use prompt-caching to minimize drift).
 */

/**
 * mulberry32 — simple 32-bit PRNG, fast and good enough for simulation.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(minInclusive: number, maxExclusive: number): number {
      return Math.floor(this.next() * (maxExclusive - minInclusive)) + minInclusive;
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[this.nextInt(0, arr.length)]!;
    },
    shuffle<T>(arr: T[]): T[] {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.nextInt(0, i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    },
  };
}

export interface Rng {
  next(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}
