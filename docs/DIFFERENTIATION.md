# What makes Chronicle different

Chronicle is in the lineage of generative-agent social simulation (Smallville, AI Town, Concordia, AgentSociety). This document is an honest account of where we overlap with those systems and where we're genuinely different — written by reading our own code, not from a marketing brief.

If you're evaluating whether to build on Chronicle or one of the related projects, this page should let you make that call in a few minutes.

---

## Related systems, briefly

| System | What it is | Where it shines | Where it's thin |
|---|---|---|---|
| **Generative Agents (Smallville)** [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) | Stanford research prototype — 25 agents in a small town, observation / reflection / planning | The canonical demonstration that "LLM + memory + reflection" produces believable social behavior | Research code; tied to OpenAI; hard to run outside the lab |
| **AI Town** [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) | Deployable starter kit — a town, multiplayer, real-time canvas | Great if your endpoint is a deployed playable | Opinionated on Convex backend; scenario-editing requires TS code |
| **Concordia** [DeepMind](https://github.com/google-deepmind/concordia) | Research library — generative agents with grounded actions via a "Game Master" | Strong grounding abstraction, component-based cognition | Python research library; building a product on it requires scaffold code |
| **AgentSociety** [arXiv:2502.08691](https://arxiv.org/abs/2502.08691) | Urban-scale (10k agents) social simulation | Proves LLM-agent sims scale into the thousands | Heavy infra; research-grade; urban realism ≠ storytelling |

We treat all four as prior art we've learned from. None of them is the same product as Chronicle.

---

## The seven real differentiators

Each item below is **implemented in the repo today** — not a roadmap entry.

### 1. CLI-first, designed to be operated by an AI agent

The primary interaction model is:

```
user in Claude Code / Cursor / Codex
  → "install Chronicle and make me a world about a dinner party"
  → the AI agent reads our README + NEXT_STEPS blocks
  → runs `bun install && chronicle onboard && chronicle create-world --desc "..."`
  → never asks the user a GUI question
```

Every command emits a machine-readable `NEXT_STEPS ... END_NEXT_STEPS` block (`packages/cli/src/output.ts`) with instructions the calling agent can follow. This is built in, not bolted on.

No other system in the lineage was designed for this. Smallville / Concordia / AgentSociety all assume a human opens a notebook. AI Town assumes a human deploys and clicks.

### 2. Natural-language all the way down, including rules

Every authoring surface accepts prose:

- **World description** → compiled to `CompiledWorld` (Zod-validated) via `@chronicle/compiler`
- **Character personas** → prose, stored verbatim
- **Rules** → natural-language strings, compiled to one of three tiers (hard / soft / economic) — see [ADR-0005](adr/0005-three-tier-rules.md)
- **God interventions** → prose, applied as events
- **System prompts** → prose, shared across characters

Crucially, the **rules layer** is prose-compiled. "Only living characters can speak" becomes a DSL predicate `character.alive` that the engine enforces before an action mutates state. The compiler validates the emitted DSL against the runtime parser on every rule and retries with error feedback if malformed (`packages/compiler/src/rule-compiler.ts`). The invariant is enforced by test: whatever lands in the `rules` table is guaranteed to parse at runtime.

AI Town and Concordia let you author characters in prose but not rules. Smallville's "rules" are implicit in the characters' prompts.

### 3. `.chronicle` files — forkable, shareable simulations

Each world is a single SQLite file (event-sourced — see [ADR-0003](adr/0003-sqlite-event-sourced.md)). Operations:

```
chronicle export <worldId> --out dinner-party.chronicle   # one file
chronicle import dinner-party.chronicle                   # copies into local DB
chronicle fork <worldId> --at-tick 42 --desc "change"     # branch at any tick
chronicle replay <worldId>                                # deterministic with seed
```

This gives the project a **shareable artifact** — analogous to `.blend` (Blender), `.ipynb` (Jupyter), or Factorio blueprint strings. A link to a `.chronicle` file on Twitter carries more than a GitHub repo URL does.

No other system in the lineage treats "a simulation" as a first-class, portable file.

### 4. Three-tier rule system with a safe DSL

Rules compile to one of three enforcement tiers ([ADR-0005](adr/0005-three-tier-rules.md)):

- **Hard rules** — deterministic predicates evaluated by our in-process DSL parser. No `eval`. Whitelist of methods. Full grammar documented in [ADR-0008](adr/0008-dsl-grammar-scope.md); ~50 tests in `packages/engine/test/predicate*.test.ts`.
- **Soft rules** — LLM-judge post-action; drives relationship / reputation deltas.
- **Economic rules** — arithmetic cost formulas applied pre-action.

The DSL supports arithmetic, `in` for array/substring membership, dynamic bracket indexing, chained methods on strings/arrays, null-safe path traversal. It is **demonstrably uncrashable** on any input — 1000-sample random-expression test in `predicate-stress.test.ts`.

A rule like "the target of an insult must be in the same room" becomes real enforcement — not a hope that the LLM remembers.

### 5. Model-agnostic as a default state, not a marketing claim

`chronicle onboard` probes eleven providers (`packages/cli/src/providers.ts`):

- Local: LM Studio, Ollama
- Cloud: Anthropic, OpenAI, Google (AI Studio), OpenRouter, Mistral, Groq, GitHub Copilot, Vercel AI Gateway, Azure OpenAI

It **does not auto-pick** — the CLI outputs the list and lets the user (or their agent) choose. No provider is privileged; no brand is hardcoded. Config ships empty (`defaultProvider: ''`). Tests lock this invariant — prose output cannot contain "Chronicle picked X" or "starting default" language.

All of this routes through pi-agent ([ADR-0002](adr/0002-pi-agent-runtime.md)), so swapping between local and cloud is a one-line config change.

### 6. Bun-native, one-command install

```bash
curl -fsSL https://bun.sh/install | bash    # 5s
bun install                                  # 15s
chronicle onboard                            # < 1s
chronicle create-world --desc "..."          # depends on LLM
```

No Python install, no `pip`, no build tools, no Convex account, no Docker. Bun's built-in SQLite, WebSocket server, and test runner remove an entire class of setup friction ([ADR-0001](adr/0001-bun-runtime.md)).

### 7. Local-first + private-first is the default path

LM Studio and Ollama work out of the box. If you use them, **no data leaves your machine** — the whole pipeline runs on device.

This matters materially for:
- Writers with unpublished manuscripts that include sensitive content
- Educators (can't ship student data to third-party APIs)
- Enterprises running internal scenarios
- Researchers under IRB review
- Users in jurisdictions with data-residency constraints

Every other system in the lineage makes a cloud API the default.

---

## Where we explicitly don't compete

- **"Civilization from primitives" research agenda.** We're not trying to emerge `market` / `law` / `religion` from atomic `resource` / `agreement` / `sanction` primitives. That's a research direction (mostly unexplored, per [RELATED_WORK.md](RELATED_WORK.md) §D). Chronicle is scenario-first storytelling + drama, not bottom-up civilization emergence.
- **10k-agent urban simulation.** AgentSociety does that well and we're not competing on scale.
- **3D animation fidelity.** Our rendering is intentionally a diorama — emoji + speech bubbles + atmospheric tint. Concordia has no canvas; AI Town has a rich game world. We sit in between on purpose.

---

## Why this set of differentiators might spread

1. **AI-augmented developer channel**: In 2026, writers / scenario designers / researchers already live in Claude Code / Cursor / Codex. Our CLI-first + NEXT_STEPS design lands in that distribution channel natively.
2. **`.chronicle` as a viral object**: A simulation file is more tweetable than a code repo. Highlight reels (gazette / whispers tabs) are ready-made content.
3. **Zero-cost path with LM Studio**: We remove the single biggest adoption barrier for hobbyists and students.
4. **MIT + no vendor lock-in**: standard open-source expectations.
5. **Batteries included**: compiler, DSL, canvas, dashboard, export, fork — a complete workflow from prose to replayable video, not a research library you assemble.

These advantages compound because each one lowers a distinct barrier (access to AI, authoring difficulty, cost, privacy, distribution). Tools that combine *several* access-lowering levers tend to cross mainstream adoption faster than tools with one dominant lever.

---

## Further reading

- [RELATED_WORK.md](RELATED_WORK.md) — honest landscape map of prior art
- [PRODUCT.md](PRODUCT.md) — product positioning details
- [`docs/adr/`](adr/) — all architectural decisions with alternatives considered
