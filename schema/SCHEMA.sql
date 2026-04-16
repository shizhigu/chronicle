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
    model_tier TEXT NOT NULL DEFAULT 'haiku', -- haiku|sonnet|opus or custom
    provider TEXT NOT NULL DEFAULT 'anthropic',
    model_id TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
    thinking_level TEXT NOT NULL DEFAULT 'low', -- off|minimal|low|medium|high|xhigh

    -- lineage
    birth_tick INTEGER NOT NULL DEFAULT 0,
    death_tick INTEGER,
    parent_ids_json TEXT,                    -- ['agt_x', 'agt_y'] for offspring, null for original

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

    -- scope: optional JSON that narrows applicability (agentIds, locationIds, timeRange)
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
-- AGENT MEMORY — per-agent episodic + semantic
-- ============================================================

CREATE TABLE agent_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL REFERENCES agents(id),

    created_tick INTEGER NOT NULL,
    memory_type TEXT NOT NULL,                 -- 'observation', 'reflection', 'goal', 'belief_about_other'
    content TEXT NOT NULL,
    importance REAL NOT NULL DEFAULT 0.5,      -- 0-1, used for retrieval ranking
    decay REAL NOT NULL DEFAULT 1.0,           -- memories fade over time if not reinforced

    -- optional links
    related_event_id INTEGER REFERENCES events(id),
    about_agent_id TEXT REFERENCES agents(id),

    -- retrieval
    embedding BLOB,                            -- for semantic search (populated on demand)

    last_accessed_tick INTEGER
);

CREATE INDEX idx_memory_agent ON agent_memories(agent_id, created_tick);
CREATE INDEX idx_memory_importance ON agent_memories(agent_id, importance DESC);

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
