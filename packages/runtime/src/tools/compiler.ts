/**
 * Tool compiler — generates pi-agent tools from world ActionSchemas.
 *
 * Each world has an action_schemas table. We turn each row into a Tool
 * the agent can call. Execution mutates the DB via WorldStore.
 */

import type { ActionSchema, Agent, World } from '@chronicle/core';
import type { WorldStore } from '@chronicle/engine';
import { z } from 'zod';

// Pi-agent Tool interface (inlined to avoid tight coupling if API shifts).
export interface AgentTool<T = unknown> {
  name: string;
  description: string;
  parametersSchema: z.ZodSchema<T>;
  execute: (args: T, context: ExecutionContext) => Promise<ExecuteResult>;
}

export interface ExecutionContext {
  world: World;
  character: Agent;
  tick: number;
  store: WorldStore;
}

export interface ExecuteResult {
  ok: boolean;
  detail?: string;
  sideEffects?: Record<string, unknown>;
}

// Heterogeneous tool collection: each tool has its own arg schema, so we
// accept the family as a wildcard at the collection level.
export type AnyAgentTool = AgentTool<any>;

/** Action tool names reserved by core tools — world schemas can't shadow these. */
const CORE_TOOL_NAMES = new Set(['observe', 'think', 'speak', 'remember', 'recall']);

export function compileWorldTools(
  _world: World,
  _character: Agent,
  store: WorldStore,
  schemas: ActionSchema[],
): AnyAgentTool[] {
  // Always register core tools. `remember` + `recall` let an agent manage
  // its own memory — hermes-agent's key pattern. Agents with an explicit
  // memory surface feel markedly more coherent than ones that only have
  // an externally-injected retrieval.
  const tools: AnyAgentTool[] = [
    coreObserve(),
    coreThink(),
    coreSpeak(),
    coreRemember(),
    coreRecall(),
  ];

  // Plus schema-driven world-specific tools
  for (const schema of schemas) {
    if (!schema.active) continue;
    if (CORE_TOOL_NAMES.has(schema.name)) continue; // core wins
    tools.push(compileSchemaAsTool(schema, store));
  }

  return tools;
}

// ============================================================
// Core tools (available in every world)
// ============================================================

function coreObserve(): AgentTool<Record<string, never>> {
  return {
    name: 'observe',
    description:
      'Return your current observation — what you see, hear, feel. Costs almost nothing.',
    parametersSchema: z.object({}).strict(),
    execute: async () => ({ ok: true, detail: 'observation_refreshed' }),
  };
}

function coreThink(): AgentTool<{ thought: string }> {
  return {
    name: 'think',
    description:
      'Internal thought, heard by no one. Records as a private memory. Use this to plan, worry, reflect.',
    parametersSchema: z.object({
      thought: z.string().min(1).max(2000),
    }),
    execute: async ({ thought }, ctx) => {
      await ctx.store.addMemory({
        agentId: ctx.character.id,
        createdTick: ctx.tick,
        memoryType: 'thought',
        content: thought,
        importance: 0.4,
        decay: 1.0,
        relatedEventId: null,
        aboutAgentId: null,
        embedding: null,
        lastAccessedTick: null,
      });
      return { ok: true };
    },
  };
}

function coreSpeak(): AgentTool<{ to: string; content: string; tone?: string }> {
  return {
    name: 'speak',
    description:
      'Say something. "to" can be a character name, "all" for everyone at your location, or "whisper:<name>" for private.',
    parametersSchema: z.object({
      to: z.string(),
      content: z.string().min(1).max(2000),
      tone: z.enum(['neutral', 'angry', 'whispered', 'shouted', 'sarcastic']).optional(),
    }),
    execute: async ({ to, content, tone }, ctx) => {
      const toAgentId = to.startsWith('whisper:')
        ? await resolveAgentByName(ctx, to.slice('whisper:'.length))
        : to === 'all'
          ? null
          : await resolveAgentByName(ctx, to);

      const isPrivate = to.startsWith('whisper:');
      const heardBy = await computeAudience(ctx, toAgentId, isPrivate);

      await ctx.store.recordMessage({
        worldId: ctx.world.id,
        tick: ctx.tick,
        fromAgentId: ctx.character.id,
        toAgentId,
        toLocationId: !toAgentId && !isPrivate ? ctx.character.locationId : null,
        toChannel: null,
        content,
        tone: tone ?? null,
        private: isPrivate,
        heardBy,
      });
      return { ok: true, detail: `heard_by:${heardBy.length}` };
    },
  };
}

/**
 * Explicit, agent-driven memory write. Distinct from `think` — think
 * records a fleeting inner-voice line with default importance 0.4;
 * remember is "I want to make sure I hold onto this" with caller-chosen
 * importance and typed memory (reflection / goal / belief_about_other).
 *
 * The agent decides what's worth remembering. That's the whole point.
 */
function coreRemember(): AgentTool<{
  content: string;
  importance?: number;
  aboutAgent?: string;
  kind?: 'reflection' | 'goal' | 'belief_about_other';
}> {
  return {
    name: 'remember',
    description:
      'Record something to your long-term memory. Use this when a moment feels important — a promise, a betrayal, a plan, an insight about someone. Importance is 0.0–1.0 (default 0.6). Kind: "reflection" (default) / "goal" / "belief_about_other".',
    parametersSchema: z.object({
      content: z.string().min(1).max(2000),
      importance: z.number().min(0).max(1).optional(),
      aboutAgent: z.string().optional(),
      kind: z.enum(['reflection', 'goal', 'belief_about_other']).optional(),
    }),
    execute: async ({ content, importance, aboutAgent, kind }, ctx) => {
      const aboutAgentId = aboutAgent ? await resolveAgentByName(ctx, aboutAgent) : null;
      await ctx.store.addMemory({
        agentId: ctx.character.id,
        createdTick: ctx.tick,
        memoryType: kind ?? 'reflection',
        content,
        importance: importance ?? 0.6,
        decay: 1.0,
        relatedEventId: null,
        aboutAgentId,
        embedding: null,
        lastAccessedTick: null,
      });
      return {
        ok: true,
        detail: `remembered:${kind ?? 'reflection'}:importance=${(importance ?? 0.6).toFixed(2)}`,
      };
    },
  };
}

/**
 * Query the agent's own memory store. Uses the same recency-×-importance-
 * ×-keyword-overlap scoring as the passive `MemoryService` so both paths
 * agree on relevance. An agent calling `recall` every turn is a sign the
 * passive retrieval isn't giving them enough context — worth watching
 * in telemetry once we have it.
 *
 * Returns up to `k` formatted memory lines in `detail`. Mutates
 * `lastAccessedTick` on each returned memory so decay scoring rewards
 * what the agent actually uses.
 */
function coreRecall(): AgentTool<{ query: string; k?: number }> {
  return {
    name: 'recall',
    description:
      "Search your own memory. Use this when you're not sure if you've encountered something before, or want to remind yourself what you know about someone or some topic. Returns up to K matching memories (default 5, max 20).",
    parametersSchema: z.object({
      query: z.string().min(1).max(500),
      k: z.number().int().min(1).max(20).optional(),
    }),
    execute: async ({ query, k }, ctx) => {
      const limit = k ?? 5;
      const memories = await ctx.store.getMemoriesForAgent(ctx.character.id, 200);
      if (memories.length === 0) {
        return { ok: true, detail: 'no_memories' };
      }
      const queryTokens = memoryTokenize(query);
      const scored = memories
        .map((m) => ({ m, score: scoreMemoryForRecall(m, ctx.tick, queryTokens) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const lines = scored.map(({ m, score }) => {
        const age = ctx.tick - m.createdTick;
        const about = m.aboutAgentId ? ` [about:${m.aboutAgentId}]` : '';
        return `[t${m.createdTick} · ${age}t ago · ${m.memoryType}${about} · score=${score.toFixed(2)}] ${m.content}`;
      });

      // Touch lastAccessedTick on the returned memories so retrieval
      // scoring rewards the memories the agent is actually using.
      for (const { m } of scored) {
        if (typeof m.id === 'number') {
          await ctx.store.updateMemoryAccessed(m.id, ctx.tick);
        }
      }

      return { ok: true, detail: `recalled:${scored.length}\n${lines.join('\n')}` };
    },
  };
}

// Shared with MemoryService's recency × importance × overlap scoring so
// agent-initiated and engine-initiated retrieval agree.
function memoryTokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function scoreMemoryForRecall(
  m: { createdTick: number; importance: number; content: string },
  currentTick: number,
  queryTokens: Set<string>,
): number {
  const age = currentTick - m.createdTick;
  const recency = Math.exp(-age / 50);
  const contentTokens = memoryTokenize(m.content);
  let overlap = 0;
  for (const t of queryTokens) if (contentTokens.has(t)) overlap++;
  const similarity =
    queryTokens.size === 0 || contentTokens.size === 0
      ? 0
      : overlap / Math.max(queryTokens.size, contentTokens.size);
  return 0.45 * recency + 0.35 * m.importance + 0.2 * similarity;
}

async function resolveAgentByName(ctx: ExecutionContext, name: string): Promise<string | null> {
  const agents = await ctx.store.getLiveAgents(ctx.world.id);
  const found = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return found?.id ?? null;
}

async function computeAudience(
  ctx: ExecutionContext,
  toAgentId: string | null,
  isPrivate: boolean,
): Promise<string[]> {
  if (isPrivate && toAgentId) return [ctx.character.id, toAgentId];
  if (toAgentId) return [ctx.character.id, toAgentId];
  // Broadcast at location
  const agents = await ctx.store.getLiveAgents(ctx.world.id);
  return agents.filter((a) => a.locationId === ctx.character.locationId).map((a) => a.id);
}

// ============================================================
// Schema-driven world-specific tool compilation
// ============================================================

function compileSchemaAsTool(schema: ActionSchema, _store: WorldStore): AgentTool {
  const zodSchema = zodSchemaFromJson(schema.parametersSchema);

  return {
    name: schema.name,
    description: schema.description,
    parametersSchema: zodSchema,
    execute: async (args, ctx) => {
      // Apply base cost (energy deduction on character)
      const costs = schema.baseCost ?? {};
      if (costs.energy) {
        const newEnergy = Math.max(0, ctx.character.energy - costs.energy);
        await ctx.store.updateAgentState(ctx.character.id, { energy: newEnergy });
        ctx.character.energy = newEnergy;
      }

      // Dispatch by action name
      switch (schema.name) {
        case 'move':
          return executeMove(args as { destination: string }, ctx);
        case 'gather':
          return executeGather(args as { resource: string }, ctx);
        case 'give':
          return executeGive(args as { recipient: string; item: string; quantity: number }, ctx);
        case 'take':
          return executeTake(args as { resource: string; from: string }, ctx);
        case 'sleep':
          return executeSleep(ctx);
        default:
          // Generic: record the attempt, let soft rules / downstream decide
          return { ok: true, detail: `${schema.name}_performed`, sideEffects: { args } };
      }
    },
  };
}

function zodSchemaFromJson(parameters: Record<string, unknown>): z.ZodSchema {
  // Extremely simple translator — supports flat object schemas with {type: "string"|"number"|...}
  const shape: Record<string, z.ZodTypeAny> = {};
  const props = (parameters?.properties ?? parameters) as Record<
    string,
    { type?: string } | undefined
  >;
  for (const [key, spec] of Object.entries(props)) {
    const t = spec?.type ?? 'string';
    switch (t) {
      case 'number':
      case 'integer':
        shape[key] = z.number();
        break;
      case 'boolean':
        shape[key] = z.boolean();
        break;
      default:
        shape[key] = z.string();
    }
  }
  return z.object(shape);
}

// ============================================================
// Builtin action implementations
// ============================================================

async function executeMove(
  args: { destination: string },
  ctx: ExecutionContext,
): Promise<ExecuteResult> {
  const locations = await ctx.store.getLocationsForWorld(ctx.world.id);
  const target = locations.find((l) => l.name.toLowerCase() === args.destination.toLowerCase());
  if (!target) return { ok: false, detail: `no_location:${args.destination}` };

  if (ctx.character.locationId) {
    const adj = await ctx.store.getAdjacentLocations(ctx.character.locationId);
    if (!adj.includes(target.id)) {
      return { ok: false, detail: 'not_adjacent' };
    }
  }

  await ctx.store.updateAgentState(ctx.character.id, { locationId: target.id });
  ctx.character.locationId = target.id;
  return { ok: true, detail: `moved_to:${target.name}` };
}

async function executeGather(
  args: { resource: string },
  ctx: ExecutionContext,
): Promise<ExecuteResult> {
  if (!ctx.character.locationId) return { ok: false, detail: 'no_location' };
  const resources = await ctx.store.getResourcesAtLocation(ctx.character.locationId);
  const resource = resources.find((r) => r.type.toLowerCase() === args.resource.toLowerCase());
  if (!resource || resource.quantity <= 0) return { ok: false, detail: 'not_available' };

  const amount = Math.min(resource.quantity, 1 + Math.random() * 3);
  await ctx.store.adjustResourceQuantity(resource.id, -amount);

  // Add to agent inventory (or create new owned resource)
  const ownedRes = await ctx.store.getResourcesOwnedBy(ctx.character.id);
  const existing = ownedRes.find((r) => r.type === resource.type);
  if (existing) {
    await ctx.store.adjustResourceQuantity(existing.id, amount);
  } else {
    const { resourceId } = await import('@chronicle/core');
    await ctx.store.createResource({
      id: resourceId(),
      worldId: ctx.world.id,
      type: resource.type,
      ownerAgentId: ctx.character.id,
      ownerLocationId: null,
      quantity: amount,
      metadata: {},
    });
  }
  return { ok: true, detail: `gathered:${args.resource}×${amount.toFixed(1)}` };
}

async function executeGive(
  args: { recipient: string; item: string; quantity: number },
  ctx: ExecutionContext,
): Promise<ExecuteResult> {
  const recipientId = await resolveAgentByName(ctx, args.recipient);
  if (!recipientId) return { ok: false, detail: `no_recipient:${args.recipient}` };

  const owned = await ctx.store.getResourcesOwnedBy(ctx.character.id);
  const resource = owned.find((r) => r.type.toLowerCase() === args.item.toLowerCase());
  if (!resource || resource.quantity < args.quantity) {
    return { ok: false, detail: 'insufficient' };
  }

  await ctx.store.adjustResourceQuantity(resource.id, -args.quantity);

  const recipientOwned = await ctx.store.getResourcesOwnedBy(recipientId);
  const existing = recipientOwned.find((r) => r.type === resource.type);
  if (existing) {
    await ctx.store.adjustResourceQuantity(existing.id, args.quantity);
  } else {
    const { resourceId } = await import('@chronicle/core');
    await ctx.store.createResource({
      id: resourceId(),
      worldId: ctx.world.id,
      type: resource.type,
      ownerAgentId: recipientId,
      ownerLocationId: null,
      quantity: args.quantity,
      metadata: {},
    });
  }
  return { ok: true, detail: `gave_${args.item}×${args.quantity}_to:${args.recipient}` };
}

async function executeTake(
  args: { resource: string; from: string },
  ctx: ExecutionContext,
): Promise<ExecuteResult> {
  // "take" without consent — soft rules should flag this
  const targetAgentId = await resolveAgentByName(ctx, args.from);
  if (!targetAgentId) {
    // Maybe "take from location"
    if (!ctx.character.locationId) return { ok: false, detail: 'no_location' };
    return executeGather({ resource: args.resource }, ctx);
  }
  const targetRes = await ctx.store.getResourcesOwnedBy(targetAgentId);
  const resource = targetRes.find((r) => r.type.toLowerCase() === args.resource.toLowerCase());
  if (!resource || resource.quantity <= 0) return { ok: false, detail: 'not_available' };
  const amount = Math.min(resource.quantity, 1);
  await ctx.store.adjustResourceQuantity(resource.id, -amount);
  await ctx.store.transferResource(resource.id, ctx.character.id);
  // Record as event with high importance to witnesses
  await ctx.store.recordEvent({
    worldId: ctx.world.id,
    tick: ctx.tick,
    eventType: 'action',
    actorId: ctx.character.id,
    data: { action: 'take_without_consent', target: args.from, resource: args.resource, amount },
    tokenCost: 0,
  });
  return { ok: true, detail: `took:${args.resource}` };
}

async function executeSleep(ctx: ExecutionContext): Promise<ExecuteResult> {
  const newEnergy = Math.min(100, ctx.character.energy + 30);
  await ctx.store.updateAgentState(ctx.character.id, { energy: newEnergy });
  ctx.character.energy = newEnergy;
  return { ok: true, detail: 'rested' };
}
