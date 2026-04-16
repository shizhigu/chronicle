# 0014. Credential pool — multi-key selection + cooldown tracking

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Chronicle's CLI stores one API key per provider in
`~/.chronicle/auth.json`. At startup, `hydrate-env` reads that key and
injects it into the provider's environment variable (e.g.
`ANTHROPIC_API_KEY`). Pi-agent picks it up from there.

This single-key model becomes the bottleneck the moment a user:

- Has multiple accounts with the same provider (personal + work,
  free tier + paid) and wants to spread load.
- Hits the 429 rate ceiling on one account and wants to keep going
  with another rather than stall.
- Wants to run a multi-agent world at higher concurrency than one
  key's tier allows.

Hermes-agent solves the same problem with a 1400-line
`credential_pool.py` covering OAuth refresh, per-provider strategies,
persisted cooldown state. Chronicle inherits the *shape* (pool of
keys + selection strategy + per-key cooldown) but deliberately
leaves runtime key-swap-on-failure out of scope — that requires
pi-agent cooperation we don't have.

## Decision

Introduce a small, reusable `CredentialPool` class in
`@chronicle/core` plus a backward-compatible extension to
`auth.json`. Scope for v1:

### 1. `CredentialPool` (core)

A pure in-memory pool:

```ts
interface PoolKey {
  id: string;            // stable identifier (for logs / lru tracking)
  value: string;         // the actual secret
  metadata?: Record<string, unknown>;  // account label, tier, etc.
}

type Strategy = 'round_robin' | 'random' | 'lru';

class CredentialPool {
  constructor(strategy?: Strategy);
  add(key: PoolKey): void;
  pickAvailable(now?: number): PoolKey | null;
  markExhausted(id: string, until?: number): void;   // cooldown until `until` (ms epoch)
  markAuthFailed(id: string): void;                  // permanent kill
  availableCount(now?: number): number;
  snapshot(): Array<{ id: string; status: 'ok' | 'exhausted' | 'auth_failed'; cooldownUntil?: number }>;
}
```

Pure stateful object. Caller owns persistence. Tests construct pools
directly and drive them via add / markExhausted / pickAvailable
without any file I/O.

### 2. Selection strategies

- **`round_robin`** — cycle through keys in insertion order, skip
  currently-exhausted keys. Deterministic given insertion order;
  good default for "spread load evenly."
- **`random`** — uniform draw from currently-available keys. Useful
  when keys are identical and you don't want any head-of-line
  pattern.
- **`lru`** — pick the key whose `lastUsedAt` is smallest. Best
  under bursty load where one call to `pickAvailable` reserves a
  key for a noticeable duration.

Adding a new strategy = one switch case. No plans for the other
hermes strategies (`fill_first`, `least_used` by total count) — the
three above cover 95% of real use.

### 3. Cooldown tracking

- `markExhausted(id, until?)` — key unavailable until `until`
  (default: 1 hour from now). Matches hermes's rate-limit TTL. The
  ADR-0013 classifier already extracts `Retry-After` on 429s; if the
  caller has a classified error with `retryAfterMs`, they pass
  `now + retryAfterMs` as `until`.
- `markAuthFailed(id)` — permanent. An auth-failing key typically
  means the token was revoked or never valid; retrying it later will
  fail the same way. Permanent removal without deletion (so the
  pool's snapshot still shows it for diagnostics).

### 4. auth.json multi-key format

Today's shape:

```json
{
  "anthropic": { "type": "api-key", "key": "sk-ant-xxx" }
}
```

Extended shape (both still supported):

```json
{
  "anthropic": { "type": "api-key", "key": "sk-ant-primary",
                 "additionalKeys": [
                   { "key": "sk-ant-secondary", "label": "personal" },
                   { "key": "sk-ant-tertiary" }
                 ] }
}
```

Old JSON files load unchanged. New files can add `additionalKeys`.
`hydrate-env` constructs a `CredentialPool` with all keys (primary +
additional), picks one via the default strategy, and injects that
one into the provider's env var.

### 5. Non-goals (explicit)

- **Runtime key swap on 429 / auth failure.** Pi-agent reads env
  vars at SDK init time; we can't flip the env mid-process and
  expect it to take effect. Future work: either (a) ask pi-agent
  for a hook, or (b) each pi-agent instance gets its own process.
- **OAuth token refresh.** Hermes has this for Codex / certain
  providers. Out of scope until chronicle needs it.
- **Persisted cooldown state across CLI restarts.** In-memory
  cooldowns reset on every `chronicle` invocation. Acceptable
  because the CLI is short-lived; long-running engines can persist
  via their own hook.

## Composition with prior layers

- **ADR-0003** event-sourced: unchanged. The pool is a CLI startup
  concern, not a simulation concern.
- **ADR-0013** resilience: when pi-agent cooperation lands, a
  ClassifiedError with `kind=rate_limit` will feed directly into
  `markExhausted`. Interface pre-compatible.
- **hydrate-env.ts**: extended but backward-compatible. A user with
  the current single-key config sees identical behavior.

## Consequences

### Positive

- **Spreads load across multiple accounts** for users who have them.
- **Foundation for runtime failover**. When pi-agent gains a swap
  hook, adding `onKeyExhausted` becomes a one-line integration.
- **Cheap**: ~150 LoC utility + ~30 LoC auth-storage extension.

### Negative

- **Still one key per process at runtime.** The v1 benefit is
  narrow — only the selection at CLI startup. Users expecting
  "chronicle uses key A, fails over to B automatically" will have
  to wait.

### Neutral / accept

- **No persistence across restarts.** A key that got 429'd in the
  last run is available again on the next `chronicle` invocation.
  For the CLI's short-run nature this is fine; the provider's
  rate-limit window is usually longer than chronicle's typical
  invocation anyway.

## Implementation plan

1. `packages/core/src/credential-pool.ts` — the class + three
   strategies + cooldown tracking. Pure. Tested as a unit.
2. Extend `packages/cli/src/auth-storage.ts`'s `ApiKeyCredential`
   type with optional `additionalKeys`. Existing save/load paths
   preserve the field.
3. Update `packages/cli/src/hydrate-env.ts` to build a pool and
   pick. Single-key case takes the no-op path (pool with one
   member).
4. Tests for the pool (strategies + cooldown) and for hydrate-env
   multi-key behavior.
5. Code-reviewer subagent.

## Revisit triggers

- Pi-agent gains a "swap credential mid-call" hook → add runtime
  failover, persist cooldowns.
- OAuth-issuer providers matter (Codex-style) → port the OAuth
  refresh from hermes.
- Users report surprise that 429 cooldowns reset across CLI
  restarts → persist via `~/.chronicle/credential-state.json`.
