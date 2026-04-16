/**
 * ObservationBuilder — builds per-agent per-tick observations.
 * Focus on the hard-earned invariants: privacy (no peeking into other agents'
 * internals), correct inventory, and adjacency accuracy.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, locationId, resourceId, worldId } from '@chronicle/core';
import type { Agent, Location, Resource, World } from '@chronicle/core';
import { ObservationBuilder } from '../src/perception/observation.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;
let kitchen: Location;
let garden: Location;
let alice: Agent;
let bob: Agent;

function agent(wId: string, name: string, locId: string | null): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name,
    persona: '',
    traits: {},
    privateState: null,
    alive: true,
    locationId: locId,
    mood: 'content',
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

function location(wId: string, name: string): Location {
  return {
    id: locationId(),
    worldId: wId,
    name,
    description: name,
    x: null,
    y: null,
    parentId: null,
    affordances: [],
    metadata: {},
    spriteHint: null,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = {
    id: worldId(),
    name: 'O',
    description: 'o',
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
    currentTick: 5,
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
  await store.createWorld(world);
  kitchen = location(world.id, 'kitchen');
  garden = location(world.id, 'garden');
  await store.createLocation(kitchen);
  await store.createLocation(garden);
  await store.addAdjacency(kitchen.id, garden.id, 1, true);

  alice = agent(world.id, 'Alice', kitchen.id);
  bob = agent(world.id, 'Bob', kitchen.id);
  await store.createAgent(alice);
  await store.createAgent(bob);
});

afterEach(() => store.close());

describe('ObservationBuilder', () => {
  it('includes co-located agents in nearby.agents', async () => {
    const builder = new ObservationBuilder(store, world);
    const obs = await builder.build(alice, world.currentTick);
    const names = obs.nearby.agents.map((a) => a.name);
    expect(names).toContain('Bob');
    expect(names).not.toContain('Alice'); // self not in nearby
  });

  it('reports adjacent locations with adjacent=true', async () => {
    const builder = new ObservationBuilder(store, world);
    const obs = await builder.build(alice, world.currentTick);
    const gardenEntry = obs.nearby.locations.find((l) => l.name === 'garden');
    expect(gardenEntry).toBeTruthy();
    expect(gardenEntry?.adjacent).toBe(true);
  });

  it('exposes inventory in selfState', async () => {
    const apple: Resource = {
      id: resourceId(),
      worldId: world.id,
      type: 'apple',
      ownerAgentId: alice.id,
      ownerLocationId: null,
      quantity: 2,
      metadata: {},
    };
    await store.createResource(apple);

    const builder = new ObservationBuilder(store, world);
    const obs = await builder.build(alice, world.currentTick);
    expect(obs.selfState.inventory.some((i) => i.type === 'apple' && i.quantity === 2)).toBe(true);
  });

  it('includes resources at the same location in nearby.resources', async () => {
    const bread: Resource = {
      id: resourceId(),
      worldId: world.id,
      type: 'bread',
      ownerAgentId: null,
      ownerLocationId: kitchen.id,
      quantity: 1,
      metadata: {},
    };
    await store.createResource(bread);

    const builder = new ObservationBuilder(store, world);
    const obs = await builder.build(alice, world.currentTick);
    expect(obs.nearby.resources.some((r) => r.type === 'bread')).toBe(true);
  });

  it('reflects own mood and energy in selfState', async () => {
    const builder = new ObservationBuilder(store, world);
    const obs = await builder.build(alice, world.currentTick);
    expect(obs.selfState.mood).toBe('content');
    expect(obs.selfState.energy).toBe(100);
  });

  it('returns null location for a homeless agent', async () => {
    const ghost = agent(world.id, 'Ghost', null);
    await store.createAgent(ghost);
    const builder = new ObservationBuilder(store, world);
    const obs = await builder.build(ghost, world.currentTick);
    expect(obs.selfState.location).toBeNull();
    expect(obs.nearby.agents).toEqual([]);
    expect(obs.nearby.locations).toEqual([]);
  });
});
