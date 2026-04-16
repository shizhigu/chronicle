# 0008. Predicate DSL scope: what's in, what's out

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

The rule compiler ([ADR 0005](0005-three-tier-rules.md)) emits hard-rule predicates as strings. The runtime needs a safe way to evaluate them. We wrote our own mini-DSL at `packages/engine/src/rules/predicate.ts` rather than pull in an expression library or use `eval()`.

Because this is the hinge between "natural language compiles to a rule" and "rule blocks or allows an action," its surface area determines what kinds of worlds we can describe. Too small → common rule patterns can't be compiled; too large → attack surface + complexity.

This ADR records what's **in** and what's **out**, and when to reopen.

## Decision

### In scope (v0.2 grammar)

| Feature | Example | Why |
|---|---|---|
| Literals | `true`, `false`, `null`, `1.5`, `"str"` | Baseline |
| Paths | `character.alive`, `action.args.target`, `world.atmosphere` | All rules start here |
| Bracket indexing | `character.inventory[0]`, `world.config["scale"]` | Heterogeneous objects |
| `.length` pseudo-property | `action.args.content.length <= 280` | Very common rule shape |
| Comparison | `== != > < >= <=` | Baseline |
| Boolean | `&&`, `\|\|`, `!`, parentheses | Compound rules |
| Arithmetic | `+ - * / %` + unary minus | "energy - cost ≥ 0", "half the crowd" |
| `in` operator | `"admin" in character.roles` | Multi-role / ally / inventory checks |
| Whitelisted methods | `startsWith`, `endsWith`, `includes`, `toLowerCase`, `toUpperCase`, `trim` | Text rules (@mentions, forbidden words, case-insensitive) |
| String `+` | `"@" + character.name` | Building targets dynamically |
| Loose equality for number-string coercion | `"5" == 5` is true | Matches LLM output shapes |

### Explicitly out of scope (won't implement without strong evidence)

| Feature | Why out | Workaround |
|---|---|---|
| Assignment, mutation, state | DSL evaluates, never mutates | Use rule tiers; side effects live in engine code |
| Function definitions, lambdas, closures | Predicates should be declarative | Compiler emits simpler expressions |
| Arbitrary method calls | Security: would let rules call `.constructor()` etc. | Whitelist |
| Regex literals | Complex; gray-zone safety (ReDoS); rarely needed for rules | `startsWith` / `endsWith` / `includes` |
| Ternary `a ? b : c` | Compiler emits boolean; if users need branching they should split into two rules | — |
| Chained comparisons `0 < x < 10` | Ambiguity with Python-like reading; Python-style ≠ C-style | `0 < x && x < 10` |
| Scientific notation, hex, octal | Never needed for rule thresholds | Decimal |
| Bitwise operators `& \| ^ ~ << >>` | No rule patterns we've seen use them | — |
| Imports / variables / `let` | Predicates are one-liners | — |
| Async / await | DSL is synchronous by design | Soft rules run LLM judges elsewhere |

### Safety invariants (never compromise)

- **No `eval()`, no `Function()`, no dynamic code construction.** The evaluator is a pure tree walker over a parsed AST.
- **Method calls are whitelisted.** Adding a new method requires this ADR's update plus a test.
- **No network, filesystem, or process access.** The evaluator can only read from the context object passed in.
- **No identifier-to-global resolution.** `Math`, `process`, `global`, `window`, `Bun` are all inaccessible.

## Rationale

### Why a hand-rolled DSL

- A rule engine needs to run fast and deterministically. A hand-rolled recursive-descent parser costs a few hundred microseconds per predicate on modern hardware and is cache-friendly.
- Locking the grammar keeps the compiler honest — we know exactly what it can emit. A library with a larger grammar is a supply-chain risk every time it updates.
- Error messages are ours. We control what happens when the LLM emits a weirdly-quoted string.

### Why these specific additions in v0.2

Each entry in "in scope" was added because at least one realistic scenario needed it:
- **Arithmetic**: cost checks, vote thresholds, relative positions (distance ≤ 3).
- **`in`**: multi-valued role/tag fields, ally lists, inventory checks.
- **String methods**: forbidden-word rules, @-mention validation, case-insensitive name matching.

### Why "loose equality" (`==`)

LLM-compiled predicates often mix numbers and strings because the LLM doesn't consistently pick one. `"5" == 5 → true` prevents a whole class of silent rule failures where a rule would never fire because of a type mismatch the operator didn't notice. This is different from JS's `==`: we support only `number ↔ string` coercion, not the full mess.

## Alternatives considered

- **Adopt a library** (jsep + acorn-jsep, jexl, filtrex). Each brings either a larger grammar than we want to commit to, or a weaker safety story than we need. Adding one dependency to expose 5 operators was a bad trade.
- **Use JSONLogic.** Lisp-in-JSON is hard for an LLM to emit reliably and impossible for humans to eyeball. We want the compiled output to be readable.
- **Compile to an AST in JSON instead of a string.** The string form survives SQLite row copy-paste, prints legibly in admin tools, and is the same format the compiler emits in its intermediate steps.

## Consequences

### Positive
- 190 tests lock the grammar; future changes land with tests.
- Attack surface is small and auditable by one reviewer.
- Error messages reference the original source position, helping the compiler report weird LLM output.

### Negative
- When a compiler path wants a new primitive (e.g., date comparison), we must update this ADR and the DSL in lockstep.
- The DSL is *not* Turing-complete by design; some rule patterns that fit naturally in a general-purpose language cannot be expressed. We're fine with this.

### Neutral / accept
- Error recovery is minimal — the parser throws on first error. Good enough for rule strings.

## Revisit triggers

Update this ADR and extend the grammar when:
- A real scenario (from `examples/` or a submitted user scenario) has a rule the compiler tries to emit but our DSL can't express, and the workaround is materially worse.
- Performance becomes a concern — a release benchmark shows predicate evaluation >5% of tick time.
- A whitelisted method is found to enable unexpected behavior (remove it, reset tests).

Do NOT extend the grammar just because a feature "would be nice." Require a concrete scenario and a regression test.

## Related

- [0005. Three-tier rules](0005-three-tier-rules.md) — how the compiler decides what becomes a hard-rule predicate.
- `packages/engine/src/rules/predicate.ts` — the implementation.
- `packages/engine/test/predicate.test.ts`, `predicate-v2.test.ts` — the locked behavior.
