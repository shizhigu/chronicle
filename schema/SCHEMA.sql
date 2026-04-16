-- Chronicle: World Database Schema
-- Every simulation is one SQLite file.
-- Event-sourced: state derivable from `events` + `worlds`.
-- Everything else is cached/derived for query speed.

-- ============================================================
-- META
-- ============================================================

CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_version VALUES (1, CURRENT_TIMESTAMP);

-- ============================================================
-- WORLD — the top-level configuration
-- ============================================================

CREATE TABLE worlds (
    id TEXT PRIMARY KEY,                     -- e.g. 'chr_9k8m3n'
    name TEXT NOT NULL,
    description TEXT NOT NULL,               -- natural language user description
    system_prompt TEXT NOT NULL,             -- shared context given to every agent

    -- compiled config (from natural language)
    config_json TEXT NOT NULL,               -- full parsed config

    -- runtime state
    current_tick INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'created',  -- created|running|paused|ended
    god_budget_tokens INTEGER,               -- NULL = unlimited
    tokens_used INTEGER NOT NULL DEFAULT 0,

    -- temporal settings
    tick_duration_description TEXT,          -- "1 hour in-world"
    day_night_cycle_ticks INTEGER,           -- NULL = no cycle

    -- provenance
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_chronicle TEXT,               -- if forked from another
    fork_from_tick INTEGER,                  -- which tick in parent

    -- random seed for reproducibility
    rng_seed INTEGER NOT NULL
);

-- ============================================================
-- AGENTS — each character in the world
-- ============================================================

CREATE TABLE agents (
    id TEXT PRIMARY KEY,                     -- 'agt_marcus_chr9k8m3n'
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,

    -- static persona
    persona TEXT NOT NULL,                   -- full natural language character description
    traits_json TEXT NOT NULL,               -- {openness, agreeableness, ...} or arbitrary
    private_state_json TEXT,                 -- secrets, role, knowledge only this agent has

    -- runtime state (updated each tick)
    alive INTEGER NOT NULL DEFAULT 1,
    location_id TEXT REFERENCES locations(id),
    mood TEXT,                               -- e.g. 'hopeful', 'angry', 'scared' - for rendering
    energy REAL NOT NULL DEFAULT 100,
    health REAL NOT NULL DEFAULT 100,
    tokens_budget INTEGER,                   -- NULL = unlimited; else this agent's personal budget
    tokens_spent INTEGER NOT NULL DEFAULT 0,

    -- agent runtime binding (pi-agent session + model selection)
    session_id TEXT,                         -- pi-agent session id for provider-side context caching
    session_state_blob BLOB,                 -- serialized pi-agent state (for resume)
    -- tier is a neutral label (small/medium/large-ish). Callers fill it.
    model_tier TEXT NOT NULL DEFAULT 'default',
    -- provider + model_id are required at insert time — no brand default.
    -- pi-agent accepts any provider/model pair; Chronicle doesn't privilege one.
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    thinking_level TEXT NOT NULL DEFAULT 'low', -- off|minimal|low|medium|high|xhigh

    -- lineage
    birth_tick INTEGER NOT NULL DEFAULT 0,
    death_tick INTEGER,
    parent_ids_json TEXT,                    -- ['agt_x', 'agt_y'] for offspring, null for original

    -- activation (ADR-0010): last tick the agent took any turn (action or pass).
    -- NULL until the first turn. Engine's ActivationService uses this to
    -- enforce the idle-timeout signal.
    last_active_tick INTEGER,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agents_world ON agents(world_id, alive);
CREATE INDEX idx_agents_location ON agents(location_id);

-- ============================================================
-- LOCATIONS — places in the world
-- ============================================================

CREATE TABLE locations (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,

    -- spatial model (configurable per world)
    -- for grid worlds: x, y. for graph worlds: null + adjacencies. for abstract: null.
    x REAL,
    y REAL,
    parent_id TEXT REFERENCES locations(id),  -- e.g. 'kitchen' inside 'house'

    -- what's possible here
    affordances_json TEXT,                    -- list of action-types allowed here
    metadata_json TEXT,

    -- rendering
    sprite_hint TEXT,                         -- 'beach', 'forest', 'bedroom', etc. for frontend

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_locations_world ON locations(world_id);

-- Adjacency for graph-style worlds (if not using x/y)
CREATE TABLE location_adjacencies (
    from_location_id TEXT NOT NULL REFERENCES locations(id),
    to_location_id TEXT NOT NULL REFERENCES locations(id),
    traversal_cost INTEGER NOT NULL DEFAULT 1,
    bidirectional INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (from_location_id, to_location_id)
);

-- ============================================================
-- RESOURCES — anything finite and transferable
-- ============================================================

CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                       -- 'food', 'wood', 'trust_token', 'information_X'

    -- exactly ONE of these is set
    owner_agent_id TEXT REFERENCES agents(id),
    owner_location_id TEXT REFERENCES locations(id),

    quantity REAL NOT NULL,
    metadata_json TEXT,                       -- e.g. quality, freshness, custom

    CONSTRAINT exactly_one_owner CHECK (
        (owner_agent_id IS NOT NULL AND owner_location_id IS NULL) OR
        (owner_agent_id IS NULL AND owner_location_id IS NOT NULL)
    )
);

CREATE INDEX idx_resources_world_type ON resources(world_id, type);
CREATE INDEX idx_resources_agent ON resources(owner_agent_id);
CREATE INDEX idx_resources_location ON resources(owner_location_id);

-- ============================================================
-- RULES — natural language + compiled enforcement
-- ============================================================

CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,

    -- as user wrote it
    description TEXT NOT NULL,

    -- compiler output
    tier TEXT NOT NULL CHECK (tier IN ('hard', 'soft', 'economic')),

    -- tier='hard': SQL-style predicate and enforcement
    hard_predicate TEXT,                      -- e.g. "action.type='move' AND agent.alive=1"
    hard_check TEXT,                          -- e.g. "agent.energy >= 5" (must be true before action)
    hard_on_violation TEXT,                   -- 'reject' | 'auto_correct' | 'penalty:X'

    -- tier='soft': inject into agent prompts, track violations
    soft_norm_text TEXT,                      -- text included in system prompt
    soft_detection_prompt TEXT,               -- how to detect violation via LLM judge
    soft_consequence TEXT,                    -- what happens on violation (description)

    -- tier='economic': cost formulas
    economic_action_type TEXT,                -- which action this cost applies to
    economic_cost_formula TEXT,               -- e.g. 'energy=2, tokens=5'

    active INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 100,    -- higher = checked first

    -- primary scope (ADR-0009): which entity category this rule binds to.
    --   'world'    — global (default, pre-0009 behavior)
    --   'group'    — only actions by members of scope_ref (group id)
    --   'agent'    — only actions by agent scope_ref
    --   'location' — only actions where actor is at location scope_ref
    scope_kind TEXT NOT NULL DEFAULT 'world'
        CHECK (scope_kind IN ('world', 'group', 'agent', 'location')),
    scope_ref TEXT,                           -- NULL when scope_kind='world'

    -- legacy fine-grained filter (still applied on top of primary scope)
    scope_json TEXT,

    -- provenance
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_tick INTEGER,                  -- if added mid-simulation by god
    compiler_notes TEXT                       -- what the compiler was uncertain about
);

CREATE INDEX idx_rules_world_active ON rules(world_id, active);
CREATE INDEX idx_rules_tier ON rules(world_id, tier);

-- ============================================================
-- ACTIONS — what agents CAN do in this world
-- ============================================================

CREATE TABLE action_schemas (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                       -- 'speak', 'move', 'give', 'attack'

    -- structured definition
    description TEXT NOT NULL,                -- how this action works in prose
    parameters_schema_json TEXT NOT NULL,     -- JSON schema for params agents provide

    -- static properties
    base_cost_json TEXT,                      -- {energy: 2, tokens: 5}
    requires_target_type TEXT,                -- 'none' | 'agent' | 'location' | 'resource' | 'multi'
    visibility TEXT NOT NULL DEFAULT 'public', -- 'public' | 'private' | 'local:radius'

    -- effects (interpreted by engine)
    effects_json TEXT,                        -- declarative effects
    enforcement_ref TEXT,                     -- optional link to a specific rule

    active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_actions_world ON action_schemas(world_id, active);

-- ============================================================
-- EVENTS — the source of truth (append-only log)
-- ============================================================

CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    tick INTEGER NOT NULL,
    wallclock_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    event_type TEXT NOT NULL,                 -- 'action', 'tick_begin', 'tick_end',
                                               -- 'god_intervention', 'agent_reflection',
                                               -- 'rule_violation', 'death', 'birth'

    actor_id TEXT,                            -- agent whose action this was, if applicable
    data_json TEXT NOT NULL,                  -- full event payload

    -- derived fields (denormalized for query speed)
    visible_to_json TEXT,                     -- list of agent_ids who can perceive this event
    token_cost INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_events_world_tick ON events(world_id, tick);
CREATE INDEX idx_events_actor ON events(actor_id);
CREATE INDEX idx_events_type ON events(world_id, event_type);

-- ============================================================
-- MESSAGES — speech and communication (special event subtype)
-- ============================================================

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    tick INTEGER NOT NULL,

    from_agent_id TEXT NOT NULL REFERENCES agents(id),

    -- exactly one of these addresses
    to_agent_id TEXT REFERENCES agents(id),    -- direct
    to_location_id TEXT REFERENCES locations(id), -- spoken aloud there
    to_channel TEXT,                           -- 'global', 'whisper_group_x', etc.

    content TEXT NOT NULL,
    tone TEXT,                                 -- optional: 'angry', 'whispered', 'shouted'
    private INTEGER NOT NULL DEFAULT 0,        -- if 1, only visible to direct participants

    -- derived
    heard_by_json TEXT                         -- list of agent_ids who perceived this
);

CREATE INDEX idx_messages_world_tick ON messages(world_id, tick);
CREATE INDEX idx_messages_from ON messages(from_agent_id);

-- ============================================================
-- AGENT MEMORY — moved out of SQLite.
--
-- Durable per-character memory now lives in a markdown file per
-- character at <CHRONICLE_HOME>/worlds/<world_id>/characters/
-- <agent_id>/memory.md, managed by MemoryFileStore (hermes-agent
-- pattern). Rationale: the agent curates its own memory via three
-- tools (memory_add / memory_replace / memory_remove), the file is
-- injected into the system prompt at session start as a frozen
-- snapshot for prefix-cache stability, and users can inspect or
-- edit it with any text editor. No embeddings, no keyword scoring.
-- ============================================================

-- ============================================================
-- GOVERNANCE — groups, memberships, roles, authorities
--
-- See docs/adr/0009-governance-primitives.md. Layer 1 of the
-- governance system: collective identity + authority data. Layer 2
-- (proposals, votes, effects) lands after this is in use.
-- ============================================================

CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT NOT NULL,

    -- how this group decides things
    procedure_kind TEXT NOT NULL
        CHECK (procedure_kind IN ('decree', 'vote', 'consensus', 'lottery', 'delegated')),
    procedure_config_json TEXT,                -- kind-specific params

    -- optional predicate gating membership (DSL predicate string)
    join_predicate TEXT,

    -- how a role becomes filled again when vacated
    succession_kind TEXT
        CHECK (succession_kind IS NULL OR succession_kind IN
            ('vote', 'inheritance', 'appointment', 'combat', 'lottery')),

    -- how visible to non-members
    visibility_policy TEXT NOT NULL DEFAULT 'open'
        CHECK (visibility_policy IN ('open', 'closed', 'opaque')),

    founded_tick INTEGER NOT NULL,
    dissolved_tick INTEGER,                    -- NULL while active

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_groups_world ON groups(world_id);

CREATE TABLE group_memberships (
    group_id TEXT NOT NULL REFERENCES groups(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    joined_tick INTEGER NOT NULL,
    left_tick INTEGER,                         -- NULL while still a member
    PRIMARY KEY (group_id, agent_id, joined_tick)
);

CREATE INDEX idx_memberships_agent ON group_memberships(agent_id);
CREATE INDEX idx_memberships_active ON group_memberships(group_id, left_tick);

-- Partial unique index — each (group_id, agent_id) pair may have at
-- most one row where left_tick IS NULL. Prevents concurrent join
-- races from producing duplicate active memberships while keeping the
-- historical rows (left_tick stamped) unconstrained.
CREATE UNIQUE INDEX idx_memberships_one_active
    ON group_memberships(group_id, agent_id)
    WHERE left_tick IS NULL;

-- ============================================================
-- PROPOSALS + VOTES (ADR-0009 Layer 2)
--
-- A proposal is a pending state-change bundle: sponsor + target group
-- + effects. The target group's decision procedure tallies the votes
-- and adopts/rejects. Adopted proposals run their effects_json through
-- the same EffectRegistry GodService uses.
-- ============================================================

CREATE TABLE proposals (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,

    sponsor_agent_id TEXT NOT NULL REFERENCES agents(id),
    target_group_id TEXT NOT NULL REFERENCES groups(id),

    title TEXT NOT NULL,
    rationale TEXT NOT NULL,

    -- raw effects as the sponsor submitted them
    effects_json TEXT NOT NULL,
    -- validator output; NULL until EffectRegistry.validate has run
    compiled_effects_json TEXT,

    opened_tick INTEGER NOT NULL,

    -- polymorphic deadline (see ProposalDeadline in core/types.ts)
    deadline_json TEXT NOT NULL,

    -- optional one-off procedure override (JSON of {kind, config})
    procedure_override_json TEXT,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'adopted', 'rejected', 'withdrawn', 'expired')),
    decided_tick INTEGER,
    outcome_detail TEXT
);

CREATE INDEX idx_proposals_world_status ON proposals(world_id, status);
CREATE INDEX idx_proposals_group ON proposals(target_group_id, status);

CREATE TABLE votes (
    proposal_id TEXT NOT NULL REFERENCES proposals(id),
    voter_agent_id TEXT NOT NULL REFERENCES agents(id),
    stance TEXT NOT NULL CHECK (stance IN ('for', 'against', 'abstain')),
    weight REAL NOT NULL DEFAULT 1.0,
    cast_tick INTEGER NOT NULL,
    reasoning TEXT,
    PRIMARY KEY (proposal_id, voter_agent_id)
);

CREATE INDEX idx_votes_proposal ON votes(proposal_id);

CREATE TABLE group_roles (
    group_id TEXT NOT NULL REFERENCES groups(id),
    role_name TEXT NOT NULL,                   -- 'chair', 'high_priest', 'treasurer', ...
    holder_agent_id TEXT REFERENCES agents(id),  -- NULL when vacant
    assigned_tick INTEGER,
    voting_weight REAL NOT NULL DEFAULT 1.0,   -- used when procedure weights='role'
    scope_ref TEXT,                            -- extra scope carried by the role
    PRIMARY KEY (group_id, role_name)
);

CREATE TABLE authorities (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,

    -- who holds this authority
    holder_kind TEXT NOT NULL
        CHECK (holder_kind IN ('group', 'agent', 'role')),
    holder_ref TEXT NOT NULL,                  -- group_id | agent_id | group_id#role_name

    -- powers: JSON list of typed power records, see core/src/types.ts AuthorityPower
    powers_json TEXT NOT NULL,

    granted_tick INTEGER NOT NULL,
    expires_tick INTEGER,                      -- NULL = indefinite

    -- audit trail
    source_event_id INTEGER REFERENCES events(id),
    revoked_tick INTEGER,
    revocation_event_id INTEGER REFERENCES events(id)
);

CREATE INDEX idx_authorities_world ON authorities(world_id);
CREATE INDEX idx_authorities_holder ON authorities(world_id, holder_kind, holder_ref);

-- ============================================================
-- RELATIONSHIPS — agent-to-agent bonds
-- ============================================================

CREATE TABLE relationships (
    agent_a_id TEXT NOT NULL REFERENCES agents(id),
    agent_b_id TEXT NOT NULL REFERENCES agents(id),

    -- a's view of b (relationships are directional, can be asymmetric)
    affection REAL NOT NULL DEFAULT 0,         -- -1 to 1
    trust REAL NOT NULL DEFAULT 0,             -- -1 to 1
    respect REAL NOT NULL DEFAULT 0,           -- -1 to 1
    familiarity REAL NOT NULL DEFAULT 0,       -- 0 to 1 (how well a knows b)

    tags_json TEXT,                            -- ['lover', 'rival', 'mentor', 'sibling', ...]

    last_interaction_tick INTEGER,

    PRIMARY KEY (agent_a_id, agent_b_id)
);

CREATE INDEX idx_rel_a ON relationships(agent_a_id);
CREATE INDEX idx_rel_b ON relationships(agent_b_id);

-- ============================================================
-- AGREEMENTS — explicit inter-agent contracts
-- ============================================================

CREATE TABLE agreements (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,

    parties_json TEXT NOT NULL,                -- list of agent_ids
    terms TEXT NOT NULL,                       -- natural language
    compiled_terms_json TEXT,                  -- structured if compilable

    proposed_by_id TEXT NOT NULL REFERENCES agents(id),
    proposed_tick INTEGER NOT NULL,
    accepted_tick INTEGER,
    ended_tick INTEGER,

    status TEXT NOT NULL DEFAULT 'proposed',   -- proposed|active|fulfilled|violated|expired
    violation_count INTEGER NOT NULL DEFAULT 0,

    enforcement_mechanism TEXT                 -- 'social' | 'reputation' | 'resource_forfeit' | 'exclusion'
);

CREATE INDEX idx_agreements_world ON agreements(world_id, status);

-- ============================================================
-- GOD INTERVENTIONS — user-injected events
-- ============================================================

CREATE TABLE god_interventions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    queued_tick INTEGER NOT NULL,              -- when it was queued
    apply_at_tick INTEGER NOT NULL,            -- when it should take effect

    description TEXT NOT NULL,                 -- natural language user input
    compiled_effects_json TEXT,                -- LLM-parsed concrete effects

    applied INTEGER NOT NULL DEFAULT 0,
    notes TEXT
);

-- ============================================================
-- TICK SNAPSHOTS — full state at key ticks for replay/fork
-- ============================================================

CREATE TABLE tick_snapshots (
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    tick INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,               -- compressed full state
    event_count_until_here INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (world_id, tick)
);

-- ============================================================
-- OBSERVATION SUBSCRIPTIONS — for live UI / logging
-- ============================================================

CREATE TABLE observers (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                         -- 'web_ui' | 'cli_watch' | 'export' | 'webhook'
    filter_json TEXT,                           -- what events to send
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- VIEWS — common derived queries for convenience
-- ============================================================

CREATE VIEW live_agents AS
SELECT * FROM agents WHERE alive = 1;

CREATE VIEW current_tick_events AS
SELECT e.*, w.current_tick
FROM events e JOIN worlds w ON e.world_id = w.id
WHERE e.tick = w.current_tick;

CREATE VIEW active_agreements AS
SELECT * FROM agreements WHERE status = 'active';

-- ============================================================
-- NOTES
-- ============================================================
--
-- The ONLY source-of-truth tables are:
--   - worlds, agents (static persona), rules, action_schemas, locations
--   - events (all state changes)
--   - god_interventions
--
-- All other tables (resources, relationships, memories, messages, tick_snapshots)
-- are DERIVABLE from replaying the event log. We materialize them for query speed.
--
-- This means: given a world.db, you can always replay from tick 0 and reconstruct
-- every state. Which means: deterministic (with rng_seed), forkable, shareable.
