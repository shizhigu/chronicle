/**
 * GodService — queueing + applying user interventions.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, worldId } from '@chronicle/core';
import type { Agent, World } from '@chronicle/core';
import { GodService } from '../src/god/service.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;
let alice: Agent;
let bob: Agent;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'G',
    description: 'g',
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
}

function makeAgent(wId: string, name: string): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name,
    persona: '',
    traits: {},
    privateState: null,
    alive: true,
    locationId: null,
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
  alice = makeAgent(world.id, 'Alice');
  bob = makeAgent(world.id, 'Bob');
  await store.createAgent(alice);
  await store.createAgent(bob);
});
afterEach(() => store.close());

describe('GodService', () => {
  it('queues an intervention for next tick by default', async () => {
    const god = new GodService(store);
    const id = await god.queue(world, 'A storm rolls in.');
    expect(id).toBeGreaterThan(0);

    const pending = await god.getQueuedFor(world.id, world.currentTick + 1);
    expect(pending.length).toBe(1);
    expect(pending[0]?.description).toBe('A storm rolls in.');
    expect(pending[0]?.applyAtTick).toBe(world.currentTick + 1);
  });

  it('respects an explicit applyAtTick', async () => {
    const god = new GodService(store);
    await god.queue(world, 'Later event', 50);
    const farFuture = await god.getQueuedFor(world.id, 50);
    expect(farFuture.some((i) => i.applyAtTick === 50)).toBe(true);
    const nextTick = await god.getQueuedFor(world.id, world.currentTick + 1);
    expect(nextTick.length).toBe(0);
  });

  it('applyEffects records a god_intervention event visible to all live agents', async () => {
    const god = new GodService(store);
    await god.queue(world, 'A stranger arrives.');
    const [iv] = await god.getQueuedFor(world.id, world.currentTick + 1);
    expect(iv).toBeTruthy();
    await god.applyEffects(world, iv!);

    const events = await store.getEventsInRange(world.id, 0, 20);
    const god_event = events.find((e) => e.eventType === 'god_intervention');
    expect(god_event).toBeTruthy();
    expect(god_event?.visibleTo.sort()).toEqual([alice.id, bob.id].sort());
    const data = god_event?.data as { description: string };
    expect(data.description).toBe('A stranger arrives.');
  });

  it('markApplied removes from pending', async () => {
    const god = new GodService(store);
    await god.queue(world, 'Once');
    const [iv] = await god.getQueuedFor(world.id, world.currentTick + 1);
    await god.markApplied(iv!.id);
    const after = await god.getQueuedFor(world.id, world.currentTick + 1);
    expect(after.length).toBe(0);
  });

  it('only includes dead agents out of visible recipients', async () => {
    await store.updateAgentState(bob.id, { alive: false, deathTick: 3 });
    const god = new GodService(store);
    await god.queue(world, 'Only the living see this.');
    const [iv] = await god.getQueuedFor(world.id, world.currentTick + 1);
    await god.applyEffects(world, iv!);

    const events = await store.getEventsInRange(world.id, 0, 20);
    const god_event = events.find((e) => e.eventType === 'god_intervention');
    expect(god_event?.visibleTo).toEqual([alice.id]);
  });
});
