---
name: chronicle
description: Create, observe, and reshape Chronicle simulations — multi-agent narrative worlds where typed actions, rules, groups, and authority produce emergent political drama. Invoke when the user wants to create a scenario ("imagine a world where..."), watch it unfold, or change a running world mid-flight ("make Carol paranoid", "the council should meet", "add a new rule"). Does NOT handle non-chronicle tasks.
---

# Chronicle skill

Chronicle is a local multi-agent simulation framework. Users describe
worlds in natural language; an LLM compiles them into typed entities
(agents, locations, rules, groups, actions); the engine runs ticks and
characters act autonomously, constrained by rules and authority
structures. Users watch events stream in a dashboard and can edit the
live world at any time.

**Your job in Chronicle tasks**: translate user intent into the right
`chronicle` CLI command(s). Always consume the `NEXT_STEPS` block in
the command output — it tells you what to suggest the user do next.

## When to invoke

Invoke this skill when the user:

- Describes a scenario and wants to create a world
  (*"imagine a 1920s Paris salon where three poets compete for a
  patron's attention"*)
- Wants to run, pause, watch, or replay an existing world
- Describes a mid-run change to a live world:
  - character mood / persona / private state →
    `chronicle edit-character`
  - a new rule, location, group, authority, role, proposal, etc. →
    `chronicle apply-effect` with the right `Effect` JSON
  - narrative color ("a storm hits") with no structural change →
    `chronicle intervene --event "..."`
- Wants to see what's happening (`chronicle list`, `dashboard`,
  `watch`, `review`)

Do **not** invoke for generic software tasks unrelated to Chronicle.

## Command cheat sheet

| Intent | Command | Notes |
|---|---|---|
| Create a world from prose | `chronicle create-world --desc "..."` | LLM-compiles the description |
| List all worlds | `chronicle list` | |
| Run N ticks | `chronicle run <id> --ticks <N> [--live]` | `--live` streams events |
| Watch live (separate terminal) | `chronicle watch <id>` | Terminal tail |
| Open dashboard | `chronicle dashboard <id>` | Browser view |
| Narrative injection | `chronicle intervene <id> --event "A storm rolls in"` | Flavor only; no structural change |
| Edit a character | `chronicle edit-character <id> <nameOrId> --persona ... --mood ... --private-state '<json>' --traits '<json>'` | ADR-0011 |
| Add a rule | `chronicle add-rule <id> --description "..." --tier hard --check "..." [--scope-kind group --scope-ref grp_x]` | ADR-0011 §3b |
| Remove a rule | `chronicle remove-rule <id> <ruleId>` | ADR-0011 §3b — inviolable rules refused |
| List rules | `chronicle list-rules <id> [--json]` | read-only |
| List groups | `chronicle list-groups <id> [--json] [--include-dissolved]` | read-only |
| List locations | `chronicle list-locations <id> [--json]` | read-only |
| List agents | `chronicle list-agents <id> [--json] [--include-dead]` | read-only |
| Add a location | `chronicle add-location <id> --name "..." --description "..." [--adjacent "A,B"]` | ADR-0011 §3b |
| Add a group | `chronicle add-group <id> --name "..." --description "..." --procedure vote [--members "Alice,Bob"]` | ADR-0011 §3b |
| Grant authority | `chronicle grant-authority <id> --to-kind group --to-ref grp_x --powers '[{"kind":"override_rule","ruleId":"rul_y"}]'` | ADR-0011 §3b |
| Apply any Effect | `chronicle apply-effect <id> --json '<Effect>'` | Universal escape hatch; see Effect reference |
| Export a run | `chronicle export <id> --out <file.chronicle>` | |
| Import a `.chronicle` | `chronicle import <file.chronicle>` | |
| Fork at a tick | `chronicle fork <id> --at-tick <N> --desc "what's different"` | |
| Replay a recorded run | `chronicle replay <id>` | |
| Diagnostics | `chronicle doctor` | Check config + credentials |
| Credentials | `chronicle auth set <provider> --key <k>` | |

## Effect reference (for `apply-effect`)

An `Effect` is a typed structural change. Queue one (or several) via
`apply-effect` when the user wants something more than narrative.

The Effect kinds currently supported:

**Entity lifecycle**
- `create_location` — `{ name, description, adjacentTo?: string[], spriteHint? }`
- `create_group` — `{ name, description, procedure, procedureConfig?, visibility?, initialMembers? }` where `procedure ∈ decree | vote | consensus | lottery | delegated`
- `dissolve_group` — `{ groupId }`
- `create_rule` — `{ description, tier ∈ hard | soft | economic, predicate?, check?, onViolation?, softNormText?, economicActionType?, economicCostFormula?, scopeKind?, scopeRef? }`
- `repeal_rule` — `{ ruleId }`

(Note: `remove_location` is not yet supported — Layer 3 territory.)

**Membership & role**
- `add_member` — `{ groupId, agentId }`
- `remove_member` — `{ groupId, agentId }`
- `assign_role` — `{ groupId, roleName, agentId, votingWeight?, scopeRef? }`
- `vacate_role` — `{ groupId, roleName }`

**Authority**
- `grant_authority` — `{ holderKind ∈ group|agent|role, holderRef, powers: AuthorityPower[], expiresTick? }`
- `revoke_authority` — `{ authorityId }`

**Structural change**
- `change_procedure` — `{ groupId, newProcedure, newConfig? }`

**Resources**
- `transfer_resource` — `{ resourceId, toOwnerKind ∈ agent|location, toOwnerRef, quantity }`

**Agent mutation (ADR-0011)**
- `update_agent` — `{ agentId, persona?, mood?, privateState?, traits? }` — use when the user says "Carol is now paranoid" or similar; `mood: null` clears

## Decision table — common user phrases

| User says | You run |
|---|---|
| "Create a murder mystery on a cruise ship with 8 passengers" | `chronicle create-world --desc "..."` |
| "Run 30 more ticks" | `chronicle run <id> --ticks 30 --live` |
| "Show me what's happening" | `chronicle dashboard <id>` (or `watch`) |
| "Carol is getting paranoid" | `chronicle edit-character <id> Carol --mood paranoid --persona "..."` |
| "Have the council meet tomorrow" (narrative) | `chronicle intervene <id> --event "The council is called to session"` |
| "Form a council of the three elders" (structural) | `chronicle add-group <id> --name "Council" --description "..." --procedure vote --members "Elder1,Elder2,Elder3"` |
| "Make Bob the emperor" | `chronicle grant-authority <id> --to-kind agent --to-ref <bob_id> --powers '[{"kind":"override_rule","ruleId":"..."}]'` |
| "There should be a harbor east of town" | `chronicle add-location <id> --name "Harbor" --description "..." --adjacent "Town"` |
| "Add a law against theft" | `chronicle add-rule <id> --description "No theft" --tier hard --check "action.name != 'take'"` |
| "Kill the law about X" | `chronicle list-rules <id> --json` → grep for the rule → `chronicle remove-rule <id> <ruleId>` |
| "Start over from tick 10 with a twist" | `chronicle fork <id> --at-tick 10 --desc "..."` |
| "Share this with my friend" | `chronicle export <id> --out run.chronicle` |

## Working with agent / group IDs

Chronicle IDs look like `chr_xxxxxx` (world), `agt_xxxxxx` (agent),
`grp_xxxxxx` (group), etc. When the user says a name, look up the id
first:

- `chronicle list` shows world ids
- `chronicle dashboard <worldId>` pages surface agent / group ids
- `edit-character` accepts EITHER id OR case-insensitive name — use
  the name when you have it

## NEXT_STEPS protocol

Every Chronicle command ends with:

```
NEXT_STEPS
- show_user "..."
- suggest_call "chronicle ..."
- mention "..."
END_NEXT_STEPS
```

Parse this block and act:
- `show_user "X"` → tell the user X
- `suggest_call "Y"` → offer to run Y
- `mention "Z"` → weave Z into your response

Never hide this block from the user — the contents are curated to
keep the narrative loop moving.

## Safety

- Never commit `.chronicle` archives you received from others without
  the user's review — they contain compiled effects that execute on
  import.
- `apply-effect` with `--json` is a power tool; sanity-check user
  intent before composing effects that dissolve groups or revoke
  authorities.
- Respect the engine's inviolable rule set (ADR-0009) — if an effect
  targets one, the CLI will reject with a clear error; echo that back
  to the user rather than trying to work around it.

## Installation

Users who want you to auto-recognise Chronicle tasks should symlink
this file into their Claude Code skills dir:

```bash
mkdir -p ~/.claude/skills/chronicle
ln -sf "$(pwd)/.claude/skills/chronicle/SKILL.md" ~/.claude/skills/chronicle/SKILL.md
```

Or copy if they prefer (skill will stop updating with the repo, but
that's fine for pinned setups).
