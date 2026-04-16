# 0007. Natural language is the primary configuration surface

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Users of Chronicle describe worlds: "A dinner party at a manor where the host is lying about their fortune, five guests each have a secret, and the butler hates them all." That sentence is denser and more evocative than any YAML schema we could design.

At the same time, the engine needs **structured data**: agents with typed fields, action schemas with parameters, rules classified into tiers, locations with adjacencies.

We must decide whether the primary authoring surface is structured (YAML / JSON / TOML) with natural language as a bonus, or natural language with structured data as the compiled form.

## Decision

**Natural language is the source of truth.** Users write `.chronicle.md` files — Markdown with loosely-structured sections (World, Locations, Characters, Rules). The `WorldCompiler` (backed by an LLM) parses those into a typed `CompiledWorld` with Zod validation, then persists to SQLite.

The compiled output is **inspectable and editable** — if the compiler gets something wrong, the operator can fix the JSON directly, and the corrected structured form becomes the new source of truth from that point on (natural-language reparsing is not re-run on edits; it is one-way).

Similarly, `god interventions` are natural language ("Make it rain"), compiled into a structured `compiledEffects` at apply time.

Rules follow the same pattern: described in natural language, classified into hard / soft / economic tiers by the rule compiler (see [ADR 0005](0005-three-tier-rules.md)).

## Rationale

- **Matches how creators think.** Writers, tabletop GMs, game designers — all think in prose before they think in schemas.
- **Evocative defaults.** "A manor at dusk, the fire dying" carries atmosphere that no enum can encode. The compiler can produce richer defaults (lighting, mood, affordances) from prose than from checkbox UI.
- **The LLM is already in the loop.** Running the characters requires an LLM; using one for one-shot compilation costs a trivial amount on top.
- **Inspectable output.** Compiled JSON is the audit trail. Reviewers can see what the compiler interpreted and catch mistakes.
- **Graceful handling of ambiguity.** When a rule could be hard or soft, the compiler picks one with a `compiler_notes` explanation — a machine-produced comment on its own work.

## Alternatives considered

- **Structured config as primary surface (YAML / TOML).** Perfectly reliable, but the authoring experience is "fill in a form" — hostile to the creative act we want to enable.
- **Natural language at runtime (no compilation step).** Every tick would reparse the rules, costing tokens and introducing nondeterminism. Compilation once, then structured persistence, is the right cut.
- **Visual editor (drag-and-drop scenario builder).** A potential future addition, but it should produce the same natural-language + compiled artifact under the hood. Not the first-class surface.

## Consequences

### Positive
- Onboarding is "read three example scenarios, write your own." No schema docs required for the happy path.
- Forking a scenario and riffing on it is a copy-paste-edit of Markdown — approachable to non-programmers.
- The compiled JSON serves as both engine input *and* reviewable artifact.
- A/B testing scenarios is easy: tweak the description, recompile, run, compare drama scores.

### Negative
- **Compilation is LLM-driven, therefore nondeterministic.** Two runs of the same description may produce slightly different compiled JSON. Mitigations: (a) low temperature, (b) Zod schema rejection of malformed output forces retries, (c) the compiled JSON is committed alongside the description so the "current" version is pinned.
- **Compilation can misinterpret.** The `compiler_notes` column surfaces ambiguity; the `chronicle verify` command re-reads a compiled world and prints a human-readable summary so the operator can spot drift.
- **LLM API cost during authoring.** Typically one or two calls per world-create; negligible compared to runtime.

### Neutral / accept
- The compiler is versioned alongside the engine; recompiling the same description in a future version may yield different output. Compiled artifacts are pinned to the compiler version that produced them (see `created_by_chronicle` column).

## Revisit triggers

- Compiler accuracy drops below acceptable thresholds on a representative scenario corpus (we'd measure before changing).
- A visual editor surface grows to cover the 90% case and users stop writing Markdown.
- A deterministic DSL emerges that preserves the evocative-authoring property (we do not expect this — DSLs always sacrifice atmosphere for precision — but we'd evaluate).

## Related

- [`docs/RULE_COMPILER.md`](../RULE_COMPILER.md) — how rules specifically are compiled.
- [`docs/SCENARIO_DESIGN.md`](../SCENARIO_DESIGN.md) — authoring principles for scenarios.
- [0005. Three-tier rule system](0005-three-tier-rules.md) — the tier classification that compilation produces.
