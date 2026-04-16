# 0009. Governance primitives — groups, authority, proposals, effects

- **Status:** accepted (Layer 1 + Layer 2 landed; Layer 3 still proposed)
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Chronicle today models individuals. Characters act, rules constrain them, the
engine persists. The world as a whole is static:

- Locations are generated once at `chronicle create-world` and frozen for the
  entire run.
- Rules are global and invariant. A character cannot propose a new law or
  exempt themselves from an old one.
- Authority is implicit. Nothing in the system says "the emperor can override
  rule X." If the LLM role-plays an emperor, the declaration is pure speech
  with no mechanical consequence.
- The only externally-triggerable structural change is `GodService` — a human
  operator injecting an event. There is no in-world mechanism for agents to
  collectively restructure the world.

This is a ceiling. Every interesting dynamic in human history — parliaments
passing laws, tyrants issuing decrees, factions fighting civil wars,
colonists founding new towns, councils exiling heretics, guilds negotiating
contracts — requires two things Chronicle does not have:

1. **Collective agency**: a way for a *group* of agents to act as a unit.
2. **Structural mutability**: a way for the output of that collective act
   to change the rules, geography, or authority layout of the world itself.

Without these, Chronicle is a dollhouse. With them, it becomes a
civilizational substrate on which any political archetype can emerge from
agent behavior. No LLM-agent project has done this at the primitive level;
game studios (Paradox titles, Dwarf Fortress) have the mechanical depth but
no LLM-driven minds; ABM platforms (NetLogo, Mesa) have the abstraction but
no narrative. Chronicle can be the first to combine all three.

## Decision

We introduce four orthogonal primitive categories. Every historical
archetype the user cares about (parliament, tyranny, anarchy, feudalism,
theocracy, revolution, federation, schism) must decompose into a
configuration of these primitives. Nothing archetype-specific is hardcoded.

### A. Group primitives

A **Group** is a named entity with members, a decision procedure, and a
scope of authority. It is runtime-mutable — groups can be founded,
joined, left, merged, split, and dissolved during a simulation.

```sql
CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,

    -- How this group decides. Mirrors the procedure enum below.
    procedure_kind TEXT NOT NULL,           -- 'decree' | 'vote' | 'consensus' | 'lottery' | 'delegated'
    procedure_config_json TEXT,             -- kind-specific params (threshold, quorum, seat, ...)

    -- Optional: membership gating. NULL = open; otherwise a predicate
    -- evaluated against the prospective member before join is allowed.
    join_predicate TEXT,

    -- Optional: how roles within this group succeed on vacancy.
    -- Each role-holder death/resignation triggers succession.
    succession_kind TEXT,                   -- 'vote' | 'inheritance' | 'appointment' | 'combat' | 'lottery' | NULL

    founded_tick INTEGER NOT NULL,
    dissolved_tick INTEGER,                 -- NULL while active

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE group_memberships (
    group_id TEXT NOT NULL REFERENCES groups(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    joined_tick INTEGER NOT NULL,
    left_tick INTEGER,                      -- NULL while still a member
    PRIMARY KEY (group_id, agent_id, joined_tick)
);

CREATE TABLE group_roles (
    group_id TEXT NOT NULL REFERENCES groups(id),
    role_name TEXT NOT NULL,                -- 'chair', 'high_priest', 'treasurer'
    holder_agent_id TEXT REFERENCES agents(id),   -- NULL when vacant
    assigned_tick INTEGER,
    -- role-specific scope ON TOP OF the group's scope (see Authority)
    scope_ref TEXT,
    PRIMARY KEY (group_id, role_name)
);
```

Groups can contain groups (a federation is a group whose members are
other groups). We implement this by allowing `group_memberships` to have
`group_id IS NOT NULL AND agent_id IS NULL` combined with a new column
`member_group_id` — or more cleanly, a single `group_members` table
polymorphic over agent/group. Design to be finalized in
implementation but the capability is required for treaties and
federations.

### B. Authority primitives

Currently rules are global: `scope` column exists on `rules` but is
unused. We activate it.

```sql
ALTER TABLE rules ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'world';
   -- 'world' | 'group' | 'agent' | 'location'
ALTER TABLE rules ADD COLUMN scope_ref  TEXT;
   -- when scope_kind != 'world': id of the group / agent / location it binds to

CREATE TABLE authorities (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,

    -- WHO holds this authority
    holder_kind TEXT NOT NULL,              -- 'group' | 'agent' | 'role'
    holder_ref TEXT NOT NULL,               -- group_id OR agent_id OR 'group_id#role_name'

    -- WHAT the authority covers — a list of "scoped rule" references plus
    -- optional proposal powers. Stored as JSON for extensibility.
    --   [{ kind: 'override_rule', rule_id }, { kind: 'propose', effect_types: [...] }, ...]
    powers_json TEXT NOT NULL,

    -- OPTIONAL: time-bound (term limits, regency)
    granted_tick INTEGER NOT NULL,
    expires_tick INTEGER,                   -- NULL = indefinite

    -- how it was obtained (audit trail)
    source_event_id INTEGER REFERENCES events(id),

    revoked_tick INTEGER,
    revocation_event_id INTEGER REFERENCES events(id)
);
```

Two key insights:

1. **Authority is data.** The RuleEnforcer consults the `authorities`
   table when validating an action. An agent whose action would violate
   a rule is permitted if they hold an authority whose `powers_json`
   contains a matching `override_rule` entry. "Emperor can kill" is
   literally a row in `authorities`.

2. **Legitimacy is emergent, not enforced.** The engine enforces
   whatever authorities exist in the table. If a self-proclaimed
   emperor's `authorities` row was created through a process other
   characters consider illegitimate, their own memories and reactions
   will reflect that. We do not have a layer that judges whether
   authority is "real" — it is real in the measure that characters act
   as if it is. This matches how power actually works.

### C. Procedure primitives

Decision procedures are pluggable. A group's `procedure_kind` selects
one; `procedure_config_json` parameterizes it.

| Kind          | Config                                                  | Semantics                                                 |
|---------------|---------------------------------------------------------|-----------------------------------------------------------|
| `decree`      | `{ holder_role: "emperor" }`                            | The role-holder's vote alone decides. Size-1 = tyranny.   |
| `vote`        | `{ threshold: 0.5, quorum: 0.5, weights?: "equal"\|"role-weighted" }` | Tally of member stances; pass ≥ threshold. |
| `consensus`   | `{ veto_count: 1 }`                                     | Pass iff < veto_count members oppose.                     |
| `lottery`     | `{ eligible: "members"\|"citizens" }`                   | Random pick from eligible pool; their stance wins.        |
| `delegated`   | `{ to_group_id }`                                       | Defer to another group's decision on this proposal.       |

All procedures share:

- **Eligibility**: who can vote (default: current members).
- **Deadline**: max ticks a proposal stays open; if no decision, a
  configurable fallback applies (`pass` | `fail` | `carry_over`).
- **Abstention**: agents who don't vote by deadline count as configured
  (`abstain_as_no` | `abstain_as_yes` | `not_counted`).

New procedures are additive — the procedure table is a registry in
engine code, not DB rows.

### D. Proposal primitive & Effect primitive

A **Proposal** is a pending state-change bundled with the group that
decides and the procedure that applies. An **Effect** is a typed,
compile-time-validated instruction that mutates world state when a
proposal succeeds. Effects use the same compiled format as
`god_interventions.compiled_effects_json` — the same executor handles
both pathways.

```sql
CREATE TABLE proposals (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,

    sponsor_agent_id TEXT NOT NULL REFERENCES agents(id),
    target_group_id TEXT NOT NULL REFERENCES groups(id),

    title TEXT NOT NULL,                    -- one-line summary
    rationale TEXT NOT NULL,                -- sponsor's speech for the record

    effects_json TEXT NOT NULL,             -- see Effect catalog below
    compiled_effects_json TEXT,             -- validator output; NULL = not yet validated

    opened_tick INTEGER NOT NULL,
    deadline_tick INTEGER NOT NULL,
    procedure_override_json TEXT,           -- optional one-off procedure override

    status TEXT NOT NULL,                   -- 'pending' | 'adopted' | 'rejected' | 'withdrawn' | 'expired'
    decided_tick INTEGER,
    outcome_detail TEXT                     -- tallies, dissent, etc.
);

CREATE TABLE votes (
    proposal_id TEXT NOT NULL REFERENCES proposals(id),
    voter_agent_id TEXT NOT NULL REFERENCES agents(id),
    stance TEXT NOT NULL,                   -- 'for' | 'against' | 'abstain'
    weight REAL NOT NULL DEFAULT 1.0,       -- procedure-specific
    cast_tick INTEGER NOT NULL,
    reasoning TEXT,                         -- agent's speech-for-the-record
    PRIMARY KEY (proposal_id, voter_agent_id)
);
```

#### Effect catalog (minimum viable set)

Every effect is one of:

**Entity lifecycle:**
- `create_location(name, description, adjacent_to[], spriteHint?)` — colonists found a new town
- `remove_location(id)` — earthquake; cannot remove a location with residents
- `create_group(name, procedure, initial_members[], description)` — schism, party founding
- `dissolve_group(id)` — disband the guild
- `create_rule(description, tier, predicate, scope)` — legislation
- `repeal_rule(id)` — amendment

**Membership & role:**
- `add_member(group_id, agent_id)` — enlistment, conversion
- `remove_member(group_id, agent_id)` — exile, excommunication
- `assign_role(group_id, role_name, agent_id)` — coronation, promotion
- `vacate_role(group_id, role_name)` — abdication, impeachment

**Authority:**
- `grant_authority(holder, powers, expires_tick?)` — emperor gifts dukedom
- `revoke_authority(authority_id)` — stripping of titles
- `transfer_authority(authority_id, new_holder)` — succession

**Resource & territory:**
- `transfer_resource(resource_id, to_owner_kind, to_owner_ref, quantity)` — tribute, theft
- `claim_location(group_id, location_id)` — territorial annexation (creates scoped rule: only group members may move in / act here, per world config)
- `relinquish_location(group_id, location_id)` — cession

**Relations:**
- `declare_relation(from_group, to_group, kind)` — `'war' | 'peace' | 'alliance' | 'vassalage' | 'truce'`
- A declared war modifies default enforcement between the two groups
  (configurable: hostile actions no longer violate "don't attack" rules,
  peaceful actions gain extra scrutiny, etc.)

**Change of procedure:**
- `change_procedure(group_id, new_procedure_kind, new_config)` — constitutional amendment
- Meta-note: this is how democracy becomes tyranny or vice versa
  *from inside the system* — e.g. a parliament votes to transfer its
  own decision power to a single dictator.

Each effect verb has a validator (reject at proposal compile time if
args are wrong) and an executor (apply on adoption). Both live in a
single `EffectRegistry` shared between ProposalService and GodService —
see Consequences, "unification with GodService".

### E. Action primitives (agent-facing tools)

Characters gain these core tools (alongside existing `observe / think /
speak / memory_*`). Every tool is still pi-agent-typed and
RuleEnforcer-checked.

| Tool                                      | Purpose                                               |
|-------------------------------------------|-------------------------------------------------------|
| `form_group(name, procedure, members)`    | Found a new collective.                               |
| `join_group(group_id)`                    | Request / accept membership (gated by join_predicate).|
| `leave_group(group_id)`                   | Resign.                                               |
| `invite(group_id, agent)`                 | Authority-gated invitation.                           |
| `expel(group_id, agent)`                  | Authority-gated removal.                              |
| `propose(target_group, effects, deadline, rationale)` | Submit a motion.                         |
| `vote(proposal_id, stance, reasoning)`    | Cast a vote.                                          |
| `withdraw_proposal(proposal_id)`          | Sponsor-only.                                         |
| `claim(target_kind, target_ref, basis)`   | Assert a contested claim (title, land, ownership).    |
| `challenge(claim_id)`                     | Contest an existing claim.                            |
| `swear_oath(to_entity, terms)`            | Create a bilateral `agreement` row with self-binding terms. |
| `sanction(target, scope)`                 | Declare punishment within authority's bounds.         |

### F. Procedure for creating a new location (worked example)

To show composition, here's how "colonists found a new settlement"
plays out under these primitives alone — no hardcoded "colonize":

1. Characters form a `Group("Pioneers")` with `procedure=consensus`.
2. A member calls `propose(Pioneers, effects=[create_location("Avalon",
   description, adjacent_to=["Harbor"])], deadline=10)`.
3. Other Pioneers `vote`. Under `consensus`, one "no" kills it.
4. At tick `opened+10` (or earlier if all voted), engine settles the
   proposal. If adopted, the `create_location` effect executes via
   `EffectRegistry`, the new location is persisted, and an event
   `proposal_adopted` fires.
5. Witnesses outside Pioneers see the event (visibility rules apply)
   and can record memories about it. Some may propose counter-claims
   via `claim(location, "Avalon", basis="we were here first")`.

Nothing about this required colony-specific code. Everything reuses
Groups, Proposals, Effects, and the existing event log.

## Composition table — archetypes from primitives

| Archetype                | Group(s) configuration                                                                                    |
|--------------------------|-----------------------------------------------------------------------------------------------------------|
| **Tyranny**              | One group "Crown", `procedure=decree(holder_role=emperor)`, broad authorities (override most rule tiers). |
| **Parliament**           | One group "Assembly", `procedure=vote(majority)`, authority to create/repeal rules and grant authorities. |
| **Constitutional monarchy** | Two groups: "Crown" (ceremonial, narrow authority) + "Parliament" (legislative authority). Conflict between them is the drama. |
| **Anarchy**              | No group holds broad authority. Each agent has personal-scope authority only. Rules survive by norm, not enforcement. |
| **Feudalism**            | Nested groups: "Kingdom" (decree by monarch) → "Duchy" (decree by duke, authority delegated from Kingdom) → "Manor"... |
| **Theocracy**            | One group "Church", `procedure=delegated(to_group=Oracle)` or `decree(holder_role=high_priest)`, authority over norms-rules. |
| **Oligarchy**            | Small "Council" group, `procedure=consensus`, wide authority. Any one member can veto.                    |
| **Revolution**           | A non-authority group forms, proposes effects that `revoke_authority` the old dominant group and `grant_authority` themselves. Adoption = success; rejection + legitimacy loss = failure. |
| **Federation / Alliance**| A meta-group whose members are other groups, tied together by a treaty `agreement` carrying `declare_relation(alliance)` effects. |
| **Schism**               | A faction inside group X runs `form_group` with a subset of X's members and a copy of its rules; optionally `leave_group(X)` as the same tick. |

All ten fall out of the same four primitive categories. The system
does not *know* about tyranny or parliament. Those are user-level
labels for primitive configurations.

## Consequences

### Positive

- **Chronicle becomes structurally mutable.** The world at tick 1000
  can look completely different from tick 0 — different geography,
  different rules, different power structures — and all of it is
  attributable to events in the log.
- **Replayability preserved.** All state change still goes through the
  event log; proposals, votes, effects are all events. Bit-exact
  replay is unaffected.
- **GodService unifies with ProposalService.** A god intervention
  becomes "a proposal that auto-adopts and targets the world's root
  group." Same EffectRegistry executes both. We get to delete code
  duplicated across god/service and the new proposal path.
- **Emergent legitimacy.** We do not encode "only legitimate rulers can
  rule." Compliance is an outcome of agents' memories, relationships,
  and votes. Illegitimate rulers can still rule coercively via hard
  rules if their Authority rows exist — but the drama of challenge,
  rebellion, and succession becomes first-class narrative material.

### Negative

- **Significant engineering effort.** 4 new tables, ~12 new actions, an
  EffectRegistry, a scheduler pass every tick to settle expired
  proposals, RuleEnforcer upgrade to consult authorities. Estimated
  1–2 weeks of focused work plus docs.
- **More prompt tokens per turn.** Agents' observations will grow to
  include group memberships, outstanding proposals, and relevant
  authorities. We will need to scope "which proposals this agent can
  see" carefully (visibility rules) to avoid bloat.
- **Design surface for abuse.** Malicious proposals could chain effects
  to dismantle safety rules. We need a notion of `inviolable_rules`
  (hard-coded, cannot be target of `repeal_rule`) — e.g. "actions that
  attempt to exfiltrate secrets are always rejected" regardless of
  authority.
- **Composability edge cases.** What happens if two proposals' effects
  conflict (both adopt in the same tick, both try to assign the same
  role)? We specify: effects are applied in deterministic proposal-id
  order; second-mover failures are recorded as events but do not roll
  back the first.

### Neutral / accept

- **We deliberately exclude**: blockchain-style non-repudiation;
  linguistic / cultural drift modeling; full economic market
  simulation (resources already transfer; price discovery is
  content-level); religious content (rituals are scheduled recurring
  proposals and need no dedicated primitive).
- **Narrative intent**: the system provides primitives. A world's
  initial configuration (in world-compiler output) decides which
  archetype it starts with. Evolution from there is up to the agents.

## Non-goals

- We are **not** building a "government type" enum with preset behaviors.
  That contradicts the principle that archetypes emerge from primitive
  configurations. Scenario authors may bundle presets in tooling, but
  the engine does not know about them.
- We are **not** building a legitimacy judge. An authority exists iff
  its row exists. Characters' reactions to that authority are narrative
  content, produced by the LLM, not evaluated by the engine.
- We are **not** hardcoding succession rules. Succession is one of a
  small enum (`vote | inheritance | appointment | combat | lottery`),
  parameterized per group.

## Implementation order

This ADR is large. We implement in three incrementally-landable layers.

### Layer 1 — Groups + scoped rules + authorities (1 tick)

- DB: `groups`, `group_memberships`, `group_roles`, `authorities`; add
  `scope_kind` / `scope_ref` to `rules`.
- Actions: `form_group`, `join_group`, `leave_group`.
- Enforcer: consults `authorities` + rule scope when validating.
- Seeding: world-compiler LLM prompt extended to optionally emit an
  initial groups/authorities config. Backward-compatible (worlds
  without the new block still work; they just have no groups).
- Acceptance: a seeded world with a "Council" group whose members are
  the only ones allowed (via scoped rule) to call `propose`. Without
  Layer 2 there's nothing to propose, but the scoping works.

### Layer 2 — Proposals + votes + EffectRegistry (1 tick)

- DB: `proposals`, `votes`.
- Effect catalog: implement the minimum viable set under "Effect
  catalog" above. Share the executor with `GodService`.
- Actions: `propose`, `vote`, `withdraw_proposal`.
- Engine: per-tick settle pass — expire, tally, adopt-or-reject,
  execute effects on adoption. All as new events (`proposal_opened`,
  `vote_cast`, `proposal_adopted`, `proposal_rejected`).
- Acceptance: a parliamentary world self-creates a new location via
  proposal; an event chain traces the motion → votes → adoption →
  `create_location` → fresh row in `locations`.

### Layer 3 — Structural change + rich archetypes (open-ended)

- Effects expand: `change_procedure`, `declare_relation`, territorial
  claims, full role/succession plumbing.
- World-compiler: scenario presets using the archetype table above
  become one-line configs (e.g., `template: "feudal"` expands to the
  nested Kingdom/Duchy/Manor groups automatically).
- Narrative tooling: `chronicle dashboard` gets a "political map" view
  — who belongs to what, who holds which authorities, which proposals
  are pending.

## Progressive configuration — who owns each decision

Every knob in this system sits on a five-layer ladder. Lower layers
defer to higher ones; higher layers set sensible defaults but do not
forbid change below. Agent autonomy grows downward; system protection
lives at the top.

| Layer | Owner                    | Overridable by  |
|-------|--------------------------|-----------------|
| **L0** | Engine hardcoded (safety, determinism, runtime integrity) | *nothing* |
| **L1** | World-compiler inference from `--desc` | L2 flags       |
| **L2** | User world-config at creation (e.g. `--template=feudal`) | L3 proposals |
| **L3** | Agent proposals at runtime (the political game)          | L4 god       |
| **L4** | God intervention (user mid-run override)                 | —            |

**Design principle**: push every decision as far down as safety allows.
Emergence is the point. L0 is deliberately small — it guards only
system integrity, never narrative choice.

### Per-agent permissions — compositional, not flat

An agent's permissions at any moment are the union of four layers:

1. **Personal rights** (every agent): `move` self, `speak`, `memory_*`.
2. **Citizenship rights** (implicit world-level group membership):
   `propose`, `vote`, `form_group`. A world can scope these away
   from specific members via rules (peasants may not propose).
3. **Group membership rights** (unlocked by `add_member`): propose/vote
   within that group; access its group-scoped actions.
4. **Granted authorities** (rows in `authorities`): override specific
   rules; execute specific effect types; wield scope over named
   entities or the world.

An emperor: (1) + (2) + (3 in "Crown" group) + (4: `override_rule: *`,
`execute_effect: *`, scope=world). A serf: just (1), with (2) scoped
away by a "only-nobility-may-propose" rule.

## Decided open questions

These five were open in the first draft; resolved here by applying the
configuration ladder above.

### Q1. Claim resolution
- **L0**: engine provides the mechanism (claims land in a queue), chooses
  no policy.
- **L1 default**: world-compiler emits a "Courts" group with a
  configurable procedure. Contested claims auto-route to Courts as a
  proposal. Default procedure: `decree(holder_role=judge)` for
  medieval-ish worlds, `vote(majority)` for democratic ones — picked
  by atmosphere tag.
- **L3**: Courts is a normal group. Agents can `change_procedure` on
  it (judicial reform is in-world content). They can also
  `form_group("alt_court", ...)` and fight about whose ruling stands,
  which reduces to authority competition — exactly the drama we want.

### Q2. Visibility of political events
- **L0**: engine enforces visibility using the same `heardBy` machinery
  as messages, plus group-membership lookup for proposal events.
- **L1 default**: each group gets a `visibility_policy` field ∈
  `{ open, closed, opaque }`. World-compiler defaults to `open`
  (non-members see debate + outcome) unless the group description
  implies secrecy (cults, conspiracies → `opaque`).
- **L3**: `change_procedure` can mutate `visibility_policy`. "Council
  moves to closed session" is a real in-game action.
- Semantics:
  - `open`    — non-members see opened / votes / outcome events
  - `closed`  — non-members see opened / outcome only; votes hidden
  - `opaque`  — non-members do not even know the group exists

### Q3. Inviolable rules
- **L0 hardcoded, not overridable by any world or agent**:
  - Memory content must pass the threat-scan (anti-prompt-injection).
  - Effects may not target the runtime itself — no proposal can
    create a rule that grants shell access, disables scanning, or
    reaches outside the simulation sandbox.
  - Rules that violate replayability invariants are rejected at
    compile time (no wall-clock time, no un-seeded randomness, no
    external network calls inside predicates).
- **L2 world-config `inviolable_rules[]`**: scenario authors may
  hard-pin additional rules ("killing is always wrong in this world").
  Agents may still *propose* repealing them; the proposal's effect
  compiler refuses and records the attempt. This preserves dramatic
  tension — they can rail against the law, they cannot unmake it.
- **L3**: agents cannot reach the L0 or L2 set.
- **L4**: god may amend the L2 set; L0 is immutable.

### Q4. Role-weighted voting
- **L0**: engine provides mechanism (`vote` carries a `weight` column
  on each ballot row). Agnostic to how weights are computed.
- **L1 default**: `weights: "equal"` — one member, one vote. Safe,
  neutral, widely understood.
- **L2 options**: world-config selects one of
  - `"equal"` — 1.0 each
  - `"role"` — each `group_roles` row carries `voting_weight`;
     non-role-holders default to 1.0
  - `"authority"` — weight proportional to breadth of each voter's
     `authorities.powers_json` coverage within this group's scope
  - `"custom"` — a compiled predicate over (voter, group, proposal)
- **L3**: `change_procedure` can switch strategy; `assign_role` can
  redistribute who holds weighted seats.

### Q5. Proposal deadline form
- **L0**: engine's `proposals.deadline_kind` is polymorphic:
  - `{ kind: "tick", at: N }` — fixed tick limit
  - `{ kind: "quorum", need: K }` — close as soon as K votes cast
  - `{ kind: "all_voted" }` — close when every eligible member voted
  - `{ kind: "any_of", ... }` — earliest trigger wins (e.g. tick OR quorum)
- **L1/L2/L3**: procedure config picks one per proposal (or per group).

## Revisit triggers

- Any scenario author building a political world wants a concept we
  cannot compose from these primitives. (Track asks in GitHub
  discussions; if the same ask appears 3+ times, promote to a new
  effect or procedure kind.)
- Proposal-settle pass shows up in profiling as a tick-time hotspot.
- Replay of a political world diverges from its original run (this
  would mean a non-determinism bug — investigate immediately).
