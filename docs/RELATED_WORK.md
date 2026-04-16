# Related work

This is a landscape map for contributors. If you are evaluating Chronicle against a specific prior system or paper, start here. For what we think our real differentiators are, see [DIFFERENTIATION.md](DIFFERENTIATION.md).

---

## The four well-known adjacent systems

### A. Generative Agents (Stanford Smallville)

- Paper: [arXiv:2304.03442](https://arxiv.org/abs/2304.03442)
- Repo: (research prototype; forks on GitHub)
- What it demonstrated: memory retrieval (recency × importance × relevance), periodic reflection, hierarchical planning — produce "believable" human-like social behavior at small scale (25 agents in a town).

**What we borrow from it.** The memory / reflection / planning triad is basically our `MemoryService` / `ReflectionService` / per-tick planning loop. The importance-weighted retrieval is how our `MemoryService.retrieveRelevant` ranks candidates.

**Where we diverge.** Smallville's rules are implicit in prompts; ours compile to a typed DSL (see [ADR-0005](adr/0005-three-tier-rules.md)). Smallville is a specific demo; Chronicle is a framework.

### B. AI Town (a16z starter kit)

- Repo: [github.com/a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)
- What it is: A deployable starter kit — Convex backend, TypeScript, multiplayer-ready, rich canvas. Aimed at developers building a product.

**What we borrow.** The event-driven canvas idea — streaming events drive sprite updates — is similar in spirit to our `MapCanvas` + `WebSocketBridge` combination, though our canvas is intentionally simpler (emoji sprites, atmospheric tint, not a full game world).

**Where we diverge.** AI Town assumes Convex and a deploy step; Chronicle runs on a single SQLite file with no server required. AI Town authoring is TypeScript; Chronicle authoring is Markdown. AI Town is "town on the Internet"; Chronicle is "any scenario on your laptop."

### C. Concordia (DeepMind)

- Tech report: [arXiv:2312.03664](https://arxiv.org/abs/2312.03664)
- Repo: [github.com/google-deepmind/concordia](https://github.com/google-deepmind/concordia)
- What it is: A Python research library for generative agent-based modeling. Introduces a "Game Master" (GM) pattern — agents propose natural-language actions, the GM decides what actually happens in the world.

**What we borrow.** The GM pattern is close to our `RuleEnforcer` with `beforeToolCall` / `afterToolCall` hooks. The agent proposes; the enforcer accepts / rejects / auto-corrects based on compiled rules.

**Where we diverge.** Concordia is a library for research scaffolding; Chronicle is a product with a CLI. Concordia's agents are Python objects; ours are pi-agent instances backed by persistent session state. Concordia runs agent logic from Python; Chronicle is TypeScript-native on Bun.

### D. AgentSociety

- Paper: [arXiv:2502.08691](https://arxiv.org/abs/2502.08691)
- Repo: [github.com/tsinghua-fib-lab/AgentSociety](https://github.com/tsinghua-fib-lab/AgentSociety)
- What it is: Urban-scale social simulation with 10k agents and ~5M interactions. Research platform for social-behavior research.

**What we borrow.** The demonstration that LLM-agent simulations can scale past a few dozen agents — instrumentation and event-stream ideas carry over.

**Where we diverge.** AgentSociety targets research on urban / population phenomena; Chronicle targets *any* scenario a user can describe. We don't compete on scale — our sweet spot is 3–30 agents where drama emerges naturally from tight constraints.

---

## Thematic research directions we track

### E. Evaluation / process fidelity

There's a growing thread saying "outcome-fidelity isn't enough — we should measure whether the *process* of an LLM-driven simulation resembles real social dynamics." Chronicle has heuristic drama scoring today; serious process-fidelity evaluation is on the roadmap ([METRICS.md](METRICS.md)). Worth tracking as this research area matures.

### F. Governance / cooperation / leadership

Papers exploring whether electing leaders, setting up committees, or introducing shared norms improves cooperation in LLM multi-agent settings. Chronicle's soft-rule tier and god-intervention queue are primitives that could host experiments in this direction; we don't currently publish opinionated defaults.

### G. Reasoning-model fit for behavior simulation

An empirical result worth heeding: reasoning-capable models don't always improve *social* simulation quality, because simulation often wants bounded-rational sampling rather than optimal solving. Chronicle's cost model ([COST_MODEL.md](COST_MODEL.md)) already assumes cheaper per-turn models are fine; we use stronger models only for reflection cycles. This design aligns with the finding.

### H. Long-horizon coherence

Runs past a few hundred ticks tend to drift: agent memories start contradicting, narrative arcs collapse, relationships lose history. This is a real, hard research problem. We have reflection + importance-weighted retrieval as partial mitigations. Full solutions (narrative-aware memory, hierarchical summarization, spatial-temporal grounding) are open.

### I. The "primitive-first civilization substrate" direction

A speculative research ambition: emerge institutions (markets, laws, hierarchies, religions) from primitive operators (resource, capability, sanction, transmission). To our knowledge, no working system has demonstrated this at scale. It's an intellectually appealing direction but requires solving long-horizon coherence first.

**Chronicle is explicitly not this project.** We are scenario-first drama, not civilization-from-primitives. If you want to explore that direction, see this section's references — but building it on top of Chronicle would be a much bigger research project than we're committing to.

---

## The honesty table

What we're good at vs. what existing systems are good at:

| Concern | Best existing answer | Chronicle |
|---|---|---|
| "Believable social behavior" | Smallville | Equal — we copied the triad |
| "Playable deployable town" | AI Town | AI Town is better at this |
| "Grounded agent actions" | Concordia | Equal — GM = RuleEnforcer |
| "Urban-scale (10k+) sim" | AgentSociety | AgentSociety wins |
| "Rules as deterministic constraints" | — | **Chronicle (our DSL tier)** |
| "CLI + AI-agent-friendly onboarding" | — | **Chronicle** |
| "One file = one shareable sim" | — | **Chronicle (`.chronicle`)** |
| "Local + private by default" | — | **Chronicle** |
| "Scenario authoring in prose (incl. rules)" | — | **Chronicle** |
| "Research paper publication" | Smallville / Concordia | They win; we're a product |

If your job lies in the last five rows, Chronicle is the right choice. If it's in the top four, look at the named systems first.

---

## What we don't claim

- We are not a civilization substrate, not a social-science research tool, not a multi-agent RL environment.
- Our drama scoring is heuristic, not a validated social-process measure.
- Our long-horizon coherence is state-of-the-art-for-2026-open-source, not state-of-the-art-period.
- We are pre-1.0 and APIs may shift before we commit to semver.

---

## Contributing new references

If you find a relevant paper or system we've missed, open a PR against this file. Keep the tone honest — praise where earned, differentiation where real, "we don't compete here" where true. We will refuse marketing-tone inserts.
