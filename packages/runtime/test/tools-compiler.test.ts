/**
 * Integration tests for the runtime tool compiler — core + schema-driven tools.
 *
 * We drive the tools against an in-memory WorldStore so their execute() really
 * hits the DB. No pi-agent involvement (compileWorldTools doesn't need it).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionId, agentId, locationId, resourceId, worldId } from '@chronicle/core';
import type { ActionSchema, Agent, Location, Resource, World } from '@chronicle/core';
import { MemoryFileStore, WorldStore } from '@chronicle/engine';
import { type ExecutionContext, compileWorldTools } from '../src/tools/compiler.js';

let store: WorldStore;
let memory: MemoryFileStore;
let memRoot: string;
let world: World;
let alice: Agent;
let bob: Agent;
let kitchen: Location;

function makeCtx(character: Agent, tick = 3): ExecutionContext {
  return { world, character, tick, store, memory };
}

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
  memRoot = mkdtempSync(join(tmpdir(), 'chronicle-tools-'));
  memory = new MemoryFileStore({ root: memRoot });
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
afterEach(() => {
  store.close();
  rmSync(memRoot, { recursive: true, force: true });
});

describe('compileWorldTools — core tools', () => {
  it('always includes observe, think, speak', () => {
    const tools = compileWorldTools(world, alice, store, []);
    const names = tools.map((t) => t.name);
    expect(names).toContain('observe');
    expect(names).toContain('think');
    expect(names).toContain('speak');
  });

  it('think is a no-op — a thought returns ok without touching durable memory', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const think = tools.find((t) => t.name === 'think')!;
    const result = await think.execute({ thought: 'I should leave.' }, makeCtx(alice));
    expect(result.ok).toBe(true);
    // Durable memory is untouched — think is meant to be ephemeral (it
    // lives only in the pi-agent conversation history). Durable memory
    // is written exclusively through memory_add.
    expect(await memory.entryCount(world.id, alice.id)).toBe(0);
  });

  it('pass tool is registered and returns ok with no side effects', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    expect(tools.map((t) => t.name)).toContain('pass');
    const pass = tools.find((t) => t.name === 'pass')!;
    const result = await pass.execute({ reason: 'listening' }, makeCtx(alice));
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('passed');
    // No durable memory writes, no event in the tool itself — the
    // engine stamps lastActiveTick post-turn regardless.
    expect(await memory.entryCount(world.id, alice.id)).toBe(0);
  });

  it('memory_add writes an entry to the character memory file', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const add = tools.find((t) => t.name === 'memory_add')!;
    const result = await add.execute(
      { content: 'Bob cannot be trusted around food.' },
      makeCtx(alice),
    );
    expect(result.ok).toBe(true);
    const entries = await memory.entries(world.id, alice.id);
    expect(entries).toEqual(['Bob cannot be trusted around food.']);
  });

  it('memory_replace edits the single matching entry', async () => {
    await memory.add(world.id, alice.id, 'Bob stole bread.');
    await memory.add(world.id, alice.id, 'Carol is a friend.');

    const tools = compileWorldTools(world, alice, store, []);
    const replace = tools.find((t) => t.name === 'memory_replace')!;
    const result = await replace.execute(
      { old_text: 'stole bread', new_content: 'Bob returned the bread, maybe trustworthy.' },
      makeCtx(alice),
    );
    expect(result.ok).toBe(true);

    const entries = await memory.entries(world.id, alice.id);
    expect(entries).toEqual(['Bob returned the bread, maybe trustworthy.', 'Carol is a friend.']);
  });

  it('memory_remove deletes the single matching entry', async () => {
    await memory.add(world.id, alice.id, 'Outdated belief A.');
    await memory.add(world.id, alice.id, 'Still relevant B.');

    const tools = compileWorldTools(world, alice, store, []);
    const remove = tools.find((t) => t.name === 'memory_remove')!;
    const result = await remove.execute({ old_text: 'Outdated' }, makeCtx(alice));
    expect(result.ok).toBe(true);

    const entries = await memory.entries(world.id, alice.id);
    expect(entries).toEqual(['Still relevant B.']);
  });

  it('speak to a specific agent records a message with both heard', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const speak = tools.find((t) => t.name === 'speak')!;
    const ctx: ExecutionContext = makeCtx(alice);
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
    const ctx: ExecutionContext = makeCtx(alice);
    await speak.execute({ to: 'all', content: 'Look!' }, ctx);

    const messages = await store.getMessagesForTick(world.id, 3);
    expect(messages.length).toBe(1);
    expect(messages[0]?.toLocationId).toBe(kitchen.id);
    expect(messages[0]?.heardBy.length).toBeGreaterThanOrEqual(2);
  });

  it('speak "whisper:<name>" is private', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const speak = tools.find((t) => t.name === 'speak')!;
    const ctx: ExecutionContext = makeCtx(alice);
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

    const ctx: ExecutionContext = makeCtx(alice);
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
    const ctx: ExecutionContext = makeCtx(alice);
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
    const ctx: ExecutionContext = makeCtx(alice);
    const result = await gather.execute({ resource: 'apple' }, ctx);
    expect(result.ok).toBe(true);

    const alicesThings = await store.getResourcesOwnedBy(alice.id);
    expect(alicesThings.some((r) => r.type === 'apple')).toBe(true);
  });

  it('sleep restores energy', async () => {
    await store.updateAgentState(alice.id, { energy: 20 });
    const sleep = await toolWith('sleep');
    const aliceFresh = await store.getAgent(alice.id);
    const ctx: ExecutionContext = makeCtx(aliceFresh);
    await sleep.execute({}, ctx);

    const after = await store.getAgent(alice.id);
    expect(after.energy).toBeGreaterThan(20);
  });
});
