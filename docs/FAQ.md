# Chronicle FAQ

Short answers to the questions people actually ask. If yours isn't here, open a [Discussion](https://github.com/chronicle-sh/chronicle/discussions).

---

## What is Chronicle, really?

A framework where you describe a world in plain English, and a cast of LLM-driven characters plays it out tick-by-tick, with persistent memory, relationships, and rules. You watch. You occasionally intervene. The simulation is deterministic enough to fork and replay.

It's a toolbox, not a product. You can use it to write interactive fiction, test social-simulation hypotheses, prototype game AI, run tabletop one-shots, or just watch a dinner party go off the rails.

---

## Why not just use Claude Agent SDK / LangChain / AutoGen?

Those are excellent agent frameworks, but Chronicle is one layer up:

- **Claude Agent SDK** ties you to Anthropic. Chronicle is model-agnostic via pi-agent → pi-ai.
- **LangChain** is a toolbox for a single agent. Chronicle is a world with many agents, rules, and state.
- **AutoGen** is conversational multi-agent. Chronicle has world physics, economy, and narrative structure.

The differentiator: Chronicle treats the **world** as the primary data model. Agents plug into it; they don't own it.

---

## Why pi-agent? Will you fork it?

pi-agent gives us what we need (stateful sessions, tool-call hooks, model-agnostic LLM calls, TypeScript) in a small, auditable package. See [ADR 0002](adr/0002-pi-agent-runtime.md) for the full reasoning and fork criteria.

Short version: no fork today. We depend on it directly with a pinned minor version, and we hide it behind an `AgentRuntimeAdapter` interface so a fork later is a one-package swap, not a rewrite.

---

## What actually gets stored in the database?

One SQLite file per world. It's event-sourced — every action, message, and state change writes an event, so the current state is reconstructible from the event log. See [ADR 0003](adr/0003-sqlite-event-sourced.md) and `schema/SCHEMA.sql`.

A world ships as a `.chronicle` file (just that SQLite DB with a header marker). Forking a run is `sqlite3 .backup` + `DELETE FROM events WHERE tick > X`.

---

## How do rules work? What can they enforce?

Rules are classified by the compiler into three tiers — see [ADR 0005](adr/0005-three-tier-rules.md):

1. **Hard rules** (physical constraints): evaluated by our safe predicate DSL. Can reference `character.*`, `action.*`, `world.*`. Supports arithmetic, `in`, whitelisted string/array methods. See [ADR 0008](adr/0008-dsl-grammar-scope.md) for what's in/out.
2. **Soft rules** (social norms): evaluated by an LLM-judge after the action, produce reputation / relationship effects.
3. **Economic rules** (costs): arithmetic formulas applied when the action is proposed.

The compiler classifies natural-language rules into tiers automatically. Ambiguous rules default to `soft` with a `compiler_notes` explanation so you can override if needed.

---

## Is the predicate DSL Turing-complete?

No — deliberately. It's an expression language: literals, paths, comparisons, boolean logic, arithmetic, `in`, whitelisted methods. No loops, no assignment, no function definitions. That's what keeps it safe and fast.

If your rule needs more, it probably belongs in engine code, not in a compiled predicate.

---

## Can I use local models (Ollama, LM Studio)?

Yes. pi-ai supports OpenAI-compatible endpoints. Set in `~/.chronicle/config.yml`:

```yaml
defaultProvider: openai
defaultModelId: llama3.1:8b
```

…and point pi-ai at `http://localhost:11434/v1` (or wherever your server runs). Same code path; Chronicle doesn't care.

---

## How much does it cost to run?

Depends on the scenario and the provider. Rough order:

| Scenario | Ticks | Tokens (Haiku) | Approx cost |
|---|---|---|---|
| Dinner party | 100 | ~80k | <$0.05 |
| Desert island | 500 | ~500k | <$0.50 |
| Startup founders | 200 | ~150k | <$0.10 |

Costs scale roughly with tick count × live agent count × decision model. Sonnet-tier reflections add ~10%. Soft-rule judges add ~5%.

Caps are enforced per world via `godBudgetTokens`. The engine pauses when exceeded; `chronicle run --ticks 200` without a budget will run to completion.

---

## My scenario compiled to rules that look wrong — can I fix them by hand?

Yes. Compile once, then edit the compiled JSON (or `rules` table rows). From that point on, your edits are authoritative — Chronicle doesn't re-compile from the original description unless you ask via `chronicle recompile`.

Natural language is the **source of truth for authoring**, but the compiled form is the **source of truth for running**. See [ADR 0007](adr/0007-natural-language-config.md).

---

## Why Bun and not Node?

Covered in [ADR 0001](adr/0001-bun-runtime.md). TL;DR: one tool, built-in SQLite and WebSocket, fast test runner, same npm ecosystem. Published packages still run on Node.

---

## Is the dashboard required?

No. `chronicle run` + `chronicle watch` cover the full loop in terminal-only mode. The dashboard is for when you want to see the characters move and hear them speak (or send the link to a friend).

---

## How do I share a Chronicle with someone?

```bash
chronicle export my-world --out dinner-party.chronicle
# send that file anywhere
chronicle import dinner-party.chronicle
chronicle replay dinner-party
```

The replay is deterministic given the same RNG seed and the same LLM model versions. If the model provider updates, replays may diverge; Chronicle records model IDs in snapshots so you can tell.

---

## Can I write my own scenarios? How?

Yes — it's the highest-value contribution. See `docs/SCENARIO_DESIGN.md` and `.github/ISSUE_TEMPLATE/scenario.yml`. The happy path is:

1. Write `my-scenario.chronicle.md` (Markdown with World / Characters / Rules sections).
2. `chronicle create-world --from my-scenario.chronicle.md`.
3. `chronicle run <world-id> --ticks 100 --seed 42` a few times.
4. If the drama scores look right, open a PR adding it to `examples/`.

---

## Is this safe to run unattended?

For single-operator local runs: yes. For multi-tenant or publicly-exposed deploys: you need to think about per-user budget caps, content moderation, and rate limits. See [SECURITY.md](../SECURITY.md).

The default threat model assumes the operator trusts the scenarios they write. Agent outputs (LLM text) are treated as untrusted — Chronicle sanitizes before displaying and never executes them.

---

## What if I find a bug?

For security issues: `security@chronicle.sh`. Everything else: [file an issue](https://github.com/chronicle-sh/chronicle/issues/new/choose).

---

## What's on the roadmap?

See [`docs/ROADMAP.md`](ROADMAP.md). Highlights for the next few milestones:

- v0.2: real sprite art instead of colored circles; multi-location map layouts.
- v0.3: highlight-reel auto-generation (gazette tab → short video).
- v1.0: API stability guarantee; fork semantics finalized.

Memory is deliberately NOT on this list: we run a file-backed,
agent-curated markdown memory per character (hermes-agent pattern) —
no embeddings, no vector store, no retrieval scoring.

---

## Can I contribute?

Yes, please. See [`CONTRIBUTING.md`](../CONTRIBUTING.md). Best first contribution: a new example scenario with test runs showing median drama ≥ 6.0.
