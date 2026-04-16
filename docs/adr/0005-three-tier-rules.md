# 0005. Three-tier rule system: hard, soft, economic

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

A world in Chronicle has *rules*. Some are physical laws ("you cannot move to a location you are not adjacent to"). Some are social norms ("do not interrupt while another character is speaking"). Some are economic ("speaking costs energy; fighting costs more").

If we model all of these the same way, we end up with two bad options:

1. **All rules as code predicates.** Works for physics but forces us to pre-compile "do not insult the host" into a predicate — which is impossible without running the LLM anyway.
2. **All rules as LLM judgments.** Works for norms but is preposterously expensive and unreliable for "the actor is not in the target's location" — a lookup should not cost a million tokens.

We need a classification that matches the **nature** of each rule to an **enforcement mechanism**.

## Decision

Every rule belongs to exactly one of three tiers:

### Hard rules
Deterministic predicates enforced in the engine before any tool call mutates state. Backed by SQL constraints and TypeScript checks.

Examples:
- `actor.locationId == target.locationId` (can't interact across rooms)
- `resource.quantity >= amount` (can't transfer what you don't have)

Violations are absolute — the action is rejected before it happens. No LLM call.

### Soft rules
Normative judgments enforced post-action by an LLM-judge. Violations do not roll back the action but do produce reputation / relationship consequences.

Examples:
- "Don't insult the host."
- "Don't lie about your profession."

The judge prompt encodes both detection (`did this happen?`) and consequence (`how does the room feel about it?`).

### Economic rules
Numeric cost formulas applied when an action is proposed. The action is possible iff the actor has the resource (tokens, energy, gold); cost is deducted on success.

Examples:
- `action.kind == 'speak' → cost 1 energy`
- `action.kind == 'craft' && ingredient == 'iron' → cost 5 gold + 2 hours`

Economic rules make scarcity the regulator for frequent but non-binary actions.

Each `Rule` row in SQLite has a `tier` column and only one tier's columns populated. The compiler classifies natural-language rules into tiers; ambiguous ones default to `soft` with a `compiler_notes` explanation.

## Rationale

- **Match the enforcement to the nature.** Physics needs predicates; norms need judgment; economics needs arithmetic. A unified system lets each do what it does best.
- **Cost discipline.** Hard checks are free (SQL); economic checks are trivial (arithmetic); only soft rules cost LLM tokens — and even those can be batched per tick.
- **Composability.** Scenarios layer rule types naturally. "No violence" can be a hard rule if the world is literal; a soft rule if it is a norm with exceptions; an economic rule if it just costs reputation.
- **Determinism where possible.** Hard + economic rules are deterministic, so replays reproduce exactly. Only soft rules introduce stochasticity, and their judgments are logged as events for audit.

## Alternatives considered

- **Single-tier predicate system.** Can't express social norms without an LLM call; forces either unreliable codegen or omitting entire categories of rules.
- **Single-tier LLM-judge system.** Unaffordable for common physical checks; makes replays non-deterministic.
- **Two tiers (hard + soft).** Tempting for simplicity, but collapses economic rules into soft, which is wasteful — cost formulas are pure arithmetic and should not hit an LLM.
- **More tiers (e.g., "legal" vs. "moral").** Diminishing returns; each extra tier must carry its weight in code paths and cognitive load. Three is the natural breakpoint.

## Consequences

### Positive
- Clear mental model: operators classify rules once; the engine does the right thing automatically.
- The compiler's output is inspectable: `scenario.md` → `rules.json` with one tier per rule.
- Soft-rule judgments are batched per tick, capping token spend.
- Hard-rule violations produce high-quality error messages before an action runs.

### Negative
- **Classification ambiguity.** Some rules genuinely straddle tiers. The compiler must make a call and annotate it; the operator may need to adjust manually. We ship the `compiler_notes` column specifically for this.
- **Three code paths.** The rule enforcer has branches for each tier. Tested, but it is extra surface area compared to a uniform system.

### Neutral / accept
- Soft-rule judges use a cheaper model tier than character agents by default (cost control).

## Revisit triggers

- An entire category of rules appears in practice that fits none of the three tiers naturally.
- Soft-rule judgment cost dominates simulation budgets despite batching.
- Empirical evidence that operators misclassify rules often enough to warrant auto-reclassification.

## Related

- [`docs/RULE_COMPILER.md`](../RULE_COMPILER.md) — how natural language becomes tiered rules.
- [`docs/AGENT_RUNTIME.md`](../AGENT_RUNTIME.md) — how `beforeToolCall` enforces hard + economic tiers.
