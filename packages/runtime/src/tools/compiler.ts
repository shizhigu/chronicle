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

export function compileWorldTools(
  _world: World,
  _character: Agent,
  store: WorldStore,
  schemas: ActionSchema[],
): AnyAgentTool[] {
  // Always register core tools
  const tools: AnyAgentTool[] = [coreObserve(), coreThink(), coreSpeak()];

  // Plus schema-driven world-specific tools
  for (const schema of schemas) {
    if (!schema.active) continue;
    if (['observe', 'think', 'speak'].includes(schema.name)) continue; // already have core
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
