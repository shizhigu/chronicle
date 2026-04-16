/**
 * Drizzle schema mirroring schema/SCHEMA.sql.
 *
 * Keep in sync with SCHEMA.sql. If they drift, the SQL file is the source of truth
 * and this file needs updating.
 */

import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const worlds = sqliteTable('worlds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  configJson: text('config_json').notNull(),
  currentTick: integer('current_tick').notNull().default(0),
  status: text('status', { enum: ['created', 'running', 'paused', 'ended'] })
    .notNull()
    .default('created'),
  godBudgetTokens: integer('god_budget_tokens'),
  tokensUsed: integer('tokens_used').notNull().default(0),
  tickDurationDescription: text('tick_duration_description'),
  dayNightCycleTicks: integer('day_night_cycle_ticks'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  createdByChronicle: text('created_by_chronicle'),
  forkFromTick: integer('fork_from_tick'),
  rngSeed: integer('rng_seed').notNull(),
});

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    persona: text('persona').notNull(),
    traitsJson: text('traits_json').notNull(),
    privateStateJson: text('private_state_json'),
    alive: integer('alive', { mode: 'boolean' }).notNull().default(true),
    locationId: text('location_id'),
    mood: text('mood'),
    energy: real('energy').notNull().default(100),
    health: real('health').notNull().default(100),
    tokensBudget: integer('tokens_budget'),
    tokensSpent: integer('tokens_spent').notNull().default(0),
    sessionId: text('session_id'),
    sessionStateBlob: blob('session_state_blob'),
    // Tier is a generic label (small/medium/large-ish); callers fill it.
    modelTier: text('model_tier').notNull().default('default'),
    // Provider + modelId are provided by the caller at insert time — no
    // brand default. We require them at the Drizzle type level so missing
    // values fail fast rather than quietly landing on a hardcoded brand.
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    thinkingLevel: text('thinking_level').notNull().default('low'),
    birthTick: integer('birth_tick').notNull().default(0),
    deathTick: integer('death_tick'),
    parentIdsJson: text('parent_ids_json'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    worldAliveIdx: index('idx_agents_world').on(t.worldId, t.alive),
    locationIdx: index('idx_agents_location').on(t.locationId),
  }),
);

export const locations = sqliteTable(
  'locations',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    x: real('x'),
    y: real('y'),
    parentId: text('parent_id'),
    affordancesJson: text('affordances_json'),
    metadataJson: text('metadata_json'),
    spriteHint: text('sprite_hint'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    worldIdx: index('idx_locations_world').on(t.worldId),
  }),
);

export const locationAdjacencies = sqliteTable(
  'location_adjacencies',
  {
    fromLocationId: text('from_location_id')
      .notNull()
      .references(() => locations.id),
    toLocationId: text('to_location_id')
      .notNull()
      .references(() => locations.id),
    traversalCost: integer('traversal_cost').notNull().default(1),
    bidirectional: integer('bidirectional', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fromLocationId, t.toLocationId] }),
  }),
);

export const resources = sqliteTable(
  'resources',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    ownerAgentId: text('owner_agent_id'),
    ownerLocationId: text('owner_location_id'),
    quantity: real('quantity').notNull(),
    metadataJson: text('metadata_json'),
  },
  (t) => ({
    worldTypeIdx: index('idx_resources_world_type').on(t.worldId, t.type),
    agentIdx: index('idx_resources_agent').on(t.ownerAgentId),
    locationIdx: index('idx_resources_location').on(t.ownerLocationId),
    exactlyOneOwner: check(
      'exactly_one_owner',
      sql`(owner_agent_id IS NOT NULL AND owner_location_id IS NULL) OR (owner_agent_id IS NULL AND owner_location_id IS NOT NULL)`,
    ),
  }),
);

export const rules = sqliteTable(
  'rules',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    tier: text('tier', { enum: ['hard', 'soft', 'economic'] }).notNull(),
    hardPredicate: text('hard_predicate'),
    hardCheck: text('hard_check'),
    hardOnViolation: text('hard_on_violation'),
    softNormText: text('soft_norm_text'),
    softDetectionPrompt: text('soft_detection_prompt'),
    softConsequence: text('soft_consequence'),
    economicActionType: text('economic_action_type'),
    economicCostFormula: text('economic_cost_formula'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    priority: integer('priority').notNull().default(100),
    scopeJson: text('scope_json'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    createdByTick: integer('created_by_tick'),
    compilerNotes: text('compiler_notes'),
  },
  (t) => ({
    worldActiveIdx: index('idx_rules_world_active').on(t.worldId, t.active),
    tierIdx: index('idx_rules_tier').on(t.worldId, t.tier),
  }),
);

export const actionSchemas = sqliteTable(
  'action_schemas',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    parametersSchemaJson: text('parameters_schema_json').notNull(),
    baseCostJson: text('base_cost_json'),
    requiresTargetType: text('requires_target_type').notNull().default('none'),
    visibility: text('visibility').notNull().default('public'),
    effectsJson: text('effects_json'),
    enforcementRef: text('enforcement_ref'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => ({
    worldIdx: index('idx_actions_world').on(t.worldId, t.active),
  }),
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    tick: integer('tick').notNull(),
    wallclockTs: text('wallclock_ts').notNull().default(sql`CURRENT_TIMESTAMP`),
    eventType: text('event_type').notNull(),
    actorId: text('actor_id'),
    dataJson: text('data_json').notNull(),
    visibleToJson: text('visible_to_json'),
    tokenCost: integer('token_cost').notNull().default(0),
  },
  (t) => ({
    worldTickIdx: index('idx_events_world_tick').on(t.worldId, t.tick),
    actorIdx: index('idx_events_actor').on(t.actorId),
    typeIdx: index('idx_events_type').on(t.worldId, t.eventType),
  }),
);

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    tick: integer('tick').notNull(),
    fromAgentId: text('from_agent_id')
      .notNull()
      .references(() => agents.id),
    toAgentId: text('to_agent_id').references(() => agents.id),
    toLocationId: text('to_location_id').references(() => locations.id),
    toChannel: text('to_channel'),
    content: text('content').notNull(),
    tone: text('tone'),
    private: integer('private', { mode: 'boolean' }).notNull().default(false),
    heardByJson: text('heard_by_json'),
  },
  (t) => ({
    worldTickIdx: index('idx_messages_world_tick').on(t.worldId, t.tick),
    fromIdx: index('idx_messages_from').on(t.fromAgentId),
  }),
);

export const agentMemories = sqliteTable(
  'agent_memories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    createdTick: integer('created_tick').notNull(),
    memoryType: text('memory_type').notNull(),
    content: text('content').notNull(),
    importance: real('importance').notNull().default(0.5),
    decay: real('decay').notNull().default(1.0),
    relatedEventId: integer('related_event_id'),
    aboutAgentId: text('about_agent_id'),
    embedding: blob('embedding'),
    lastAccessedTick: integer('last_accessed_tick'),
  },
  (t) => ({
    agentIdx: index('idx_memory_agent').on(t.agentId, t.createdTick),
    importanceIdx: index('idx_memory_importance').on(t.agentId, t.importance),
  }),
);

export const relationships = sqliteTable(
  'relationships',
  {
    agentAId: text('agent_a_id')
      .notNull()
      .references(() => agents.id),
    agentBId: text('agent_b_id')
      .notNull()
      .references(() => agents.id),
    affection: real('affection').notNull().default(0),
    trust: real('trust').notNull().default(0),
    respect: real('respect').notNull().default(0),
    familiarity: real('familiarity').notNull().default(0),
    tagsJson: text('tags_json'),
    lastInteractionTick: integer('last_interaction_tick'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentAId, t.agentBId] }),
    aIdx: index('idx_rel_a').on(t.agentAId),
    bIdx: index('idx_rel_b').on(t.agentBId),
  }),
);

export const agreements = sqliteTable(
  'agreements',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    partiesJson: text('parties_json').notNull(),
    terms: text('terms').notNull(),
    compiledTermsJson: text('compiled_terms_json'),
    proposedById: text('proposed_by_id')
      .notNull()
      .references(() => agents.id),
    proposedTick: integer('proposed_tick').notNull(),
    acceptedTick: integer('accepted_tick'),
    endedTick: integer('ended_tick'),
    status: text('status').notNull().default('proposed'),
    violationCount: integer('violation_count').notNull().default(0),
    enforcementMechanism: text('enforcement_mechanism'),
  },
  (t) => ({
    worldIdx: index('idx_agreements_world').on(t.worldId, t.status),
  }),
);

export const godInterventions = sqliteTable('god_interventions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  worldId: text('world_id')
    .notNull()
    .references(() => worlds.id, { onDelete: 'cascade' }),
  queuedTick: integer('queued_tick').notNull(),
  applyAtTick: integer('apply_at_tick').notNull(),
  description: text('description').notNull(),
  compiledEffectsJson: text('compiled_effects_json'),
  applied: integer('applied', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
});

export const tickSnapshots = sqliteTable(
  'tick_snapshots',
  {
    worldId: text('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    tick: integer('tick').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    eventCountUntilHere: integer('event_count_until_here').notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.worldId, t.tick] }),
  }),
);
