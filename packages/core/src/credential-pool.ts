/**
 * CredentialPool — multi-key selection + cooldown tracking.
 *
 * See ADR-0014. Chronicle v1 uses this only at CLI startup to pick
 * one key from a pool and inject it into the provider's env var.
 * Runtime failover is future work (needs pi-agent cooperation).
 *
 * Pure in-memory state — the pool does not read or write files.
 * Persistence is the caller's responsibility (hydrate-env doesn't
 * persist; a long-running engine could).
 */

export interface PoolKey {
  /** Stable identifier used in logs + lru tracking. Must be unique within a pool. */
  id: string;
  /** The secret itself. */
  value: string;
  /** Optional user-supplied metadata (label, tier, etc.). */
  metadata?: Record<string, unknown>;
}

export type PoolStrategy = 'round_robin' | 'random' | 'lru';

export type KeyStatus = 'ok' | 'exhausted' | 'auth_failed';

export interface KeySnapshot {
  id: string;
  status: KeyStatus;
  /** ms-since-epoch; only set when status='exhausted' with a finite cooldown. */
  cooldownUntil?: number;
  /** ms-since-epoch; set on the first successful `pickAvailable` match. */
  lastUsedAt?: number;
}

interface KeyState extends PoolKey {
  status: KeyStatus;
  cooldownUntil: number | null;
  lastUsedAt: number | null;
}

/** Default cooldown when a caller doesn't specify one (matches hermes-agent). */
export const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export class CredentialPool {
  private readonly keys: KeyState[] = [];
  /** Round-robin cursor. Advances past unavailable keys naturally. */
  private rrCursor = 0;

  constructor(
    private readonly strategy: PoolStrategy = 'round_robin',
    private readonly random: () => number = Math.random,
  ) {}

  /** Add a key. Duplicate ids replace the existing entry's metadata + reset status. */
  add(key: PoolKey): void {
    const existing = this.keys.findIndex((k) => k.id === key.id);
    const fresh: KeyState = {
      ...key,
      status: 'ok',
      cooldownUntil: null,
      lastUsedAt: null,
    };
    if (existing >= 0) this.keys[existing] = fresh;
    else this.keys.push(fresh);
  }

  /** Number of keys currently available (not exhausted or auth-failed). */
  availableCount(now: number = Date.now()): number {
    return this.keys.filter((k) => this.isAvailable(k, now)).length;
  }

  /**
   * Select a key per the pool's strategy. Returns `null` if every key
   * is exhausted or auth-failed. Callers that hit null should back off
   * (or surface to the user as "all credentials unavailable").
   *
   * The returned key's `lastUsedAt` is stamped — subsequent lru calls
   * will skip it in favor of less-recently-used peers.
   */
  pickAvailable(now: number = Date.now()): PoolKey | null {
    const available = this.keys.filter((k) => this.isAvailable(k, now));
    if (available.length === 0) return null;

    let picked: KeyState;
    switch (this.strategy) {
      case 'random':
        picked = available[Math.floor(this.random() * available.length)]!;
        break;
      case 'lru':
        picked = available.reduce((best, cur) => {
          // Untouched keys (lastUsedAt=null) count as "least recently
          // used" and win ties — but the FIRST untouched key wins, not
          // the last encountered. We check `best` first so a tie
          // between two untouched keys keeps the earlier one.
          if (best.lastUsedAt === null) return best;
          if (cur.lastUsedAt === null) return cur;
          return cur.lastUsedAt < best.lastUsedAt ? cur : best;
        });
        break;
      default: {
        // round_robin: walk from the cursor through the full list,
        // skipping unavailable entries. Guaranteed to terminate
        // because we already checked `available.length > 0`.
        for (let step = 0; step < this.keys.length; step++) {
          const idx = (this.rrCursor + step) % this.keys.length;
          const candidate = this.keys[idx]!;
          if (this.isAvailable(candidate, now)) {
            picked = candidate;
            this.rrCursor = (idx + 1) % this.keys.length;
            break;
          }
        }
        // biome-ignore lint/style/noNonNullAssertion: the loop always assigns picked
        picked = picked!;
      }
    }

    picked.lastUsedAt = now;
    return { id: picked.id, value: picked.value, metadata: picked.metadata };
  }

  /**
   * Mark a key rate-limited or billing-exhausted. Default cooldown is
   * one hour; callers with a Retry-After header from the provider
   * should pass `now + retryAfterMs` as `until`. `now` is accepted
   * for test determinism — all other time-sensitive methods accept it
   * the same way so the class is fully injectable from the outside.
   */
  markExhausted(id: string, until?: number, now: number = Date.now()): void {
    const key = this.keys.find((k) => k.id === id);
    if (!key) return;
    // Only transition OK → exhausted. Don't clobber an auth_failed
    // key back into a retryable state.
    if (key.status === 'auth_failed') return;
    key.status = 'exhausted';
    key.cooldownUntil = until ?? now + DEFAULT_COOLDOWN_MS;
  }

  /**
   * Mark a key permanently bad (revoked / 401 / 403). Never returns
   * to `ok` within this pool's lifetime — caller must `add()` again
   * with fresh material if the key gets rotated.
   */
  markAuthFailed(id: string): void {
    const key = this.keys.find((k) => k.id === id);
    if (!key) return;
    key.status = 'auth_failed';
    key.cooldownUntil = null;
  }

  /** Diagnostics snapshot — safe to log / surface via CLI / dashboard. */
  snapshot(): KeySnapshot[] {
    return this.keys.map((k) => ({
      id: k.id,
      status: k.status,
      ...(k.cooldownUntil !== null ? { cooldownUntil: k.cooldownUntil } : {}),
      ...(k.lastUsedAt !== null ? { lastUsedAt: k.lastUsedAt } : {}),
    }));
  }

  // ------------------------------------------------------------
  // internals
  // ------------------------------------------------------------

  private isAvailable(k: KeyState, now: number): boolean {
    if (k.status === 'auth_failed') return false;
    if (k.status === 'ok') return true;
    // exhausted: check cooldown
    if (k.cooldownUntil === null) return false; // indefinite exhaustion
    if (now >= k.cooldownUntil) {
      // Cooldown elapsed — transparently restore to OK.
      k.status = 'ok';
      k.cooldownUntil = null;
      return true;
    }
    return false;
  }
}
