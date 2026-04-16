/**
 * Resource, location, and relationship persistence tests.
 * Runs end-to-end against an in-memory DB — exercises FK constraints too.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, locationId, resourceId, worldId } from '@chronicle/core';
import type { Agent, Location, Relationship, Resource, World } from '@chronicle/core';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'Test',
    description: 't',
    systemPrompt: '',
    config: {
      atmosphere: 'neutral',
      atmosphereTag: 'default',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'claude-haiku-4-5',
      defaultProvider: 'anthropic',
      reflectionFrequency: 20,
      dramaCatalystEnabled: true,
    },
    currentTick: 0,
    status: 'created',
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

function makeAgent(wId: string, locId: string | null = null): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name: 'Agent',
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
    modelId: 'claude-haiku-4-5',
    thinkingLevel: 'low',
    birthTick: 0,
    deathTick: null,
    parentIds: null,
    createdAt: new Date().toISOString(),
  };
}

function makeLocation(wId: string, name: string): Location {
  return {
    id: locationId(),
    worldId: wId,
    name,
    description: `the ${name}`,
    x: null,
    y: null,
    parentId: null,
    affordances: ['sit'],
    metadata: {},
    spriteHint: null,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);
});

afterEach(() => store.close());

describe('Locations and adjacencies', () => {
  it('creates and retrieves locations', async () => {
    const l1 = makeLocation(world.id, 'kitchen');
    const l2 = makeLocation(world.id, 'garden');
    await store.createLocation(l1);
    await store.createLocation(l2);

    const got = await store.getLocationsForWorld(world.id);
    expect(got.length).toBe(2);
    expect(got.map((l) => l.name).sort()).toEqual(['garden', 'kitchen']);
  });

  it('bidirectional adjacency lists both directions', async () => {
    const l1 = makeLocation(world.id, 'a');
    const l2 = makeLocation(world.id, 'b');
    await store.createLocation(l1);
    await store.createLocation(l2);

    await store.addAdjacency(l1.id, l2.id, 1, true);
    expect(await store.getAdjacentLocations(l1.id)).toContain(l2.id);
    expect(await store.getAdjacentLocations(l2.id)).toContain(l1.id);
  });

  it('directional adjacency is one-way', async () => {
    const l1 = makeLocation(world.id, 'a');
    const l2 = makeLocation(world.id, 'b');
    await store.createLocation(l1);
    await store.createLocation(l2);

    await store.addAdjacency(l1.id, l2.id, 1, false);
    expect(await store.getAdjacentLocations(l1.id)).toContain(l2.id);
    expect(await store.getAdjacentLocations(l2.id)).not.toContain(l1.id);
  });
});

describe('Resources — ownership and transfers', () => {
  let alice: Agent;
  let bob: Agent;
  let kitchen: Location;

  beforeEach(async () => {
    kitchen = makeLocation(world.id, 'kitchen');
    await store.createLocation(kitchen);
    alice = makeAgent(world.id, kitchen.id);
    bob = makeAgent(world.id, kitchen.id);
    await store.createAgent(alice);
    await store.createAgent(bob);
  });

  it('creates a resource owned by a location', async () => {
    const apple: Resource = {
      id: resourceId(),
      worldId: world.id,
      type: 'apple',
      ownerAgentId: null,
      ownerLocationId: kitchen.id,
      quantity: 3,
      metadata: {},
    };
    await store.createResource(apple);

    const at = await store.getResourcesAtLocation(kitchen.id);
    expect(at.length).toBe(1);
    expect(at[0]?.type).toBe('apple');
    expect(at[0]?.quantity).toBe(3);
  });

  it('transfers a resource from location to agent', async () => {
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
    await store.transferResource(apple.id, alice.id);

    const aliceHas = await store.getResourcesOwnedBy(alice.id);
    expect(aliceHas.map((r) => r.id)).toContain(apple.id);

    const stillAtKitchen = await store.getResourcesAtLocation(kitchen.id);
    expect(stillAtKitchen.map((r) => r.id)).not.toContain(apple.id);
  });

  it('adjusts quantity via delta (can go up or down)', async () => {
    const coins: Resource = {
      id: resourceId(),
      worldId: world.id,
      type: 'gold',
      ownerAgentId: alice.id,
      ownerLocationId: null,
      quantity: 10,
      metadata: {},
    };
    await store.createResource(coins);
    await store.adjustResourceQuantity(coins.id, 5);
    let alicesCoins = await store.getResourcesOwnedBy(alice.id);
    expect(alicesCoins[0]?.quantity).toBe(15);

    await store.adjustResourceQuantity(coins.id, -3);
    alicesCoins = await store.getResourcesOwnedBy(alice.id);
    expect(alicesCoins[0]?.quantity).toBe(12);
  });
});

describe('Relationships', () => {
  let alice: Agent;
  let bob: Agent;

  beforeEach(async () => {
    alice = makeAgent(world.id);
    bob = makeAgent(world.id);
    await store.createAgent(alice);
    await store.createAgent(bob);
  });

  it('upserts a new relationship', async () => {
    const r: Relationship = {
      agentAId: alice.id,
      agentBId: bob.id,
      affection: 0.5,
      trust: 0.6,
      respect: 0.4,
      familiarity: 0.3,
      tags: ['rival'],
      lastInteractionTick: 0,
    };
    await store.upsertRelationship(r);
    const from = await store.getRelationshipsFrom(alice.id);
    expect(from.length).toBe(1);
    expect(from[0]?.affection).toBe(0.5);
    expect(from[0]?.tags).toContain('rival');
  });

  it('updates an existing relationship on conflict', async () => {
    const r: Relationship = {
      agentAId: alice.id,
      agentBId: bob.id,
      affection: 0.5,
      trust: 0.5,
      respect: 0.5,
      familiarity: 0.5,
      tags: [],
      lastInteractionTick: 1,
    };
    await store.upsertRelationship(r);
    await store.upsertRelationship({
      ...r,
      affection: 0.9,
      tags: ['friend'],
      lastInteractionTick: 5,
    });

    const from = await store.getRelationshipsFrom(alice.id);
    expect(from.length).toBe(1);
    expect(from[0]?.affection).toBe(0.9);
    expect(from[0]?.tags).toContain('friend');
    expect(from[0]?.lastInteractionTick).toBe(5);
  });
});
