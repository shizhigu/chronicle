/**
 * Resilience module — classifier + retry.
 *
 * Each FailureKind is exercised via the most likely input shape
 * (Response-like status, Error name, typical message substring). The
 * retry loop is driven with a synchronous sleeper so tests stay fast
 * and deterministic regardless of jitter.
 */

import { describe, expect, it } from 'bun:test';
import { classifyError, retryWithBackoff } from '../src/resilience.js';

describe('classifyError — structured status', () => {
  it('429 → rate_limit (retryable)', () => {
    const c = classifyError({ status: 429, message: 'rate limited' });
    expect(c.kind).toBe('rate_limit');
    expect(c.retryable).toBe(true);
    expect(c.status).toBe(429);
  });

  it('401 / 403 → auth (not retryable)', () => {
    expect(classifyError({ status: 401, message: 'unauthorized' }).kind).toBe('auth');
    expect(classifyError({ status: 403, message: 'forbidden' }).kind).toBe('auth');
    expect(classifyError({ status: 401, message: 'x' }).retryable).toBe(false);
  });

  it('402 → billing (not retryable)', () => {
    const c = classifyError({ status: 402, message: 'payment required' });
    expect(c.kind).toBe('billing');
    expect(c.retryable).toBe(false);
  });

  it('500 / 502 / 503 / 504 → server_error (retryable)', () => {
    for (const status of [500, 502, 503, 504]) {
      const c = classifyError({ status, message: 'x' });
      expect(c.kind).toBe('server_error');
      expect(c.retryable).toBe(true);
    }
  });

  it('408 → timeout (retryable)', () => {
    expect(classifyError({ status: 408, message: 'x' }).kind).toBe('timeout');
  });

  it('413 → context_overflow (not retryable)', () => {
    const c = classifyError({ status: 413, message: 'payload too large' });
    expect(c.kind).toBe('context_overflow');
    expect(c.retryable).toBe(false);
  });

  it('404 → not_found (not retryable)', () => {
    expect(classifyError({ status: 404, message: 'model not found' }).kind).toBe('not_found');
  });

  it('400 → format_error (not retryable)', () => {
    expect(classifyError({ status: 400, message: 'bad request' }).kind).toBe('format_error');
  });

  it('reads status from response.status as well as top-level', () => {
    const c = classifyError({ response: { status: 429 }, message: 'x' });
    expect(c.kind).toBe('rate_limit');
  });
});

describe('classifyError — error names and codes', () => {
  it('AbortError → timeout', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(classifyError(e).kind).toBe('timeout');
  });

  it('ETIMEDOUT → timeout', () => {
    const e = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    expect(classifyError(e).kind).toBe('timeout');
  });

  it('ECONNRESET / ECONNREFUSED / ENOTFOUND → network', () => {
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
      const e = Object.assign(new Error('net'), { code });
      expect(classifyError(e).kind).toBe('network');
    }
  });
});

describe('classifyError — message substrings', () => {
  it('matches rate-limit language', () => {
    expect(classifyError(new Error('Rate limited: retry later')).kind).toBe('rate_limit');
    expect(classifyError(new Error('too many requests')).kind).toBe('rate_limit');
    expect(classifyError(new Error('request was throttled')).kind).toBe('rate_limit');
  });

  it('matches auth failures', () => {
    expect(classifyError(new Error('Unauthorized: invalid api key')).kind).toBe('auth');
    expect(classifyError(new Error('missing api key')).kind).toBe('auth');
  });

  it('matches billing', () => {
    expect(classifyError(new Error('insufficient credit on account')).kind).toBe('billing');
    expect(classifyError(new Error('quota exceeded')).kind).toBe('billing');
  });

  it('matches context overflow', () => {
    expect(classifyError(new Error('context length exceeded, too long 200k tokens')).kind).toBe(
      'context_overflow',
    );
    expect(classifyError(new Error('payload too large')).kind).toBe('context_overflow');
  });

  it('matches LM Studio / local-server "no model loaded" as not_found (not retryable)', () => {
    // LM Studio returns this 400 body when the user has the REST
    // server on but no model loaded (auto-unloaded via TTL, etc.).
    // Without classifying this as not_found, pi-agent's retry loop
    // eats context-window-fulls of identical failures.
    for (const msg of [
      'No models loaded. Please load a model in the developer page.',
      'No model loaded',
      'model gemma-3-27b not loaded',
    ]) {
      const c = classifyError(new Error(msg));
      expect(c.kind).toBe('not_found');
      expect(c.retryable).toBe(false);
    }
  });

  it('unknown falls through with retryable=true', () => {
    const c = classifyError(new Error('something weird happened'));
    expect(c.kind).toBe('unknown');
    expect(c.retryable).toBe(true);
  });
});

describe('classifyError — Retry-After extraction', () => {
  it('reads Retry-After header as seconds and converts to ms', () => {
    const c = classifyError({
      status: 429,
      message: 'x',
      headers: { 'retry-after': '30' },
    });
    expect(c.retryAfterMs).toBe(30_000);
  });

  it('reads Retry-After as HTTP-date format', () => {
    const future = new Date(Date.now() + 20_000).toUTCString();
    const c = classifyError({
      status: 429,
      message: 'x',
      headers: { 'retry-after': future },
    });
    expect(c.retryAfterMs).toBeGreaterThan(10_000);
    expect(c.retryAfterMs).toBeLessThan(30_000);
  });

  it('reads retryAfter (seconds) on SDK error objects', () => {
    const c = classifyError({ status: 429, message: 'x', retryAfter: 5 });
    expect(c.retryAfterMs).toBe(5_000);
  });

  it('reads Retry-After from nested response.headers (Anthropic SDK shape)', () => {
    const c = classifyError({
      status: 429,
      message: 'x',
      response: { status: 429, headers: { 'retry-after': '15' } },
    });
    expect(c.retryAfterMs).toBe(15_000);
  });

  it('top-level headers take priority over nested (common case wins)', () => {
    // Defensive: if both are present, top-level wins. Some SDKs set
    // both and they occasionally disagree.
    const c = classifyError({
      status: 429,
      message: 'x',
      headers: { 'retry-after': '3' },
      response: { headers: { 'retry-after': '30' } },
    });
    expect(c.retryAfterMs).toBe(3_000);
  });
});

describe('retryWithBackoff', () => {
  // Synchronous sleeper for deterministic, fast tests.
  const noSleep = async () => {};

  it('succeeds on the first attempt when fn does not throw', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a retryable failure and eventually succeeds', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw { status: 503, message: 'overloaded' };
        return 'finally';
      },
      { sleep: noSleep, maxAttempts: 5 },
    );
    expect(result).toBe('finally');
    expect(calls).toBe(3);
  });

  it('bails immediately on non-retryable errors', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw { status: 401, message: 'unauthorized' };
        },
        { sleep: noSleep, maxAttempts: 5 },
      ),
    ).rejects.toMatchObject({ kind: 'auth', retryable: false });
    expect(calls).toBe(1);
  });

  it('gives up after maxAttempts and throws the last classified error', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw { status: 503, message: 'overloaded' };
        },
        { sleep: noSleep, maxAttempts: 3 },
      ),
    ).rejects.toMatchObject({ kind: 'server_error', retryable: true });
    expect(calls).toBe(3);
  });

  it('invokes onRetry callback for every failed attempt before the last', async () => {
    const attempts: number[] = [];
    let _calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          _calls++;
          throw { status: 500, message: 'x' };
        },
        {
          sleep: noSleep,
          maxAttempts: 3,
          onRetry: (attempt) => attempts.push(attempt),
        },
      ),
    ).rejects.toBeTruthy();
    // 3 attempts total, onRetry fires on the 1st and 2nd (not after the last).
    expect(attempts).toEqual([1, 2]);
  });

  it('delay grows exponentially with attempt (monotonic within a run)', async () => {
    const delays: number[] = [];
    const tickSleep = async (ms: number) => {
      delays.push(ms);
    };
    let _calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          _calls++;
          throw { status: 500, message: 'x' };
        },
        {
          sleep: tickSleep,
          maxAttempts: 4,
          baseDelayMs: 100,
          maxDelayMs: 10_000,
          jitterRatio: 0, // deterministic for the assertion
        },
      ),
    ).rejects.toBeTruthy();
    // Pure exponential with no jitter: 100, 200, 400. The 4th attempt
    // is the one that throws out of the loop — no sleep after it.
    expect(delays).toEqual([100, 200, 400]);
  });

  it('honours Retry-After on top of computed backoff', async () => {
    const delays: number[] = [];
    let _calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          _calls++;
          throw { status: 429, message: 'x', headers: { 'retry-after': '2' } }; // 2s
        },
        {
          sleep: async (ms) => {
            delays.push(ms);
          },
          maxAttempts: 2,
          baseDelayMs: 100,
          maxDelayMs: 10_000,
          jitterRatio: 0,
        },
      ),
    ).rejects.toBeTruthy();
    // First (and only) retry delay: baseBackoff(100) + 0 jitter + retryAfter(2000) = 2100.
    expect(delays).toEqual([2100]);
  });

  it('Retry-After is NOT capped by maxDelayMs (honors server directive above the cap)', async () => {
    // This is the review-critical fix: a server telling us "wait 30s"
    // must not be shortened just because our exponential cap is 5s.
    const delays: number[] = [];
    let _calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          _calls++;
          throw { status: 429, message: 'x', headers: { 'retry-after': '30' } };
        },
        {
          sleep: async (ms) => {
            delays.push(ms);
          },
          maxAttempts: 2,
          baseDelayMs: 100,
          maxDelayMs: 5_000, // aggressively small cap
          jitterRatio: 0,
        },
      ),
    ).rejects.toBeTruthy();
    // 100ms baseBackoff + 30_000ms Retry-After = 30_100ms, UNCAPPED.
    expect(delays).toEqual([30_100]);
  });

  it('shouldRetry override can force retry on normally non-retryable errors', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw { status: 401, message: 'auth' };
        return 'eventually';
      },
      { sleep: async () => {}, shouldRetry: () => true, maxAttempts: 5 },
    );
    expect(result).toBe('eventually');
    expect(calls).toBe(3);
  });
});
