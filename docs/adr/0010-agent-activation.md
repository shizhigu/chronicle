# 0010. Agent activation model — deterministic pre-filter + voluntary pass

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Before today, the engine's tick loop unconditionally called `takeTurn`
on every live agent every tick. With N agents over T ticks, the LLM
bill is O(N·T) — no matter whether anything relevant to a given agent
happened. For a political world with an 8-seat council running 500
ticks, that's 4,000 prompted turns even if most of them would just be
"nothing is happening, I think I'll say hello."

Three problems fall out:

1. **Token cost grows linearly** with cast and runtime. A 20-agent
   world with a reasonable cloud model rapidly becomes unaffordable
   for anyone without institutional funding.
2. **Narrative pacing degrades.** Agents forced to act every tick
   fill dead air with filler — repetitive small talk, redundant
   inner monologue. Real people go quiet. Fictional people should
   too.
3. **Pi-agent conversation history bloats.** Every turn appends to
   the session's messages. Forced low-signal turns inflate context
   windows and later turns suffer for it.

We want a way to **let agents be silent when nothing warrants their
attention**, without sacrificing the spontaneity that gives
emergence its flavor.

## Decision

The engine runs a **deterministic pre-filter** before each tick's
batch of `takeTurn` calls. Agents the filter decides "shouldn't
activate" are skipped for this tick — no LLM call, cheap
`agent_dormant` event emitted, tick loop continues. Agents the filter
activates run the normal turn flow.

Activation is decided by observable, cheap signals only. No ML, no
LLM judge in this layer — that would defeat the purpose. The filter
is open for replacement via the `AgentActivation` interface, so a
researcher or power user can swap in a smarter implementation, but
the default is the one in `ActivationService`.

In parallel, agents gain a new tool `pass(reason)`: a deliberate
"I see the prompt, I choose to do nothing" action. Unlike
engine-initiated dormancy, `pass` costs a full turn — the agent
was given the floor and declined. This preserves agency for
"I'm listening but have nothing to add" moments, which matter
narratively.

### The signals

A signal is anything that would reasonably pull a real character's
attention into this tick. Five at MVP, all cheap:

| Signal                    | Meaning                                                        |
|---------------------------|----------------------------------------------------------------|
| **witnessed_event**       | An event in the last `lookbackTicks` window is visible to this agent (event's `visibleTo` includes them, or it's public at their location). |
| **directed_speech**       | A speech event in the last tick is targeted at this agent (whisper to them, or their name appears in the content of a broadcast). Subset of witnessed_event but weighted higher conceptually; same result. |
| **pending_group_vote**    | A proposal is pending in a group the agent belongs to, and the agent has not yet cast a vote. |
| **idle_timeout**           | `tick - agent.lastActiveTick >= idleTimeout`. Keeps lonely agents from going silent forever — gives them periodic prompts to act. |
| **first_tick**             | The agent has never acted (`lastActiveTick === null`). First exposure to the world deserves at least one turn. |

If ANY signal fires, the agent is active. Else dormant.

Signals are intentionally *cheap* — a small number of DB queries per
agent, all indexed. A 20-agent world's activation pass is O(20) DB
round-trips; a full `takeTurn` is one LLM call (potentially seconds
and thousands of tokens). Even saving 30% of turns is enormous.

### Dormancy is an event, not absence

When an agent is skipped, the engine records an
`agent_dormant` event:

```json
{
  "eventType": "agent_dormant",
  "actorId": "agt_alice",
  "tick": 42,
  "data": { "reason": "no_signal" }
}
```

This matters for three things:

1. **Replay**: a replayed world knows who was actually silent vs.
   asleep on a bug. The event log is the truth.
2. **Dashboards**: the political-map view can grey out dormant
   agents this tick rather than fall back to "unknown state."
3. **Downstream services**: ReflectionService might notice an agent
   has been dormant for 20 ticks and prod them for reflection on
   the same schedule.

### The `pass` tool

```ts
pass({ reason?: string })
```

Agent-facing surface. Unlike engine-initiated dormancy, a `pass` call
*does* consume a turn:

- The LLM saw the prompt, reasoned, and chose to pass.
- Pi-agent's session history records the pass as a tool_use.
- Engine logs an `action` event with `actionName: 'pass'`.
- `lastActiveTick` stamps just like a normal action.

This preserves the ability to say "I'm aware of the conversation; I
have nothing to contribute" — a distinctly human behavior that
deserves a distinct mechanical expression. It is NOT the same as
engine dormancy. Both exist.

### Default config

```ts
world.config.activation = {
  idleTimeout: 5,      // ticks — force a turn if silent this long
  lookbackTicks: 2,    // how far back to scan for events that might activate
}
```

Per-world overridable. Tests may override via an injected
`AgentActivation` to deterministically choose who activates.

## Composition with prior layers

- **Memory** (ADR-0009 is memory? no, memory is separate) — unchanged.
  The system prompt snapshot is still built at session hydration,
  independent of activation.
- **Governance (ADR-0009)** — pending votes are an explicit activation
  signal. An agent in a deliberating council will not go dormant
  until they've cast a vote on every live proposal in their groups.
- **ReflectionService** — reflections still trigger on
  `reflectionFrequency` regardless of activation. Reflection is
  about long-horizon memory, not per-tick action, so it operates on
  its own cadence.
- **RuleEnforcer** — nothing to do; rules evaluate on actions and a
  dormant agent produces no action.

## Consequences

### Positive

- **Linear cost reduction.** For a typical multi-agent world the
  activation rate should land near 30-50% at steady state; that's a
  2-3x reduction in LLM spend for the same simulation time.
- **Better pacing.** Dead-air ticks look like dead air in the log,
  not like filler. Dashboards and export `.chronicle` files become
  more readable.
- **Composability.** The `AgentActivation` interface is simple
  enough that a researcher adding ML-based prediction of relevance
  can plug in without touching the tick loop.

### Negative

- **First-time shock.** Users accustomed to the "everyone talks
  every tick" behavior will see long gaps. We mitigate by showing
  `agent_dormant` events in the dashboard as grey pulse, so the
  audience sees characters are alive, just quiet.
- **Signal coverage gaps.** Our MVP signals miss some legitimate
  cases — e.g. an agent standing next to a quiet meaningful object
  might want to "do something" even without an event. Covered by
  `idleTimeout` giving them a periodic floor.
- **Replay determinism demand.** The activation filter must be
  deterministic; any source of randomness in signal evaluation
  breaks replay. We enforce this by making the filter a pure
  function of (agent, world, recent events, memberships, votes)
  — no Date.now(), no Math.random().

### Neutral / accept

- **Agents may game `pass`**. Nothing stops an LLM-driven agent
  from calling `pass` every turn and never contributing. That's
  in-world behavior and the soft-rule judge can flag it. We do not
  restrict `pass` frequency at the engine level.

## Non-goals

- **ML-based activation prediction.** Future work, not MVP.
- **Reactive-only mode** (agents only act when "poked"). Our MVP
  still allows idle-timeout wake-ups so the world doesn't freeze.
  Reactive-only is a world-config preset users can choose by setting
  `idleTimeout = Infinity`, once that's safely tested.
- **Per-agent learning of "I care about X".** The signal set is
  world-level. Per-agent preferences over activation would need a
  LLM evaluator and break the "cheap" constraint.

## Implementation plan

Single milestone:

1. Add `Agent.lastActiveTick` + backing column.
2. Add `WorldConfig.activation` with defaults.
3. Implement `ActivationService.shouldActivate(agent, tick)`.
4. Engine `runSingleTick` wraps `takeTurn` in the pre-filter, emits
   `agent_dormant` on skip, stamps `lastActiveTick` on success.
5. Add `pass` core tool.
6. Extend `EventType` with `agent_dormant`.
7. Tests: signal coverage (each signal alone activates, none →
   dormant), idle timeout, end-to-end cost reduction on a smoke run.

## Revisit triggers

- Dormancy rate exceeds 80% for multi-tick runs (too quiet — raise
  signal weight or lower idleTimeout).
- Dormancy rate below 10% (pre-filter not saving enough — tighten
  signal rules).
- A scenario where an agent's narrative arc requires proactive
  behavior with no external triggers (add a goal-driven signal).
