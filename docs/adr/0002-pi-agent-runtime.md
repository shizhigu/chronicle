# 0002. Use pi-agent as the LLM-agent runtime (not Claude Agent SDK)

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Chronicle simulates worlds populated by LLM-driven characters. Each character is an agent with its own memory, tools, and persona. We need an agent runtime that:

1. Lets us **pin one LLM session per character** so that "the same agent" means "the same context" — not a new chat every tick.
2. Is **model-agnostic**: today's Anthropic, tomorrow's OpenAI, next week's local LM Studio — users must not be locked in.
3. Supports **tool-call interception** so our rule enforcer can validate proposed actions *before* they mutate world state (hard rules as DB constraints, plus pre-check hooks).
4. Streams events / partial tool calls so the dashboard can render "Alice is thinking…" in real time.
5. Is **TypeScript-native** so it composes with our monorepo without a Python subprocess.

## Decision

Use **[`@mariozechner/pi-agent-core`](https://github.com/badlogic/pi-mono)** (pi-agent) as the agent runtime, wrapped behind our own `AgentRuntimeAdapter` interface so the dep can be replaced if needed.

Each character in a simulation owns one long-lived `Agent` instance from pi-agent. Our `packages/runtime/src/agent-pool.ts` manages the pool. We hook into `beforeToolCall` to route actions through the rule enforcer, and `afterToolCall` to emit events onto the bus.

## Rationale

- **Stateful by design.** pi-agent's `Agent` class caches a `sessionId` so the underlying LLM provider (via `@mariozechner/pi-ai`) reuses its context window across turns — exactly the "same agent, same memory" property we need.
- **Model-agnostic through `pi-ai`.** The same runtime transparently targets Anthropic, OpenAI, Google, Ollama, LM Studio. We do not want to commit users to a single vendor.
- **Small surface area.** pi-agent is a few hundred lines of focused TypeScript; we can read it end-to-end, fork if required, and it has no transitive dependency bomb.
- **Native hooks.** `beforeToolCall` / `afterToolCall` map 1:1 to what the rule enforcer needs.
- **License & governance.** MIT, maintained by a single author we can engage with directly; suitable for an OSS framework to depend on.

## Alternatives considered

- **Claude Agent SDK.** First-class support, excellent docs, but ties us to Anthropic. Users who want to simulate with GPT-4o or a local Llama cannot. That violates our "model-agnostic" requirement.
- **Pydantic AI.** Best-in-class ergonomics, but Python — would split our monorepo runtime in two, force a Python subprocess from the CLI, and drag in a second dependency ecosystem.
- **Hand-rolled agent loop on top of pi-ai.** We would own more code and more bugs. pi-agent already solved the looping-over-tool-calls part well; we do not need to redo it.
- **LangChain / LangGraph.** Heavier, more layers of abstraction, and historically less stable API surface than we want to build on.

## Consequences

### Positive
- Agents are model-agnostic out of the box; swapping providers is a config change, not a rewrite.
- The `AgentRuntimeAdapter` seam means if pi-agent ever diverges from our needs, we can slot a different implementation in without ripping out callers.
- Unit tests in `packages/runtime/test/` can mock the adapter; pi-agent is dynamically imported so tests do not need the real LLM.

### Negative
- **Single-maintainer dependency risk.** pi-agent is primarily maintained by one author. We mitigate by: (a) pinning a known-good version, (b) reading and understanding the code, (c) being ready to fork.
- **Smaller community** than Claude Agent SDK or LangChain — less Stack Overflow coverage.

### Neutral / accept
- We use `@mariozechner/pi-ai` as an indirect dependency (via pi-agent) for model calls in the compiler too, which gives us a consistent abstraction across the stack.

## Revisit triggers

- pi-agent goes unmaintained for 6+ months with no release cutting critical bug fixes.
- A standard agent protocol (like Model Context Protocol) matures enough that building directly on it is simpler than going through a wrapper.
- Our tool-call hooks need something pi-agent cannot do and the author declines to accept a PR.

## Fork vs. depend — explicit criteria

pi-agent is pre-1.0 (version 0.67.x at time of writing) and maintained primarily by a single author. We keep the dependency **external** as long as:

1. Releases continue at their historical cadence (several per month).
2. Breaking changes arrive with migration notes we can adopt within a week.
3. The MIT license remains.
4. `beforeToolCall` / `afterToolCall` / `subscribe` / `sessionId` contracts stay compatible.

We **fork** to `@chronicle/pi-agent-fork` only if two or more triggers fire:

| Trigger | Threshold |
|---|---|
| No upstream release | 6 months AND a critical bug affecting us is open |
| Breaking API change | rejects our migration path AND we cannot work around it |
| License change | away from MIT / Apache 2.0 / BSD |
| Internal surgery required | we need to patch internals and a PR is declined for 30 days |
| Security advisory upstream | unaddressed for 14 days |

**Hedges in place today:**

- `AgentRuntimeAdapter` interface (`packages/engine/src/engine.ts`) — pi-agent is only referenced through the `AgentPool` that implements this interface. Replacing the backend is a single-package swap, not a codebase rewrite.
- Version pinned to `~0.67.3` in `packages/runtime/package.json` and `packages/compiler/package.json` — patch bumps auto-apply; minor bumps get review.
- Dynamic import inside `loadPi()` — unit tests run without the dep installed, so we are never held hostage by a single upstream release that breaks test setup.
- Integration test coverage exercises the pi-agent interface shape; an upstream breaking change is caught in CI rather than in production.

## Related

- [`docs/AGENT_RUNTIME.md`](../AGENT_RUNTIME.md) — the full design of the agent runtime.
- [0005. Three-tier rule system](0005-three-tier-rules.md) — why `beforeToolCall` is load-bearing.
