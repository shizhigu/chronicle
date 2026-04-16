# 0011. Claude Code integration — mid-run edit commands + CC skill

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Chronicle's design premise (see ADR-0007) is that natural language is
the primary authoring surface. A user describes a world in prose,
the world-compiler expands it, a simulation runs, and the user
watches. That works for creation.

What has been missing until now is **continuous authorship during a
run**. A common user story:

> Alice sits in Claude Code, creates a parlor-drama world, watches
> agents bicker for 20 ticks, decides "I want Carol to turn more
> scheming now." She types her intent in CC. CC figures out what
> needs to change, calls chronicle, the change lands on the next
> tick, Alice keeps watching.

Today that loop breaks after creation. We have:

- `chronicle create-world` — natural language in → compiled world
- `chronicle run` — simulate ticks
- `chronicle intervene --event "..."` — narrative injection (flavor,
  no mechanical effect)
- `chronicle dashboard` — watch

There is no command to mechanically change an agent's persona, add
a rule mid-run, alter a character's mood, grant authority to an
upstart, or otherwise *restructure* the live world. Users who want
this must stop, edit JSON in the DB, and resume — a jarring break in
the "keep narrating and watch it happen" loop we promised.

Layer 2's EffectRegistry solves the mechanical half: we have 14
typed effects that mutate world state and the GodService can route
compiled effects into the tick loop. What remains is (a) CLI
commands that take user intent and queue the right effect, and
(b) a CC skill so Claude Code recognises "this user wants to change
a running chronicle" and knows which command to call.

## Decision

Two deliverables.

### 1. `chronicle apply-effect <worldId> --json <effect>`

Universal escape hatch. Accepts one Effect JSON (or an array via
`--json-array`) on the command line, queues it as a god
intervention whose `compiledEffects.effects` carries the payload.
The engine's existing tick loop picks it up on the next tick; no
new apply path.

```
chronicle apply-effect chr_abc123 --json '{
  "kind": "assign_role",
  "groupId": "grp_council",
  "roleName": "chair",
  "agentId": "agt_carol"
}'
```

CC can always compose an effect JSON from natural language and fall
back to this command when no ergonomic wrapper exists. No new
mechanics — just a thin CLI layer on top of the god/effect pipeline.

### 2. `chronicle edit-character <worldId> <nameOrId> --persona ... --mood ... --private-state '<json>' --traits '<json>'`

Ergonomic wrapper over the new `update_agent` effect kind. Most
"change a character" commands fit this shape — it's the single
most common edit and deserves a nice CLI.

```
chronicle edit-character chr_abc123 Carol \
  --mood anxious \
  --persona "Carol has grown paranoid; she trusts no one..." \
  --private-state '{"secret":"she is planning to flee"}'
```

Each flag is optional; provided flags populate the `update_agent`
effect. Queued same way as `apply-effect` — routed through god
intervention with a single-effect compiled payload. No new apply
path.

### 3. New Effect kind: `update_agent`

```ts
{
  kind: 'update_agent';
  agentId: string;
  persona?: string;
  mood?: string | null;
  privateState?: Record<string, unknown> | null;
  traits?: Record<string, number | string | boolean>;
}
```

Validates the agent exists and lives in the current world. Executes
a partial update via the store. A `null` value for `mood` /
`privateState` explicitly clears; an omitted field leaves the value
untouched.

### 3b. Rule CLI family (added post-v1)

The `apply-effect` / `edit-character` pattern is extensible by design —
every time a single effect kind becomes a high-frequency CC request, we
graduate it to its own ergonomic command. The **rule family** did:

- `chronicle add-rule <worldId> --description "..." --tier hard --check "..." [--scope-kind group --scope-ref grp_x]`
- `chronicle remove-rule <worldId> <ruleId>`
- `chronicle list-rules <worldId>` (read-only)

Behavior:

- `add-rule` compiles a `create_rule` effect and queues it via
  `GodService` (next-tick application, same as every other edit
  command). All effect fields are exposed as flags; the common case
  ("add a law") is one line.
- `remove-rule` compiles a `repeal_rule` effect. Inviolable rules (the
  L0 safety set + any the scenario tagged) get rejected at validation
  time with a clear error, matching the existing EffectRegistry
  guard.
- `list-rules` is a direct store read — no effect, no queue — because
  CC often needs to enumerate rules before deciding which to repeal.
  Output is plain text for human inspection with optional `--json`
  for CC parsing.

No new ADR — this is a pure addition to the pattern already ratified
here. New ergonomic commands are a small-surface decision (new flags +
a NEXT_STEPS block); only when we add a fundamentally new effect-kind
or a new authorization surface does a fresh ADR become warranted.

### 4. CC skill at `.claude/skills/chronicle/SKILL.md`

Ships in the repo so users can symlink it into their CC skills
directory. Describes the CLI surface, NEXT_STEPS parsing convention,
and — most importantly — the decision table "user said X, call
command Y." This is what makes the natural-language loop feel
seamless in CC: the user says "make Carol paranoid" and CC knows to
run `chronicle edit-character`.

The skill is optional (users without it can still drive chronicle
manually) but transforms the UX for CC-centric users. Since skill
files are plain markdown under `~/.claude/skills/<name>/SKILL.md`,
we can ship it in the chronicle repo and document the install step.

## Non-goals

- **An LLM-backed "describe your change" command.** We briefly
  considered `chronicle edit --desc "make Carol paranoid"` that
  invokes an LLM to compile intent → effects. Defer. CC is already
  an LLM that can do this compilation client-side; adding a second
  path inside chronicle duplicates work and creates ambiguity.
- **Direct tick-loop injection.** `apply-effect` always queues via
  GodService, which applies on the NEXT tick. We don't add a
  synchronous "apply now" — it would bypass event ordering and
  break replay.
- **Authentication / authorization on edit commands.** This is a
  local CLI. Whoever can run `chronicle` can edit. Multi-tenant
  hosting is a separate concern (ADR-TBD).

## Composition with prior work

- **Uses EffectRegistry (ADR-0009 Layer 2)** unchanged; we only add
  the new `update_agent` handler.
- **Uses GodService** unchanged; it was already the compiled-effects
  executor and god interventions were always supposed to be
  structural, not narrative.
- **Preserves ADR-0007** (natural language is primary authoring):
  the user experiences this as natural language; the structured
  CLI is a CC-facing contract, not the user-facing interface.
- **Preserves replay determinism:** effects are applied within the
  normal tick loop, recorded as events, replayable.

## Consequences

### Positive

- **Closes the loop CC users actually want.** User → CC → chronicle
  → dashboard → user, with natural language at both ends.
- **Universal escape hatch exists** (`apply-effect`), so any Effect
  we add in the future is immediately CLI-reachable without
  needing a bespoke wrapper.
- **CC skill cements the idiom** — other tools that adopt Chronicle
  can mimic the pattern (structured commands + NEXT_STEPS +
  optional skill file).

### Negative

- **Small API surface growth.** Two new commands, one new effect.
  Maintenance burden is low because they route through existing
  pipelines.
- **JSON-on-CLI ergonomics are mediocre** for `apply-effect` in a
  raw shell. CC users paste valid JSON, so it works for them; a
  human typing it by hand will hit quoting issues. Documented;
  acceptable.

### Neutral / accept

- **Edit commands apply on next tick, not instantly.** Matches god
  interventions. Users who expect "change now, see now" will wait
  one tick. Documented in NEXT_STEPS output.

## Implementation plan

1. Add `update_agent` to Effect union (core/types.ts).
2. Implement `update_agent` handler in EffectRegistry.
3. Extend `store.updateAgentState` to accept persona / mood /
   privateState / traits.
4. New command file `packages/cli/src/commands/apply-effect.ts`.
5. New command file `packages/cli/src/commands/edit-character.ts`.
6. Register both in `packages/cli/src/index.ts`.
7. Create `.claude/skills/chronicle/SKILL.md` in the chronicle repo.
8. Tests: update_agent effect (happy/sad), both CLI commands,
   round-trip through a small Engine.run.
9. Code-reviewer subagent.

## Revisit triggers

- More than 3 edit commands get proposed in short succession — then
  rethink and expose a more general API.
- CC users report JSON-on-CLI pain for `apply-effect` — build the
  LLM-backed `chronicle edit --desc` we deferred.
- Dashboard surfaces a "what changed this tick" panel — the event
  stream from god_intervention + proposal_adopted already has the
  data; presentation is the work.
