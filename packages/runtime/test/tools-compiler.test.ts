/**
 * Integration tests for the runtime tool compiler — core + schema-driven tools.
 *
 * We drive the tools against an in-memory WorldStore so their execute() really
 * hits the DB. No pi-agent involvement (compileWorldTools doesn't need it).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { actionId, agentId, locationId, resourceId, worldId } from '@chronicle/core';
import type { ActionSchema, Agent, Location, Resource, World } from '@chronicle/core';
import { WorldStore } from '@chronicle/engine';
import { type ExecutionContext, compileWorldTools } from '../src/tools/compiler.js';

let store: WorldStore;
let world: World;
let alice: Agent;
let bob: Agent;
let kitchen: Location;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'T',
    description: 't',
    systemPrompt: '',
    config: {
      atmosphere: 'neutral',
      atmosphereTag: 'default',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'm',
      defaultProvider: 'anthropic',
      reflectionFrequency: 20,
      dramaCatalystEnabled: true,
    },
    currentTick: 3,
    status: 'running',
    godBudgetTokens: null,
    tokensUsed: 0,
    tickDurationDescription: null,
    dayNightCycleTicks: null,
    createdAt: new Date().toISOString(),
    createdByChronicle: null,
    forkFromTick: null,
    rngSeed: 1,
  };
}

function makeAgent(wId: string, name: string, locId: string | null): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name,
    persona: '',
    traits: {},
    privateState: null,
    alive: true,
    locationId: locId,
    mood: null,
    energy: 100,
    health: 100,
    tokensBudget: null,
    tokensSpent: 0,
    sessionId: null,
    sessionStateBlob: null,
    modelTier: 'haiku',
    provider: 'anthropic',
    modelId: 'm',
    thinkingLevel: 'low',
    birthTick: 0,
    deathTick: null,
    parentIds: null,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);

  kitchen = {
    id: locationId(),
    worldId: world.id,
    name: 'kitchen',
    description: 'kitchen',
    x: null,
    y: null,
    parentId: null,
    affordances: [],
    metadata: {},
    spriteHint: null,
    createdAt: new Date().toISOString(),
  };
  await store.createLocation(kitchen);

  alice = makeAgent(world.id, 'Alice', kitchen.id);
  bob = makeAgent(world.id, 'Bob', kitchen.id);
  await store.createAgent(alice);
  await store.createAgent(bob);
});
afterEach(() => store.close());

describe('compileWorldTools — core tools', () => {
  it('always includes observe, think, speak', () => {
    const tools = compileWorldTools(world, alice, store, []);
    const names = tools.map((t) => t.name);
    expect(names).toContain('observe');
    expect(names).toContain('think');
    expect(names).toContain('speak');
  });

  it('think records a private memory', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const think = tools.find((t) => t.name === 'think')!;
    const ctx: ExecutionContext = { world, character: alice, tick: 3, store };
    const result = await think.execute({ thought: 'I should leave.' }, ctx);
    expect(result.ok).toBe(true);

    const mems = await store.getMemoriesForAgent(alice.id);
    expect(mems.some((m) => m.content === 'I should leave.' && m.memoryType === 'thought')).toBe(
      true,
    );
  });

  it('speak to a specific agent records a message with both heard', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const speak = tools.find((t) => t.name === 'speak')!;
    const ctx: ExecutionContext = { world, character: alice, tick: 3, store };
    const result = await speak.execute({ to: 'Bob', content: 'Hello.', tone: 'neutral' }, ctx);
    expect(result.ok).toBe(true);

    const messages = await store.getMessagesForTick(world.id, 3);
    expect(messages.length).toBe(1);
    expect(messages[0]?.content).toBe('Hello.');
    expect(messages[0]?.toAgentId).toBe(bob.id);
    expect(messages[0]?.heardBy).toEqual(expect.arrayContaining([alice.id, bob.id]));
    expect(messages[0]?.private).toBe(false);
  });

  it('speak "all" broadcasts to everyone at the same location', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const speak = tools.find((t) => t.name === 'speak')!;
    const ctx: ExecutionContext = { world, character: alice, tick: 3, store };
    await speak.execute({ to: 'all', content: 'Look!' }, ctx);

    const messages = await store.getMessagesForTick(world.id, 3);
    expect(messages.length).toBe(1);
    expect(messages[0]?.toLocationId).toBe(kitchen.id);
    expect(messages[0]?.heardBy.length).toBeGreaterThanOrEqual(2);
  });

  it('speak "whisper:<name>" is private', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const speak = tools.find((t) => t.name === 'speak')!;
    const ctx: ExecutionContext = { world, character: alice, tick: 3, store };
    await speak.execute({ to: 'whisper:Bob', content: 'Secret.' }, ctx);

    const messages = await store.getMessagesForTick(world.id, 3);
    expect(messages[0]?.private).toBe(true);
    expect(messages[0]?.heardBy.sort()).toEqual([alice.id, bob.id].sort());
  });
});

describe('compileWorldTools — schema-driven tools', () => {
  it('schema-driven tool appears alongside core tools', async () => {
    const schema: ActionSchema = {
      id: actionId(),
      worldId: world.id,
      name: 'brew_potion',
      description: 'Brew a potion',
      parametersSchema: { properties: { recipe: { type: 'string' } } },
      baseCost: { energy: 1 },
      requiresTargetType: 'none',
      visibility: 'public',
      effects: {},
      enforcementRef: null,
      active: true,
    };
    await store.createActionSchema(schema);
    const schemas = await store.getActiveActionSchemas(world.id);
    const tools = compileWorldTools(world, alice, store, schemas);
    expect(tools.map((t) => t.name)).toContain('brew_potion');
  });

  it('inactive schemas are excluded', async () => {
    const schema: ActionSchema = {
      id: actionId(),
      worldId: world.id,
      name: 'ghost_tool',
      description: 'x',
      parametersSchema: {},
      baseCost: {},
      requiresTargetType: 'none',
      visibility: 'public',
      effects: {},
      enforcementRef: null,
      active: false,
    };
    await store.createActionSchema(schema);
    const schemas = await store.getActiveActionSchemas(world.id);
    const tools = compileWorldTools(world, alice, store, schemas);
    expect(tools.map((t) => t.name)).not.toContain('ghost_tool');
  });

  it('schema executions apply energy cost', async () => {
    const schema: ActionSchema = {
      id: actionId(),
      worldId: world.id,
      name: 'dig',
      description: 'Dig the ground',
      parametersSchema: { properties: { where: { type: 'string' } } },
      baseCost: { energy: 10 },
      requiresTargetType: 'none',
      visibility: 'public',
      effects: {},
      enforcementRef: null,
      active: true,
    };
    await store.createActionSchema(schema);
    const schemas = await store.getActiveActionSchemas(world.id);
    const tools = compileWorldTools(world, alice, store, schemas);
    const dig = tools.find((t) => t.name === 'dig')!;

    const ctx: ExecutionContext = { world, character: alice, tick: 3, store };
    await dig.execute({ where: 'garden' }, ctx);

    const fresh = await store.getAgent(alice.id);
    expect(fresh.energy).toBe(90);
  });
});

describe('built-in actions — gather, give, take, sleep, move', () => {
  async function toolWith(name: string, baseCost: Record<string, number> = {}) {
    const schema: ActionSchema = {
      id: actionId(),
      worldId: world.id,
      name,
      description: name,
      parametersSchema: {},
      baseCost,
      requiresTargetType: 'none',
      visibility: 'public',
      effects: {},
      enforcementRef: null,
      active: true,
    };
    await store.createActionSchema(schema);
    const schemas = await store.getActiveActionSchemas(world.id);
    const tools = compileWorldTools(world, alice, store, schemas);
    return tools.find((t) => t.name === name)!;
  }

  it('move updates locationId when destination is adjacent', async () => {
    const garden: Location = {
      id: locationId(),
      worldId: world.id,
      name: 'garden',
      description: 'g',
      x: null,
      y: null,
      parentId: null,
      affordances: [],
      metadata: {},
      spriteHint: null,
      createdAt: new Date().toISOString(),
    };
    await store.createLocation(garden);
    await store.addAdjacency(kitchen.id, garden.id, 1, true);

    const move = await toolWith('move');
    const ctx: ExecutionContext = { world, character: alice, tick: 3, store };
    const result = await move.execute({ destination: 'garden' }, ctx);
    expect(result.ok).toBe(true);

    const fresh = await store.getAgent(alice.id);
    expect(fresh.locationId).toBe(garden.id);
  });

  it('gather takes a resource from the current location', async () => {
    const apple: Resource = {
      id: resourceId(),
      worldId: world.id,
      type: 'apple',
      ownerAgentId: null,
      ownerLocationId: kitchen.id,
      quantity: 1,
      metadata: {},
    };
    await store.createResource(apple);

    const gather = await toolWith('gather');
    const ctx: ExecutionContext = { world, character: alice, tick: 3, store };
    const result = await gather.execute({ resource: 'apple' }, ctx);
    expect(result.ok).toBe(true);

    const alicesThings = await store.getResourcesOwnedBy(alice.id);
    expect(alicesThings.some((r) => r.type === 'apple')).toBe(true);
  });

  it('sleep restores energy', async () => {
    await store.updateAgentState(alice.id, { energy: 20 });
    const sleep = await toolWith('sleep');
    const aliceFresh = await store.getAgent(alice.id);
    const ctx: ExecutionContext = { world, character: aliceFresh, tick: 3, store };
    await sleep.execute({}, ctx);

    const after = await store.getAgent(alice.id);
    expect(after.energy).toBeGreaterThan(20);
  });
});
