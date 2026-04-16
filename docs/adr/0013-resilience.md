# 0013. Resilience layer — typed error classifier + jittered retry for LLM calls

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

The agent tick loop calls `instance.prompt(prompt)` against pi-agent,
which calls into whichever provider the user configured (Anthropic,
OpenAI, Groq, local LM Studio, etc.). Any of those calls can fail for
reasons with wildly different recovery paths:

- **Transient**: rate limit, overloaded server, network glitch → retry with backoff usually works
- **Permanent**: auth broken, model id typo'd, payload malformed → retry would just waste time
- **Configuration**: context overflow, credit exhausted → recoverable but not by the retry loop alone (needs compression or credential rotation)

Today the engine has no structured response to any of these — a
failed `takeTurn` bubbles as a raw `error: String(err)` into the
TurnResult, and the character is simply skipped for the tick. In a
500-tick run on a flaky provider, that's a lot of silently-skipped
character turns. Users don't realise their simulation got thin
because they missed a 429 storm at tick 47.

Hermes-agent solves the same problem with a 800+ line
`error_classifier.py` + `retry_utils.py` in `~/.hermes/hermes-agent`.
We borrow the **shape** (typed reason enum + jittered exponential
backoff with upper bound) but keep the surface small — chronicle
worlds don't need hermes's per-provider quirk set.

## Decision

Add a tiny resilience module to `@chronicle/core` with two public
pieces:

### 1. `classifyError(err): ClassifiedError`

Turns an opaque throwable into:

```ts
interface ClassifiedError {
  kind: FailureKind;
  status?: number;
  message: string;
  retryable: boolean;
  /** Optional additional delay in ms (e.g. from Retry-After). */
  retryAfterMs?: number;
}

type FailureKind =
  | 'rate_limit'      // 429 — retryable with extra backoff
  | 'auth'            // 401/403 — not retryable without intervention
  | 'billing'         // 402 — not retryable
  | 'server_error'    // 500/502/503/504 — retryable
  | 'timeout'         // connection/read timeout — retryable
  | 'context_overflow'// payload too large — not retryable (compression is a separate concern)
  | 'format_error'    // 400 bad request — not retryable
  | 'not_found'       // 404 model / endpoint missing — not retryable
  | 'network'         // fetch failed / DNS / socket — retryable
  | 'unknown';        // unclassifiable — retryable once, conservatively
```

The implementation inspects (in order): explicit `status` fields on
the error, well-known error-name strings ("AbortError", "TimeoutError",
"FetchError"), message substrings ("rate limit", "overloaded",
"timeout", "ECONNRESET", etc.). Explicitly avoids per-provider body
parsing — this lives upstream in pi-agent.

### 2. `retryWithBackoff(fn, opts)`

```ts
interface RetryOptions {
  maxAttempts: number;         // default 4
  baseDelayMs: number;         // default 1000
  maxDelayMs: number;          // default 60_000
  jitterRatio: number;         // default 0.5
  onRetry?: (attempt, err, delayMs) => void;
  shouldRetry?: (err: ClassifiedError) => boolean;  // default: err.retryable
}

retryWithBackoff(fn, opts?) → Promise<T>
```

Attempt `i`'s delay: `min(baseDelay * 2^(i-1), maxDelayMs) +
uniform(0, jitterRatio * delay)`, plus `retryAfterMs` if the
classified error includes one. On every failure, re-classify and
re-check `shouldRetry`; the loop bails the moment it sees
`retryable: false`.

### 3. Wire into `agent-pool.takeTurn`

The existing try/catch around `instance.prompt(prompt)` gets an inner
`retryWithBackoff`. Non-retryable failures bubble on the first
attempt; retryable ones burn up to `maxAttempts` with backoff. The
outer catch still records a useful error string on the final failure
(now `${kind}:${message}` rather than `String(err)`).

### Non-replay concern

Chronicle promises bit-exact replay given the same LLM responses
(ADR-0003). The retry layer uses `Math.random()` for jitter, which
violates determinism — BUT:

- Retries only fire on **real network / provider failures**.
- During replay, the original LLM response is loaded from the
  events table; the retry path does not execute.
- Even if a replay encountered a failure mid-flight (e.g. a replayed
  run against a provider that's currently rate-limiting), the
  original run's retry sequence is not what we're trying to
  reproduce — we're trying to reproduce its outcome, not its
  timing.

So `Math.random()` in retry jitter is **non-replay-sensitive** and
acceptable. The alternative — seeding from `world.rngSeed + attempt`
— would give deterministic retries but at the cost of correlated
backoffs across worlds sharing a seed, defeating the "decorrelate
the thundering herd" goal of jittering.

## Non-goals

- **Credential rotation / failover to another provider**. Hermes does
  this; chronicle does not (yet). One provider per character is
  assumed. Future ADR if multi-provider failover matters.
- **Context compression on overflow**. Separate concern; belongs in
  a trajectory-compression module (see hermes's
  `trajectory_compressor.py`).
- **Rate-limit accounting across characters**. A 20-agent world that
  shares a provider could issue 20 concurrent calls per tick — if
  each retries independently they can saturate the provider. Fine
  for v1; a shared token bucket would be future work.

## Composition with prior work

- **ADR-0003 event-sourced**: unchanged. Retry only fires on real
  network failures, which don't appear in replay.
- **ADR-0010 activation**: dormancy skips `takeTurn` entirely for
  quiet agents. Retry-on-failure only applies to agents that
  actually tried. So a flaky provider with 50% failure rate and 50%
  dormancy rate costs at most 1.5× the attempt rate, not 4×.
- **ADR-0012 redaction**: classified error messages are already
  passed through `redactValue` before landing in event logs, so a
  leaked secret in an error body stays out of dashboards.

## Consequences

### Positive

- **Simulations survive flaky providers**. A rate-limited run
  throttles down instead of gapping out at tick 47.
- **Clearer error signal**. Dashboards and post-mortems see
  `"rate_limit: 429 too many requests"` instead of
  `"[object Object]"`.
- **Cheap**. One small module + one call-site wrap. No per-provider
  branching; the classifier is message/status-based.

### Negative

- **Tick-time variance grows** under retry. A world with a 10%
  retryable failure rate and 3 retries will occasionally see
  multi-second tick stalls. Users who care about wall-clock ticking
  can set `maxAttempts: 1` via world config (opt-in; default 4).
- **Memory pressure on error objects**. We keep them in the
  classified struct for diagnostics. Bounded — GC collects them
  when the retry loop exits.

## Implementation plan

1. `packages/core/src/resilience.ts` — module with both helpers, no
   chronicle-package deps (so CLI and dashboard can use it).
2. Tests per FailureKind + happy/sad paths of `retryWithBackoff`.
3. Wire into `packages/runtime/src/agent-pool.ts` `takeTurn` around
   the existing `instance.prompt(prompt)`.
4. Integration test: a failing-then-succeeding stub in agent-pool's
   test suite.
5. Code-reviewer subagent.

## Revisit triggers

- Users report tick stalls in production — lower default
  `maxAttempts` or expose per-world override.
- A provider gets added whose errors don't classify cleanly — add
  patterns + a test.
- Concurrent-rate-limit thrash observed in multi-agent worlds — add
  shared token bucket (separate ADR).
