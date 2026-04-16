/**
 * WorldStore — the database access layer.
 *
 * All DB interactions go through here. Engine, runtime, CLI all call these
 * methods (never raw SQL). Makes testing + schema evolution manageable.
 *
 * Runtime: Bun. Backed by `bun:sqlite` (built-in, no native-module step)
 * and `drizzle-orm/bun-sqlite`.
 */

import { Database } from 'bun:sqlite';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';

import { migrate } from './db/migrate.js';
import * as s from './db/schema.js';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ActionSchema,
  Agent,
  AgentMemory,
  Event,
  EventType,
  GodIntervention,
  Location,
  MemoryType,
  Message,
  Relationship,
  Resource,
  Rule,
  World,
} from '@chronicle/core';

export class WorldStore {
  private db: Database;
  private orm: BunSQLiteDatabase<typeof s>;

  private constructor(dbPath: string) {
    // Ensure parent directory exists for file-backed DBs
    if (dbPath !== ':memory:') {
      try {
        mkdirSync(dirname(dbPath), { recursive: true });
      } catch {
        /* ok */
      }
    }

    this.db = new Database(dbPath, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.orm = drizzle(this.db, { schema: s });
  }

  static async open(dbPath: string): Promise<WorldStore> {
    const store = new WorldStore(dbPath);
    await migrate(store.db);
    return store;
  }

  close(): void {
    this.db.close();
  }

  // ============================================================
  // WORLD
  // ============================================================

  async createWorld(w: World): Promise<void> {
    await this.orm.insert(s.worlds).values({
      id: w.id,
      name: w.name,
      description: w.description,
      systemPrompt: w.systemPrompt,
      configJson: JSON.stringify(w.config),
      currentTick: w.currentTick,
      status: w.status,
      godBudgetTokens: w.godBudgetTokens ?? null,
      tokensUsed: w.tokensUsed,
      tickDurationDescription: w.tickDurationDescription ?? null,
      dayNightCycleTicks: w.dayNightCycleTicks ?? null,
      createdByChronicle: w.createdByChronicle ?? null,
      forkFromTick: w.forkFromTick ?? null,
      rngSeed: w.rngSeed,
    });
  }

  async loadWorld(id: string): Promise<World> {
    const row = await this.orm.select().from(s.worlds).where(eq(s.worlds.id, id)).get();
    if (!row) throw new Error(`World not found: ${id}`);
    return mapWorldFromRow(row);
  }

  async listWorlds(): Promise<
    Array<Pick<World, 'id' | 'name' | 'currentTick' | 'status' | 'createdAt'>>
  > {
    const rows = await this.orm.select().from(s.worlds).orderBy(desc(s.worlds.createdAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      currentTick: r.currentTick,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  async updateWorldTick(id: string, tick: number): Promise<void> {
    await this.orm.update(s.worlds).set({ currentTick: tick }).where(eq(s.worlds.id, id));
  }

  async updateWorldStatus(id: string, status: World['status']): Promise<void> {
    await this.orm.update(s.worlds).set({ status }).where(eq(s.worlds.id, id));
  }

  async incrementTokensUsed(worldId: string, delta: number): Promise<void> {
    await this.orm
      .update(s.worlds)
      .set({ tokensUsed: sql`tokens_used + ${delta}` })
      .where(eq(s.worlds.id, worldId));
  }

  // ============================================================
  // AGENTS
  // ============================================================

  async createAgent(a: Agent): Promise<void> {
    await this.orm.insert(s.agents).values({
      id: a.id,
      worldId: a.worldId,
      name: a.name,
      persona: a.persona,
      traitsJson: JSON.stringify(a.traits),
      privateStateJson: a.privateState ? JSON.stringify(a.privateState) : null,
      alive: a.alive,
      locationId: a.locationId ?? null,
      mood: a.mood ?? null,
      energy: a.energy,
      health: a.health,
      tokensBudget: a.tokensBudget ?? null,
      tokensSpent: a.tokensSpent,
      sessionId: a.sessionId ?? null,
      sessionStateBlob: a.sessionStateBlob ?? null,
      modelTier: a.modelTier,
      provider: a.provider,
      modelId: a.modelId,
      thinkingLevel: a.thinkingLevel,
      birthTick: a.birthTick,
      deathTick: a.deathTick ?? null,
      parentIdsJson: a.parentIds ? JSON.stringify(a.parentIds) : null,
    });
  }

  async getAgent(id: string): Promise<Agent> {
    const row = await this.orm.select().from(s.agents).where(eq(s.agents.id, id)).get();
    if (!row) throw new Error(`Agent not found: ${id}`);
    return mapAgentFromRow(row);
  }

  async getLiveAgents(worldId: string): Promise<Agent[]> {
    const rows = await this.orm
      .select()
      .from(s.agents)
      .where(and(eq(s.agents.worldId, worldId), eq(s.agents.alive, true)));
    return rows.map(mapAgentFromRow);
  }

  async updateAgentState(
    id: string,
    updates: Partial<
      Pick<
        Agent,
        | 'locationId'
        | 'mood'
        | 'energy'
        | 'health'
        | 'tokensSpent'
        | 'sessionStateBlob'
        | 'alive'
        | 'deathTick'
      >
    >,
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    if (updates.locationId !== undefined) set.locationId = updates.locationId;
    if (updates.mood !== undefined) set.mood = updates.mood;
    if (updates.energy !== undefined) set.energy = updates.energy;
    if (updates.health !== undefined) set.health = updates.health;
    if (updates.tokensSpent !== undefined) set.tokensSpent = updates.tokensSpent;
    if (updates.sessionStateBlob !== undefined) set.sessionStateBlob = updates.sessionStateBlob;
    if (updates.alive !== undefined) set.alive = updates.alive;
    if (updates.deathTick !== undefined) set.deathTick = updates.deathTick;
    if (Object.keys(set).length === 0) return;
    await this.orm.update(s.agents).set(set).where(eq(s.agents.id, id));
  }

  // ============================================================
  // LOCATIONS
  // ============================================================

  async createLocation(loc: Location): Promise<void> {
    await this.orm.insert(s.locations).values({
      id: loc.id,
      worldId: loc.worldId,
      name: loc.name,
      description: loc.description,
      x: loc.x ?? null,
      y: loc.y ?? null,
      parentId: loc.parentId ?? null,
      affordancesJson: JSON.stringify(loc.affordances),
      metadataJson: JSON.stringify(loc.metadata),
      spriteHint: loc.spriteHint ?? null,
    });
  }

  async getLocation(id: string): Promise<Location> {
    const row = await this.orm.select().from(s.locations).where(eq(s.locations.id, id)).get();
    if (!row) throw new Error(`Location not found: ${id}`);
    return mapLocationFromRow(row);
  }

  async getLocationsForWorld(worldId: string): Promise<Location[]> {
    const rows = await this.orm.select().from(s.locations).where(eq(s.locations.worldId, worldId));
    return rows.map(mapLocationFromRow);
  }

  async addAdjacency(from: string, to: string, cost = 1, bidirectional = true): Promise<void> {
    await this.orm.insert(s.locationAdjacencies).values({
      fromLocationId: from,
      toLocationId: to,
      traversalCost: cost,
      bidirectional,
    });
  }

  async getAdjacentLocations(locationId: string): Promise<string[]> {
    const rows = await this.orm
      .select()
      .from(s.locationAdjacencies)
      .where(eq(s.locationAdjacencies.fromLocationId, locationId));
    const ids = rows.map((r) => r.toLocationId);
    const reverse = await this.orm
      .select()
      .from(s.locationAdjacencies)
      .where(
        and(
          eq(s.locationAdjacencies.toLocationId, locationId),
          eq(s.locationAdjacencies.bidirectional, true),
        ),
      );
    for (const r of reverse) if (!ids.includes(r.fromLocationId)) ids.push(r.fromLocationId);
    return ids;
  }

  // ============================================================
  // RESOURCES
  // ============================================================

  async createResource(r: Resource): Promise<void> {
    await this.orm.insert(s.resources).values({
      id: r.id,
      worldId: r.worldId,
      type: r.type,
      ownerAgentId: r.ownerAgentId ?? null,
      ownerLocationId: r.ownerLocationId ?? null,
      quantity: r.quantity,
      metadataJson: JSON.stringify(r.metadata),
    });
  }

  async getResourcesAtLocation(locationId: string): Promise<Resource[]> {
    const rows = await this.orm
      .select()
      .from(s.resources)
      .where(eq(s.resources.ownerLocationId, locationId));
    return rows.map(mapResourceFromRow);
  }

  async getResourcesOwnedBy(agentId: string): Promise<Resource[]> {
    const rows = await this.orm
      .select()
      .from(s.resources)
      .where(eq(s.resources.ownerAgentId, agentId));
    return rows.map(mapResourceFromRow);
  }

  async transferResource(resourceId: string, newOwnerAgentId: string): Promise<void> {
    await this.orm
      .update(s.resources)
      .set({ ownerAgentId: newOwnerAgentId, ownerLocationId: null })
      .where(eq(s.resources.id, resourceId));
  }

  async adjustResourceQuantity(resourceId: string, delta: number): Promise<void> {
    await this.orm
      .update(s.resources)
      .set({ quantity: sql`quantity + ${delta}` })
      .where(eq(s.resources.id, resourceId));
  }

  // ============================================================
  // RULES
  // ============================================================

  async createRule(r: Rule): Promise<void> {
    await this.orm.insert(s.rules).values({
      id: r.id,
      worldId: r.worldId,
      description: r.description,
      tier: r.tier,
      hardPredicate: r.hardPredicate ?? null,
      hardCheck: r.hardCheck ?? null,
      hardOnViolation: r.hardOnViolation ?? null,
      softNormText: r.softNormText ?? null,
      softDetectionPrompt: r.softDetectionPrompt ?? null,
      softConsequence: r.softConsequence ?? null,
      economicActionType: r.economicActionType ?? null,
      economicCostFormula: r.economicCostFormula ?? null,
      active: r.active,
      priority: r.priority,
      scopeJson: r.scope ? JSON.stringify(r.scope) : null,
      createdByTick: r.createdByTick ?? null,
      compilerNotes: r.compilerNotes ?? null,
    });
  }

  async getActiveRules(worldId: string): Promise<Rule[]> {
    const rows = await this.orm
      .select()
      .from(s.rules)
      .where(and(eq(s.rules.worldId, worldId), eq(s.rules.active, true)))
      .orderBy(desc(s.rules.priority));
    return rows.map(mapRuleFromRow);
  }

  // ============================================================
  // ACTION SCHEMAS
  // ============================================================

  async createActionSchema(a: ActionSchema): Promise<void> {
    await this.orm.insert(s.actionSchemas).values({
      id: a.id,
      worldId: a.worldId,
      name: a.name,
      description: a.description,
      parametersSchemaJson: JSON.stringify(a.parametersSchema),
      baseCostJson: JSON.stringify(a.baseCost),
      requiresTargetType: a.requiresTargetType,
      visibility: a.visibility,
      effectsJson: JSON.stringify(a.effects),
      enforcementRef: a.enforcementRef ?? null,
      active: a.active,
    });
  }

  async getActiveActionSchemas(worldId: string): Promise<ActionSchema[]> {
    const rows = await this.orm
      .select()
      .from(s.actionSchemas)
      .where(and(eq(s.actionSchemas.worldId, worldId), eq(s.actionSchemas.active, true)));
    return rows.map(mapActionSchemaFromRow);
  }

  // ============================================================
  // EVENTS
  // ============================================================

  async recordEvent(e: {
    worldId: string;
    tick: number;
    eventType: EventType;
    actorId?: string | null;
    data: Record<string, unknown>;
    visibleTo?: string[];
    tokenCost?: number;
  }): Promise<number> {
    const result = await this.orm
      .insert(s.events)
      .values({
        worldId: e.worldId,
        tick: e.tick,
        eventType: e.eventType,
        actorId: e.actorId ?? null,
        dataJson: JSON.stringify(e.data),
        visibleToJson: e.visibleTo ? JSON.stringify(e.visibleTo) : null,
        tokenCost: e.tokenCost ?? 0,
      })
      .returning({ id: s.events.id });
    return result[0]!.id;
  }

  async getRecentEvents(worldId: string, sinceTick: number): Promise<Event[]> {
    const rows = await this.orm
      .select()
      .from(s.events)
      .where(and(eq(s.events.worldId, worldId), gte(s.events.tick, sinceTick)))
      .orderBy(asc(s.events.tick), asc(s.events.id));
    return rows.map(mapEventFromRow);
  }

  async getEventsInRange(worldId: string, fromTick: number, toTick: number): Promise<Event[]> {
    const rows = await this.orm
      .select()
      .from(s.events)
      .where(
        and(
          eq(s.events.worldId, worldId),
          gte(s.events.tick, fromTick),
          lte(s.events.tick, toTick),
        ),
      )
      .orderBy(asc(s.events.tick), asc(s.events.id));
    return rows.map(mapEventFromRow);
  }

  // ============================================================
  // MEMORIES
  // ============================================================

  async addMemory(m: Omit<AgentMemory, 'id'>): Promise<number> {
    const result = await this.orm
      .insert(s.agentMemories)
      .values({
        agentId: m.agentId,
        createdTick: m.createdTick,
        memoryType: m.memoryType,
        content: m.content,
        importance: m.importance,
        decay: m.decay,
        relatedEventId: m.relatedEventId ?? null,
        aboutAgentId: m.aboutAgentId ?? null,
        embedding: m.embedding ?? null,
        lastAccessedTick: m.lastAccessedTick ?? null,
      })
      .returning({ id: s.agentMemories.id });
    return result[0]!.id;
  }

  async getMemoriesForAgent(agentId: string, limit = 100): Promise<AgentMemory[]> {
    const rows = await this.orm
      .select()
      .from(s.agentMemories)
      .where(eq(s.agentMemories.agentId, agentId))
      .orderBy(desc(s.agentMemories.importance), desc(s.agentMemories.createdTick))
      .limit(limit);
    return rows.map(mapMemoryFromRow);
  }

  async updateMemoryAccessed(id: number, tick: number): Promise<void> {
    await this.orm
      .update(s.agentMemories)
      .set({ lastAccessedTick: tick })
      .where(eq(s.agentMemories.id, id));
  }

  // ============================================================
  // MESSAGES
  // ============================================================

  async recordMessage(m: Omit<Message, 'id'>): Promise<number> {
    const result = await this.orm
      .insert(s.messages)
      .values({
        worldId: m.worldId,
        tick: m.tick,
        fromAgentId: m.fromAgentId,
        toAgentId: m.toAgentId ?? null,
        toLocationId: m.toLocationId ?? null,
        toChannel: m.toChannel ?? null,
        content: m.content,
        tone: m.tone ?? null,
        private: m.private,
        heardByJson: JSON.stringify(m.heardBy),
      })
      .returning({ id: s.messages.id });
    return result[0]!.id;
  }

  async getMessagesForTick(worldId: string, tick: number): Promise<Message[]> {
    const rows = await this.orm
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.worldId, worldId), eq(s.messages.tick, tick)));
    return rows.map(mapMessageFromRow);
  }

  // ============================================================
  // RELATIONSHIPS
  // ============================================================

  async upsertRelationship(r: Relationship): Promise<void> {
    await this.orm
      .insert(s.relationships)
      .values({
        agentAId: r.agentAId,
        agentBId: r.agentBId,
        affection: r.affection,
        trust: r.trust,
        respect: r.respect,
        familiarity: r.familiarity,
        tagsJson: JSON.stringify(r.tags),
        lastInteractionTick: r.lastInteractionTick ?? null,
      })
      .onConflictDoUpdate({
        target: [s.relationships.agentAId, s.relationships.agentBId],
        set: {
          affection: r.affection,
          trust: r.trust,
          respect: r.respect,
          familiarity: r.familiarity,
          tagsJson: JSON.stringify(r.tags),
          lastInteractionTick: r.lastInteractionTick ?? null,
        },
      });
  }

  async getRelationshipsFrom(agentId: string): Promise<Relationship[]> {
    const rows = await this.orm
      .select()
      .from(s.relationships)
      .where(eq(s.relationships.agentAId, agentId));
    return rows.map(mapRelationshipFromRow);
  }

  // ============================================================
  // GOD INTERVENTIONS
  // ============================================================

  async queueIntervention(i: Omit<GodIntervention, 'id' | 'applied'>): Promise<number> {
    const result = await this.orm
      .insert(s.godInterventions)
      .values({
        worldId: i.worldId,
        queuedTick: i.queuedTick,
        applyAtTick: i.applyAtTick,
        description: i.description,
        compiledEffectsJson: i.compiledEffects ? JSON.stringify(i.compiledEffects) : null,
        applied: false,
        notes: i.notes ?? null,
      })
      .returning({ id: s.godInterventions.id });
    return result[0]!.id;
  }

  async getPendingInterventions(worldId: string, tick: number): Promise<GodIntervention[]> {
    const rows = await this.orm
      .select()
      .from(s.godInterventions)
      .where(
        and(
          eq(s.godInterventions.worldId, worldId),
          lte(s.godInterventions.applyAtTick, tick),
          eq(s.godInterventions.applied, false),
        ),
      );
    return rows.map(mapInterventionFromRow);
  }

  async markInterventionApplied(id: number): Promise<void> {
    await this.orm
      .update(s.godInterventions)
      .set({ applied: true })
      .where(eq(s.godInterventions.id, id));
  }

  // ============================================================
  // SNAPSHOTS
  // ============================================================

  async snapshot(
    worldId: string,
    tick: number,
    snapshotJson: string,
    eventCount: number,
  ): Promise<void> {
    await this.orm
      .insert(s.tickSnapshots)
      .values({
        worldId,
        tick,
        snapshotJson,
        eventCountUntilHere: eventCount,
      })
      .onConflictDoNothing();
  }

  // ============================================================
  // RAW ACCESS (for advanced queries)
  // ============================================================

  get raw(): Database {
    return this.db;
  }
  get ormHandle() {
    return this.orm;
  }
}

// ============================================================
// Row → Domain mappers (DB layer to core types)
// ============================================================

function mapWorldFromRow(r: typeof s.worlds.$inferSelect): World {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    systemPrompt: r.systemPrompt,
    config: JSON.parse(r.configJson),
    currentTick: r.currentTick,
    status: r.status,
    godBudgetTokens: r.godBudgetTokens,
    tokensUsed: r.tokensUsed,
    tickDurationDescription: r.tickDurationDescription,
    dayNightCycleTicks: r.dayNightCycleTicks,
    createdAt: r.createdAt,
    createdByChronicle: r.createdByChronicle,
    forkFromTick: r.forkFromTick,
    rngSeed: r.rngSeed,
  };
}

function mapAgentFromRow(r: typeof s.agents.$inferSelect): Agent {
  return {
    id: r.id,
    worldId: r.worldId,
    name: r.name,
    persona: r.persona,
    traits: JSON.parse(r.traitsJson),
    privateState: r.privateStateJson ? JSON.parse(r.privateStateJson) : null,
    alive: r.alive,
    locationId: r.locationId,
    mood: r.mood,
    energy: r.energy,
    health: r.health,
    tokensBudget: r.tokensBudget,
    tokensSpent: r.tokensSpent,
    sessionId: r.sessionId,
    sessionStateBlob: r.sessionStateBlob ? (r.sessionStateBlob as Uint8Array) : null,
    modelTier: r.modelTier,
    provider: r.provider,
    modelId: r.modelId,
    thinkingLevel: r.thinkingLevel as Agent['thinkingLevel'],
    birthTick: r.birthTick,
    deathTick: r.deathTick,
    parentIds: r.parentIdsJson ? JSON.parse(r.parentIdsJson) : null,
    createdAt: r.createdAt,
  };
}

function mapLocationFromRow(r: typeof s.locations.$inferSelect): Location {
  return {
    id: r.id,
    worldId: r.worldId,
    name: r.name,
    description: r.description,
    x: r.x,
    y: r.y,
    parentId: r.parentId,
    affordances: r.affordancesJson ? JSON.parse(r.affordancesJson) : [],
    metadata: r.metadataJson ? JSON.parse(r.metadataJson) : {},
    spriteHint: r.spriteHint,
    createdAt: r.createdAt,
  };
}

function mapResourceFromRow(r: typeof s.resources.$inferSelect): Resource {
  return {
    id: r.id,
    worldId: r.worldId,
    type: r.type,
    ownerAgentId: r.ownerAgentId,
    ownerLocationId: r.ownerLocationId,
    quantity: r.quantity,
    metadata: r.metadataJson ? JSON.parse(r.metadataJson) : {},
  };
}

function mapRuleFromRow(r: typeof s.rules.$inferSelect): Rule {
  return {
    id: r.id,
    worldId: r.worldId,
    description: r.description,
    tier: r.tier as Rule['tier'],
    hardPredicate: r.hardPredicate ?? undefined,
    hardCheck: r.hardCheck ?? undefined,
    hardOnViolation: r.hardOnViolation ?? undefined,
    softNormText: r.softNormText ?? undefined,
    softDetectionPrompt: r.softDetectionPrompt ?? undefined,
    softConsequence: r.softConsequence ?? undefined,
    economicActionType: r.economicActionType ?? undefined,
    economicCostFormula: r.economicCostFormula ?? undefined,
    active: r.active,
    priority: r.priority,
    scope: r.scopeJson ? JSON.parse(r.scopeJson) : undefined,
    createdAt: r.createdAt,
    createdByTick: r.createdByTick,
    compilerNotes: r.compilerNotes,
  };
}

function mapActionSchemaFromRow(r: typeof s.actionSchemas.$inferSelect): ActionSchema {
  return {
    id: r.id,
    worldId: r.worldId,
    name: r.name,
    description: r.description,
    parametersSchema: JSON.parse(r.parametersSchemaJson),
    baseCost: r.baseCostJson ? JSON.parse(r.baseCostJson) : {},
    requiresTargetType: r.requiresTargetType as ActionSchema['requiresTargetType'],
    visibility: r.visibility,
    effects: r.effectsJson ? JSON.parse(r.effectsJson) : {},
    enforcementRef: r.enforcementRef,
    active: r.active,
  };
}

function mapEventFromRow(r: typeof s.events.$inferSelect): Event {
  return {
    id: r.id,
    worldId: r.worldId,
    tick: r.tick,
    wallclockTs: r.wallclockTs,
    eventType: r.eventType as EventType,
    actorId: r.actorId,
    data: JSON.parse(r.dataJson),
    visibleTo: r.visibleToJson ? JSON.parse(r.visibleToJson) : [],
    tokenCost: r.tokenCost,
  };
}

function mapMessageFromRow(r: typeof s.messages.$inferSelect): Message {
  return {
    id: r.id,
    worldId: r.worldId,
    tick: r.tick,
    fromAgentId: r.fromAgentId,
    toAgentId: r.toAgentId,
    toLocationId: r.toLocationId,
    toChannel: r.toChannel,
    content: r.content,
    tone: r.tone,
    private: r.private,
    heardBy: r.heardByJson ? JSON.parse(r.heardByJson) : [],
  };
}

function mapMemoryFromRow(r: typeof s.agentMemories.$inferSelect): AgentMemory {
  return {
    id: r.id,
    agentId: r.agentId,
    createdTick: r.createdTick,
    memoryType: r.memoryType as MemoryType,
    content: r.content,
    importance: r.importance,
    decay: r.decay,
    relatedEventId: r.relatedEventId,
    aboutAgentId: r.aboutAgentId,
    embedding: r.embedding ? (r.embedding as Uint8Array) : null,
    lastAccessedTick: r.lastAccessedTick,
  };
}

function mapRelationshipFromRow(r: typeof s.relationships.$inferSelect): Relationship {
  return {
    agentAId: r.agentAId,
    agentBId: r.agentBId,
    affection: r.affection,
    trust: r.trust,
    respect: r.respect,
    familiarity: r.familiarity,
    tags: r.tagsJson ? JSON.parse(r.tagsJson) : [],
    lastInteractionTick: r.lastInteractionTick,
  };
}

function mapInterventionFromRow(r: typeof s.godInterventions.$inferSelect): GodIntervention {
  return {
    id: r.id,
    worldId: r.worldId,
    queuedTick: r.queuedTick,
    applyAtTick: r.applyAtTick,
    description: r.description,
    compiledEffects: r.compiledEffectsJson ? JSON.parse(r.compiledEffectsJson) : null,
    applied: r.applied,
    notes: r.notes,
  };
}
