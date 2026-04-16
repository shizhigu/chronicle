/**
 * CredentialPool — strategies + cooldown semantics.
 *
 * We exercise the pool with a deterministic `random` injection where
 * it matters, and an explicit `now` everywhere so tests never touch
 * the real clock.
 */

import { describe, expect, it } from 'bun:test';
import { CredentialPool, DEFAULT_COOLDOWN_MS } from '../src/credential-pool.js';

describe('CredentialPool — basic add / pick', () => {
  it('picks the sole key when only one is present', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'primary', value: 'sk-1' });
    const picked = pool.pickAvailable();
    expect(picked?.id).toBe('primary');
    expect(picked?.value).toBe('sk-1');
  });

  it('returns null when the pool is empty', () => {
    const pool = new CredentialPool();
    expect(pool.pickAvailable()).toBeNull();
    expect(pool.availableCount()).toBe(0);
  });

  it('adding the same id twice replaces rather than duplicating', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'work', value: 'sk-old' });
    pool.add({ id: 'work', value: 'sk-new' });
    expect(pool.snapshot()).toHaveLength(1);
    expect(pool.pickAvailable()?.value).toBe('sk-new');
  });
});

describe('round_robin strategy', () => {
  it('cycles through keys in insertion order', () => {
    const pool = new CredentialPool('round_robin');
    pool.add({ id: 'a', value: '1' });
    pool.add({ id: 'b', value: '2' });
    pool.add({ id: 'c', value: '3' });

    const picks = [
      pool.pickAvailable()?.id,
      pool.pickAvailable()?.id,
      pool.pickAvailable()?.id,
      pool.pickAvailable()?.id,
      pool.pickAvailable()?.id,
    ];
    // After one full lap, cursor wraps and starts the next lap.
    expect(picks).toEqual(['a', 'b', 'c', 'a', 'b']);
  });

  it('skips exhausted entries transparently', () => {
    const pool = new CredentialPool('round_robin');
    pool.add({ id: 'a', value: '1' });
    pool.add({ id: 'b', value: '2' });
    pool.add({ id: 'c', value: '3' });

    pool.markExhausted('b', Date.now() + 10_000); // cool down 10s
    const picks = [pool.pickAvailable()?.id, pool.pickAvailable()?.id, pool.pickAvailable()?.id];
    expect(picks).toEqual(['a', 'c', 'a']); // 'b' skipped
  });
});

describe('random strategy', () => {
  it('returns a pool member, uniform over 500 calls', () => {
    // Fixed seed would be cleaner but Math.random-driven is fine for
    // a statistical property test.
    const pool = new CredentialPool('random');
    pool.add({ id: 'a', value: '1' });
    pool.add({ id: 'b', value: '2' });
    pool.add({ id: 'c', value: '3' });

    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 500; i++) {
      const p = pool.pickAvailable();
      if (p) counts[p.id]!++;
    }
    // Each key should get between 100 and 230 picks (not a strict
    // uniform test, just a sanity floor/ceiling).
    for (const id of ['a', 'b', 'c']) {
      expect(counts[id]).toBeGreaterThan(100);
      expect(counts[id]).toBeLessThan(230);
    }
  });

  it('accepts an injected rng for deterministic tests', () => {
    let nth = 0;
    const seq = [0.0, 0.34, 0.99]; // will pick index 0, 1, 2
    const pool = new CredentialPool('random', () => seq[nth++ % seq.length]!);
    pool.add({ id: 'a', value: '1' });
    pool.add({ id: 'b', value: '2' });
    pool.add({ id: 'c', value: '3' });

    expect(pool.pickAvailable()?.id).toBe('a'); // floor(0 * 3) = 0
    expect(pool.pickAvailable()?.id).toBe('b'); // floor(0.34 * 3) = 1
    expect(pool.pickAvailable()?.id).toBe('c'); // floor(0.99 * 3) = 2
  });
});

describe('lru strategy', () => {
  it('tie-breaks untouched keys in insertion order (first one wins)', () => {
    // Three fresh keys with no usage history. The first pick must be
    // the first-inserted key — we rely on this for predictable startup
    // behavior when the pool was just built.
    const pool = new CredentialPool('lru');
    pool.add({ id: 'a', value: '1' });
    pool.add({ id: 'b', value: '2' });
    pool.add({ id: 'c', value: '3' });
    expect(pool.pickAvailable(1)?.id).toBe('a');
  });

  it('always picks the least-recently-used available key', () => {
    const pool = new CredentialPool('lru');
    pool.add({ id: 'a', value: '1' });
    pool.add({ id: 'b', value: '2' });
    pool.add({ id: 'c', value: '3' });

    // All untouched — lru picks the first encountered (implementation-defined but stable).
    const first = pool.pickAvailable(1000)!;
    const second = pool.pickAvailable(2000)!;
    const third = pool.pickAvailable(3000)!;

    // Three different keys should have been picked before any repeats.
    const ids = new Set([first.id, second.id, third.id]);
    expect(ids.size).toBe(3);

    // Fourth pick should be the one touched earliest, which was 'first' at t=1000.
    const fourth = pool.pickAvailable(4000)!;
    expect(fourth.id).toBe(first.id);
  });
});

describe('markExhausted cooldowns', () => {
  it('default cooldown is 1 hour (anchored to the supplied `now`)', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'a', value: '1' });
    const start = 1_000_000;
    pool.markExhausted('a', undefined, start);
    const snap = pool.snapshot();
    expect(snap[0]?.cooldownUntil).toBe(start + DEFAULT_COOLDOWN_MS);
    // Within the cooldown window — unavailable.
    expect(pool.availableCount(start + DEFAULT_COOLDOWN_MS / 2)).toBe(0);
    // Past the cooldown — available again.
    expect(pool.availableCount(start + DEFAULT_COOLDOWN_MS + 1)).toBe(1);
  });

  it('honours a caller-supplied cooldown until', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'a', value: '1' });
    const cooldownUntil = 5000;
    pool.markExhausted('a', cooldownUntil);

    expect(pool.pickAvailable(4000)).toBeNull();
    expect(pool.pickAvailable(6000)?.id).toBe('a');
  });

  it('cooldown expiry transparently restores the key to ok', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'a', value: '1' });
    pool.markExhausted('a', 100);

    // Before expiry — unavailable.
    expect(pool.pickAvailable(50)).toBeNull();
    // After expiry — the pick succeeds AND the snapshot goes back to ok.
    expect(pool.pickAvailable(200)?.id).toBe('a');
    expect(pool.snapshot()[0]?.status).toBe('ok');
  });
});

describe('markAuthFailed is permanent', () => {
  it('never returns to ok even after a long wait', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'a', value: '1' });
    pool.add({ id: 'b', value: '2' });
    pool.markAuthFailed('a');

    // a is dead; only b is available regardless of time.
    expect(pool.pickAvailable(1_000_000)?.id).toBe('b');
    expect(pool.pickAvailable(1_000_000_000)?.id).toBe('b');
    expect(pool.snapshot().find((s) => s.id === 'a')?.status).toBe('auth_failed');
  });

  it('auth_failed wins over a subsequent markExhausted (cannot downgrade severity)', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'a', value: '1' });
    pool.markAuthFailed('a');
    pool.markExhausted('a'); // no-op on auth_failed
    expect(pool.snapshot()[0]?.status).toBe('auth_failed');
  });
});

describe('all exhausted / all failed', () => {
  it('returns null when every key is unavailable', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'a', value: '1' });
    pool.add({ id: 'b', value: '2' });
    pool.markAuthFailed('a');
    pool.markExhausted('b', Number.POSITIVE_INFINITY); // effectively forever
    expect(pool.pickAvailable()).toBeNull();
  });
});

describe('snapshot', () => {
  it('reflects status + timestamps for diagnostics', () => {
    const pool = new CredentialPool();
    pool.add({ id: 'a', value: '1', metadata: { label: 'work' } });
    pool.add({ id: 'b', value: '2' });
    pool.pickAvailable(1000);
    pool.markAuthFailed('b');

    const snap = pool.snapshot();
    const a = snap.find((s) => s.id === 'a');
    const b = snap.find((s) => s.id === 'b');
    expect(a?.status).toBe('ok');
    expect(a?.lastUsedAt).toBe(1000);
    expect(b?.status).toBe('auth_failed');
  });
});
