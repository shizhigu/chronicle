# 0006. TypeScript strict mode, all the way down

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Chronicle is a TypeScript monorepo with a long-lived data model (agents, rules, events, resources), a plugin surface (agent runtime adapters, action schemas), and a public API published to npm. The cost of a type hole in a well-used library is amplified across every consumer.

We must decide how strict to be on TypeScript, and whether `any` is acceptable in any corner of the codebase.

## Decision

All packages extend a shared `tsconfig.base.json` with:

- `"strict": true`
- `"noUncheckedIndexedAccess": true`
- `"exactOptionalPropertyTypes": true`
- `"noImplicitOverride": true`
- `"noImplicitReturns": true`
- `"noFallthroughCasesInSwitch": true`
- `"useUnknownInCatchVariables": true` (implied by strict)
- `"verbatimModuleSyntax": true`
- `"isolatedModules": true`

`any` is effectively banned outside of:

1. A third-party type declaration gap (document with a `// TODO(strict):` comment and a linked issue).
2. A `@ts-expect-error` used to pin down a known-bad external API.

Prefer `unknown` with a type guard over `any`. Prefer discriminated unions over optional fields that "sometimes mean different things."

Biome enforces unused `any` and unused suppression comments in CI.

## Rationale

- **Event-sourced model depends on exhaustive union coverage.** `EventType` is a string-literal union; `switch (event.eventType)` should never silently fall through. Strict mode catches missing branches at compile time.
- **LLM-fed payloads are untrusted.** Boundary code that parses model output must use `unknown` → Zod → typed — never `any`. Zod's inferred types flow through the codebase.
- **Published API stability.** A consumer of `@chronicle/engine` should get red squiggles for misuse, not runtime surprises. `exactOptionalPropertyTypes` in particular catches "is this field `undefined` or missing?" confusions that would otherwise leak into JSON serialization.
- **`noUncheckedIndexedAccess` matches reality.** `rows[0]` is not guaranteed to exist — forcing `rows[0]?.field ?? fallback` removes an entire class of runtime errors.

## Alternatives considered

- **"Strict" but allow `any` as an escape hatch.** Collapses under pressure; `any` spreads.
- **Loose mode (no `noImplicit*`).** Incompatible with the correctness we need in rule enforcement.
- **Heavy runtime validation without type discipline.** Catches the same errors later; more expensive at call sites; produces worse DX for consumers.

## Consequences

### Positive
- Refactors that rename / restructure types flag every affected site at compile time.
- Exhaustiveness checks on rule tiers, event types, memory types, model tiers — every `switch` on a discriminated union is checked.
- Consumers of the published packages get precise autocomplete and fail-fast type errors.
- Bun's fast TS loader means strictness does not slow iteration.

### Negative
- **Onboarding friction.** Contributors unfamiliar with strict TypeScript hit red squiggles immediately. Mitigation: `CONTRIBUTING.md` has a "working with strict TS" section pointing at common patterns (discriminated unions, Zod `safeParse`, `unknown` narrowing).
- **Expressing "optional-but-set-to-undefined"** requires care with `exactOptionalPropertyTypes`. We use `Partial<Pick<…>>` and explicit union-with-`undefined` where appropriate.

### Neutral / accept
- Tests run in strict mode too. Type errors in tests are errors.

## Revisit triggers

- A TypeScript release breaks one of our strictness flags (rare; we would pin temporarily and adapt).
- A practical pattern genuinely requires `any` in hot code — we would add a targeted escape hatch with an ADR update rather than blanket-relax strictness.

## Related

- `tsconfig.base.json` in the repo root.
- `CONTRIBUTING.md` — code style section.
