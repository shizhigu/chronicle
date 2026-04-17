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
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';

import { migrate } from './db/migrate.js';
import * as s from './db/schema.js';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ActionSchema,
  Agent,
  Authority,
  AuthorityHolderKind,
  AuthorityPower,
  Effect,
  Event,
  EventType,
  GodIntervention,
  Group,
  GroupMembership,
  GroupRole,
  Location,
  Message,
  Proposal,
  ProposalStatus,
  Relationship,
  Resource,
  Rule,
  Vote,
  World,
} from '@chronicle/core';

// ============================================================
// Domain errors — thrown from store methods so callers can branch on
// type instead of parsing SQLite error strings.
// ============================================================

export class AlreadyMemberError extends Error {
  constructor(
    public groupId: string,
    public agentId: string,
  ) {
    super(`agent ${agentId} already an active member of ${groupId}`);
    this.name = 'AlreadyMemberError';
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  // bun:sqlite surfaces these with code 'SQLITE_CONSTRAINT_UNIQUE' on
  // either the error itself or a wrapped `.cause`. Check both.
  const code = (err as { code?: string } | null)?.code;
  const causeCode = (err as { cause?: { code?: string } } | null)?.cause?.code;
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT' ||
    causeCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    causeCode === 'SQLITE_CONSTRAINT'
  );
}

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
      lastActiveTick: a.lastActiveTick ?? null,
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

  // Unlike getLiveAgents, includes dead rows. Separate method (rather
  // than an includeDead flag on the above) so the common hot path stays
  // a single-predicate query and callers can't forget to filter.
  async getAllAgents(worldId: string): Promise<Agent[]> {
    const rows = await this.orm.select().from(s.agents).where(eq(s.agents.worldId, worldId));
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
        | 'lastActiveTick'
        | 'persona'
        | 'privateState'
        | 'traits'
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
    if (updates.lastActiveTick !== undefined) set.lastActiveTick = updates.lastActiveTick;
    if (updates.persona !== undefined) set.persona = updates.persona;
    if (updates.privateState !== undefined) {
      set.privateStateJson =
        updates.privateState === null ? null : JSON.stringify(updates.privateState);
    }
    if (updates.traits !== undefined) set.traitsJson = JSON.stringify(updates.traits);
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
      scopeKind: r.scopeKind ?? 'world',
      scopeRef: r.scopeRef ?? null,
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

  /**
   * Cursor-style query used by the dashboard DbEventRelay (ADR follow-up
   * to ADR-0003): fetch events with id greater than the cursor, in order,
   * so polling can advance without re-processing rows. Unlike
   * `getEventsInRange` this is by id, not tick — two events in the same
   * tick are still delivered in deterministic id order.
   */
  async getEventsAfter(worldId: string, afterId: number, limit = 500): Promise<Event[]> {
    const rows = await this.orm
      .select()
      .from(s.events)
      .where(and(eq(s.events.worldId, worldId), sql`${s.events.id} > ${afterId}`))
      .orderBy(asc(s.events.id))
      .limit(limit);
    return rows.map(mapEventFromRow);
  }

  // ============================================================
  // MEMORIES — moved out of the DB.
  //
  // Durable character memory now lives in a per-character markdown
  // file managed by @chronicle/engine's MemoryFileStore (hermes-agent
  // pattern). This table was removed; the store never owned retrieval
  // anyway (MemoryService did keyword scoring in-memory), and the
  // DB-backed format made memory opaque to users and unfriendly to
  // backup/export.
  // ============================================================

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

  /**
   * All god interventions for a world, applied + pending. Used by the
   * export path so a mid-run snapshot preserves any queued CC edits
   * (`chronicle intervene` / `apply-effect` / `edit-character`)
   * alongside the rest of the world state.
   */
  async getAllInterventionsForWorld(worldId: string): Promise<GodIntervention[]> {
    const rows = await this.orm
      .select()
      .from(s.godInterventions)
      .where(eq(s.godInterventions.worldId, worldId));
    return rows.map(mapInterventionFromRow);
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
  // GOVERNANCE — groups, memberships, roles, authorities
  // (ADR-0009 Layer 1)
  // ============================================================

  async createGroup(g: Group): Promise<void> {
    await this.orm.insert(s.groups).values({
      id: g.id,
      worldId: g.worldId,
      name: g.name,
      description: g.description,
      procedureKind: g.procedureKind,
      procedureConfigJson: JSON.stringify(g.procedureConfig ?? {}),
      joinPredicate: g.joinPredicate ?? null,
      successionKind: g.successionKind ?? null,
      visibilityPolicy: g.visibilityPolicy,
      foundedTick: g.foundedTick,
      dissolvedTick: g.dissolvedTick ?? null,
    });
  }

  async getGroup(id: string): Promise<Group | null> {
    const rows = await this.orm.select().from(s.groups).where(eq(s.groups.id, id)).limit(1);
    return rows[0] ? mapGroupFromRow(rows[0]) : null;
  }

  async getGroupsForWorld(worldId: string, includeDissolved = false): Promise<Group[]> {
    const whereExpr = includeDissolved
      ? eq(s.groups.worldId, worldId)
      : and(eq(s.groups.worldId, worldId), isNull(s.groups.dissolvedTick));
    const rows = await this.orm.select().from(s.groups).where(whereExpr);
    return rows.map(mapGroupFromRow);
  }

  async dissolveGroup(id: string, tick: number): Promise<void> {
    await this.orm.update(s.groups).set({ dissolvedTick: tick }).where(eq(s.groups.id, id));
  }

  /**
   * Enroll `agentId` in `groupId` at `joinedTick`. If the agent already
   * has an active membership, this throws `AlreadyMemberError` — the
   * partial unique index `idx_memberships_one_active` prevents silent
   * duplicates under concurrent joins. Callers that treat this as a
   * no-op should check `isMember` first.
   */
  async addMembership(groupId: string, agentId: string, joinedTick: number): Promise<void> {
    try {
      await this.orm.insert(s.groupMemberships).values({
        groupId,
        agentId,
        joinedTick,
        leftTick: null,
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AlreadyMemberError(groupId, agentId);
      }
      throw err;
    }
  }

  /**
   * Mark the agent's current (leftTick=NULL) membership as ended at `tick`.
   * No-op if the agent is not currently a member — callers should check
   * first if they need strict semantics.
   */
  async removeMembership(groupId: string, agentId: string, tick: number): Promise<void> {
    await this.orm
      .update(s.groupMemberships)
      .set({ leftTick: tick })
      .where(
        and(
          eq(s.groupMemberships.groupId, groupId),
          eq(s.groupMemberships.agentId, agentId),
          isNull(s.groupMemberships.leftTick),
        ),
      );
  }

  async getActiveMembershipsForGroup(groupId: string): Promise<GroupMembership[]> {
    const rows = await this.orm
      .select()
      .from(s.groupMemberships)
      .where(and(eq(s.groupMemberships.groupId, groupId), isNull(s.groupMemberships.leftTick)));
    return rows.map(mapMembershipFromRow);
  }

  async getActiveMembershipsForAgent(agentId: string): Promise<GroupMembership[]> {
    const rows = await this.orm
      .select()
      .from(s.groupMemberships)
      .where(and(eq(s.groupMemberships.agentId, agentId), isNull(s.groupMemberships.leftTick)));
    return rows.map(mapMembershipFromRow);
  }

  async isMember(groupId: string, agentId: string): Promise<boolean> {
    const rows = await this.orm
      .select({ g: s.groupMemberships.groupId })
      .from(s.groupMemberships)
      .where(
        and(
          eq(s.groupMemberships.groupId, groupId),
          eq(s.groupMemberships.agentId, agentId),
          isNull(s.groupMemberships.leftTick),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Upsert a role row. Rows are keyed by (groupId, roleName) so writing
   * the same role again overwrites holder / weight / scope. Use this for
   * both creation and reassignment.
   */
  async upsertGroupRole(role: GroupRole): Promise<void> {
    await this.orm
      .insert(s.groupRoles)
      .values({
        groupId: role.groupId,
        roleName: role.roleName,
        holderAgentId: role.holderAgentId ?? null,
        assignedTick: role.assignedTick ?? null,
        votingWeight: role.votingWeight,
        scopeRef: role.scopeRef ?? null,
      })
      .onConflictDoUpdate({
        target: [s.groupRoles.groupId, s.groupRoles.roleName],
        set: {
          holderAgentId: role.holderAgentId ?? null,
          assignedTick: role.assignedTick ?? null,
          votingWeight: role.votingWeight,
          scopeRef: role.scopeRef ?? null,
        },
      });
  }

  async getGroupRole(groupId: string, roleName: string): Promise<GroupRole | null> {
    const rows = await this.orm
      .select()
      .from(s.groupRoles)
      .where(and(eq(s.groupRoles.groupId, groupId), eq(s.groupRoles.roleName, roleName)))
      .limit(1);
    return rows[0] ? mapGroupRoleFromRow(rows[0]) : null;
  }

  async getRolesForGroup(groupId: string): Promise<GroupRole[]> {
    const rows = await this.orm
      .select()
      .from(s.groupRoles)
      .where(eq(s.groupRoles.groupId, groupId));
    return rows.map(mapGroupRoleFromRow);
  }

  async grantAuthority(a: Authority): Promise<void> {
    // World-boundary check: the holder must live in the same world as
    // the authority. Without this guard, a crafted scenario (or a bug
    // in Layer 2 effect compilers) could attach an authority to an
    // agent/group in a different world. The `authorities` table has
    // no FK to agents/groups because the holder is polymorphic; we
    // enforce the invariant here in the one write path instead.
    if (a.holderKind === 'agent') {
      const owner = await this.getAgent(a.holderRef).catch(() => null);
      if (!owner || owner.worldId !== a.worldId) {
        throw new Error(`grantAuthority: agent holder ${a.holderRef} not in world ${a.worldId}`);
      }
    } else if (a.holderKind === 'group') {
      const group = await this.getGroup(a.holderRef);
      if (!group || group.worldId !== a.worldId) {
        throw new Error(`grantAuthority: group holder ${a.holderRef} not in world ${a.worldId}`);
      }
    } else {
      // role: holderRef is "groupId#roleName"
      const [gid] = a.holderRef.split('#');
      if (!gid) {
        throw new Error(`grantAuthority: malformed role holderRef ${a.holderRef}`);
      }
      const group = await this.getGroup(gid);
      if (!group || group.worldId !== a.worldId) {
        throw new Error(`grantAuthority: role holder ${a.holderRef} not in world ${a.worldId}`);
      }
    }

    await this.orm.insert(s.authorities).values({
      id: a.id,
      worldId: a.worldId,
      holderKind: a.holderKind,
      holderRef: a.holderRef,
      powersJson: JSON.stringify(a.powers),
      grantedTick: a.grantedTick,
      expiresTick: a.expiresTick ?? null,
      sourceEventId: a.sourceEventId ?? null,
      revokedTick: a.revokedTick ?? null,
      revocationEventId: a.revocationEventId ?? null,
    });
  }

  async revokeAuthority(id: string, tick: number, eventId: number | null = null): Promise<void> {
    await this.orm
      .update(s.authorities)
      .set({ revokedTick: tick, revocationEventId: eventId })
      .where(eq(s.authorities.id, id));
  }

  /**
   * All authorities for a world that are still in force at `atTick`.
   * Filters out revoked and expired rows. Pass `atTick = world.currentTick + 1`
   * when evaluating whether an in-progress action should be authorised.
   */
  async getActiveAuthoritiesForWorld(worldId: string, atTick: number): Promise<Authority[]> {
    const rows = await this.orm
      .select()
      .from(s.authorities)
      .where(
        and(
          eq(s.authorities.worldId, worldId),
          isNull(s.authorities.revokedTick),
          or(isNull(s.authorities.expiresTick), gte(s.authorities.expiresTick, atTick)),
        ),
      );
    return rows.map(mapAuthorityFromRow);
  }

  /**
   * Authorities whose `holder_ref` points at a given holder directly.
   * Does NOT resolve role-chain (i.e. if agent holds a role whose
   * holderRef is `groupId#role`, this query won't return it). Callers
   * that need full resolution should combine this with role + membership
   * lookups. See enforcer for the resolver.
   */
  async getAuthoritiesForHolder(
    worldId: string,
    holderKind: AuthorityHolderKind,
    holderRef: string,
    atTick: number,
  ): Promise<Authority[]> {
    const rows = await this.orm
      .select()
      .from(s.authorities)
      .where(
        and(
          eq(s.authorities.worldId, worldId),
          eq(s.authorities.holderKind, holderKind),
          eq(s.authorities.holderRef, holderRef),
          isNull(s.authorities.revokedTick),
          or(isNull(s.authorities.expiresTick), gte(s.authorities.expiresTick, atTick)),
        ),
      );
    return rows.map(mapAuthorityFromRow);
  }

  // ============================================================
  // PROPOSALS + VOTES  (ADR-0009 Layer 2)
  // ============================================================

  async createProposal(p: Proposal): Promise<void> {
    await this.orm.insert(s.proposals).values({
      id: p.id,
      worldId: p.worldId,
      sponsorAgentId: p.sponsorAgentId,
      targetGroupId: p.targetGroupId,
      title: p.title,
      rationale: p.rationale,
      effectsJson: JSON.stringify(p.effects),
      compiledEffectsJson: p.compiledEffects ? JSON.stringify(p.compiledEffects) : null,
      openedTick: p.openedTick,
      deadlineJson: JSON.stringify(p.deadline),
      procedureOverrideJson: p.procedureOverride ? JSON.stringify(p.procedureOverride) : null,
      status: p.status,
      decidedTick: p.decidedTick ?? null,
      outcomeDetail: p.outcomeDetail ?? null,
    });
  }

  async getProposal(id: string): Promise<Proposal | null> {
    const rows = await this.orm.select().from(s.proposals).where(eq(s.proposals.id, id)).limit(1);
    return rows[0] ? mapProposalFromRow(rows[0]) : null;
  }

  async getPendingProposals(worldId: string): Promise<Proposal[]> {
    const rows = await this.orm
      .select()
      .from(s.proposals)
      .where(and(eq(s.proposals.worldId, worldId), eq(s.proposals.status, 'pending')));
    return rows.map(mapProposalFromRow);
  }

  async getProposalsForGroup(groupId: string, status?: ProposalStatus): Promise<Proposal[]> {
    const whereExpr = status
      ? and(eq(s.proposals.targetGroupId, groupId), eq(s.proposals.status, status))
      : eq(s.proposals.targetGroupId, groupId);
    const rows = await this.orm.select().from(s.proposals).where(whereExpr);
    return rows.map(mapProposalFromRow);
  }

  /**
   * Every proposal in the world, regardless of status. Used by export
   * to snapshot the governance layer so `.chronicle` archives don't
   * drop adopted/rejected/expired proposals on round-trip.
   */
  async getAllProposalsForWorld(worldId: string): Promise<Proposal[]> {
    const rows = await this.orm.select().from(s.proposals).where(eq(s.proposals.worldId, worldId));
    return rows.map(mapProposalFromRow);
  }

  /**
   * Every membership (active + historical) for a group. The active
   * variant filters `left_tick IS NULL` which is correct for
   * runtime queries but loses the audit trail on export — a
   * restored world needs to be able to surface "Alice was briefly
   * a member between ticks 4 and 9".
   */
  async getAllMembershipsForGroup(groupId: string): Promise<GroupMembership[]> {
    const rows = await this.orm
      .select()
      .from(s.groupMemberships)
      .where(eq(s.groupMemberships.groupId, groupId));
    return rows.map(mapMembershipFromRow);
  }

  /**
   * Every authority for the world (including revoked / expired).
   * `getActiveAuthoritiesForWorld` filters for currently-valid ones,
   * but exports want the full history so a replay can see the
   * revocation event's target.
   */
  async getAllAuthoritiesForWorld(worldId: string): Promise<Authority[]> {
    const rows = await this.orm
      .select()
      .from(s.authorities)
      .where(eq(s.authorities.worldId, worldId));
    return rows.map(mapAuthorityFromRow);
  }

  /**
   * Every resource in the world — location-held AND agent-held. Exports
   * flatten the inventory state so restored worlds don't silently start
   * with empty pockets.
   */
  async getAllResourcesForWorld(worldId: string): Promise<Resource[]> {
    const rows = await this.orm.select().from(s.resources).where(eq(s.resources.worldId, worldId));
    return rows.map(mapResourceFromRow);
  }

  /**
   * All location adjacency edges for a world. Used by export to
   * preserve the graph layout — the locations themselves round-trip
   * fine, but without edges every destination would be unreachable.
   */
  async getAllAdjacencies(
    worldId: string,
  ): Promise<Array<{ fromId: string; toId: string; cost: number; bidirectional: boolean }>> {
    // Adjacency rows aren't scoped to worldId directly; they're
    // keyed by location ids. Pull the world's locations first, then
    // filter edges to those whose from/to are in the location set.
    const locs = await this.orm
      .select({ id: s.locations.id })
      .from(s.locations)
      .where(eq(s.locations.worldId, worldId));
    const locIds = new Set(locs.map((l) => l.id));
    if (locIds.size === 0) return [];
    const rows = await this.orm.select().from(s.locationAdjacencies);
    return rows
      .filter((r) => locIds.has(r.fromLocationId) && locIds.has(r.toLocationId))
      .map((r) => ({
        fromId: r.fromLocationId,
        toId: r.toLocationId,
        cost: r.cost,
        bidirectional: Boolean(r.bidirectional),
      }));
  }

  async updateProposalStatus(
    id: string,
    status: ProposalStatus,
    decidedTick: number,
    outcomeDetail: string | null,
  ): Promise<void> {
    await this.orm
      .update(s.proposals)
      .set({ status, decidedTick, outcomeDetail })
      .where(eq(s.proposals.id, id));
  }

  async updateProposalCompiledEffects(id: string, compiled: Effect[]): Promise<void> {
    await this.orm
      .update(s.proposals)
      .set({ compiledEffectsJson: JSON.stringify(compiled) })
      .where(eq(s.proposals.id, id));
  }

  /**
   * Cast a vote. Overwrites any previous stance by the same voter on
   * the same proposal (mind-changing is normal in politics). The PK
   * ensures one row per (proposal, voter).
   */
  async castVote(v: Vote): Promise<void> {
    await this.orm
      .insert(s.votes)
      .values({
        proposalId: v.proposalId,
        voterAgentId: v.voterAgentId,
        stance: v.stance,
        weight: v.weight,
        castTick: v.castTick,
        reasoning: v.reasoning ?? null,
      })
      .onConflictDoUpdate({
        target: [s.votes.proposalId, s.votes.voterAgentId],
        set: {
          stance: v.stance,
          weight: v.weight,
          castTick: v.castTick,
          reasoning: v.reasoning ?? null,
        },
      });
  }

  async getVotesForProposal(proposalId: string): Promise<Vote[]> {
    const rows = await this.orm.select().from(s.votes).where(eq(s.votes.proposalId, proposalId));
    return rows.map(mapVoteFromRow);
  }

  /**
   * Fast check for ActivationService: does this agent currently have
   * ANY pending proposal in ANY active group they belong to where
   * they have not yet cast a vote? Single indexed query — O(1) in
   * round-trips regardless of how many groups / proposals exist.
   */
  async hasUncastGroupVote(agentId: string): Promise<boolean> {
    const db = this.db;
    const row = db
      .query<{ n: number }, [string, string]>(
        `SELECT 1 AS n
           FROM proposals p
           JOIN group_memberships m
             ON m.group_id = p.target_group_id
            AND m.agent_id = ?
            AND m.left_tick IS NULL
           LEFT JOIN votes v
             ON v.proposal_id = p.id
            AND v.voter_agent_id = ?
          WHERE p.status = 'pending'
            AND v.proposal_id IS NULL
          LIMIT 1`,
      )
      .get(agentId, agentId);
    return row !== null;
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
    lastActiveTick: r.lastActiveTick,
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
    scopeKind: r.scopeKind as Rule['scopeKind'],
    scopeRef: r.scopeRef,
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

function mapGroupFromRow(r: typeof s.groups.$inferSelect): Group {
  return {
    id: r.id,
    worldId: r.worldId,
    name: r.name,
    description: r.description,
    procedureKind: r.procedureKind as Group['procedureKind'],
    procedureConfig: r.procedureConfigJson ? JSON.parse(r.procedureConfigJson) : {},
    joinPredicate: r.joinPredicate,
    successionKind: (r.successionKind as Group['successionKind']) ?? null,
    visibilityPolicy: r.visibilityPolicy as Group['visibilityPolicy'],
    foundedTick: r.foundedTick,
    dissolvedTick: r.dissolvedTick,
    createdAt: r.createdAt,
  };
}

function mapMembershipFromRow(r: typeof s.groupMemberships.$inferSelect): GroupMembership {
  return {
    groupId: r.groupId,
    agentId: r.agentId,
    joinedTick: r.joinedTick,
    leftTick: r.leftTick,
  };
}

function mapGroupRoleFromRow(r: typeof s.groupRoles.$inferSelect): GroupRole {
  return {
    groupId: r.groupId,
    roleName: r.roleName,
    holderAgentId: r.holderAgentId,
    assignedTick: r.assignedTick,
    votingWeight: r.votingWeight,
    scopeRef: r.scopeRef,
  };
}

function mapAuthorityFromRow(r: typeof s.authorities.$inferSelect): Authority {
  return {
    id: r.id,
    worldId: r.worldId,
    holderKind: r.holderKind as Authority['holderKind'],
    holderRef: r.holderRef,
    powers: JSON.parse(r.powersJson) as AuthorityPower[],
    grantedTick: r.grantedTick,
    expiresTick: r.expiresTick,
    sourceEventId: r.sourceEventId,
    revokedTick: r.revokedTick,
    revocationEventId: r.revocationEventId,
  };
}

function mapProposalFromRow(r: typeof s.proposals.$inferSelect): Proposal {
  return {
    id: r.id,
    worldId: r.worldId,
    sponsorAgentId: r.sponsorAgentId,
    targetGroupId: r.targetGroupId,
    title: r.title,
    rationale: r.rationale,
    effects: JSON.parse(r.effectsJson) as Effect[],
    compiledEffects: r.compiledEffectsJson ? (JSON.parse(r.compiledEffectsJson) as Effect[]) : null,
    openedTick: r.openedTick,
    deadline: JSON.parse(r.deadlineJson) as Proposal['deadline'],
    procedureOverride: r.procedureOverrideJson
      ? (JSON.parse(r.procedureOverrideJson) as Record<string, unknown>)
      : null,
    status: r.status as ProposalStatus,
    decidedTick: r.decidedTick,
    outcomeDetail: r.outcomeDetail,
  };
}

function mapVoteFromRow(r: typeof s.votes.$inferSelect): Vote {
  return {
    proposalId: r.proposalId,
    voterAgentId: r.voterAgentId,
    stance: r.stance as Vote['stance'],
    weight: r.weight,
    castTick: r.castTick,
    reasoning: r.reasoning,
  };
}
