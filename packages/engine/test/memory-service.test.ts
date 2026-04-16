/**
 * MemoryService — retrieval ranking (recency × importance × similarity).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, worldId } from '@chronicle/core';
import type { Agent, Observation, World } from '@chronicle/core';
import { MemoryService } from '../src/memory/service.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;
let alice: Agent;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'M',
    description: 'm',
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
    currentTick: 100,
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

function makeAgent(wId: string): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name: 'Alice',
    persona: '',
    traits: {},
    privateState: null,
    alive: true,
    locationId: null,
    mood: 'calm',
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

function mkObservation(tick: number, mood: string, nearby: string[]): Observation {
  return {
    agentId: 'agt_x',
    tick,
    selfState: {
      location: 'garden',
      mood,
      energy: 100,
      health: 100,
      inventory: [],
    },
    nearby: {
      agents: nearby.map((n) => ({ name: n, sprite: 'default', mood: null })),
      resources: [],
      locations: [],
    },
    recentEvents: [],
    relevantMemories: [],
    currentGoals: [],
  };
}

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);
  alice = makeAgent(world.id);
  await store.createAgent(alice);
});
afterEach(() => store.close());

describe('MemoryService', () => {
  it('record() persists a memory', async () => {
    const svc = new MemoryService(store);
    const id = await svc.record(alice.id, 'Bob lied to me.', {
      tick: 3,
      type: 'observation',
      importance: 0.8,
    });
    expect(id).toBeGreaterThan(0);

    const mems = await store.getMemoriesForAgent(alice.id);
    expect(mems[0]?.content).toBe('Bob lied to me.');
    expect(mems[0]?.importance).toBe(0.8);
  });

  it('retrieveRelevant returns empty for an agent with no memories', async () => {
    const svc = new MemoryService(store);
    const obs = mkObservation(10, 'calm', []);
    const got = await svc.retrieveRelevant(alice, obs, 10);
    expect(got).toEqual([]);
  });

  it('prefers high-importance memories when nothing else differs', async () => {
    const svc = new MemoryService(store);
    await svc.record(alice.id, 'trivial fact', { tick: 50, type: 'observation', importance: 0.1 });
    await svc.record(alice.id, 'major betrayal', {
      tick: 50,
      type: 'observation',
      importance: 0.95,
    });

    const obs = mkObservation(100, 'calm', []);
    const got = await svc.retrieveRelevant(alice, obs, 2);
    expect(got[0]?.content).toBe('major betrayal');
  });

  it('prefers recent memories when importance is equal', async () => {
    const svc = new MemoryService(store);
    await svc.record(alice.id, 'long ago event', {
      tick: 1,
      type: 'observation',
      importance: 0.5,
    });
    await svc.record(alice.id, 'just happened', {
      tick: 95,
      type: 'observation',
      importance: 0.5,
    });

    const obs = mkObservation(100, 'calm', []);
    const got = await svc.retrieveRelevant(alice, obs, 2);
    expect(got[0]?.content).toBe('just happened');
  });

  it('boosts memories that share keywords with the observation', async () => {
    const svc = new MemoryService(store);
    // Same tick, same importance — only similarity distinguishes
    await svc.record(alice.id, 'thinking about the garden', {
      tick: 90,
      type: 'observation',
      importance: 0.5,
    });
    await svc.record(alice.id, 'unrelated cooking trivia', {
      tick: 90,
      type: 'observation',
      importance: 0.5,
    });

    const obs = mkObservation(100, 'calm', ['Bob']);
    obs.selfState.location = 'garden';
    const got = await svc.retrieveRelevant(alice, obs, 2);
    expect(got[0]?.content).toBe('thinking about the garden');
  });

  it('respects the K limit', async () => {
    const svc = new MemoryService(store);
    for (let i = 0; i < 20; i++) {
      await svc.record(alice.id, `memory ${i}`, {
        tick: 50 + i,
        type: 'observation',
        importance: 0.5,
      });
    }
    const obs = mkObservation(100, 'calm', []);
    const got = await svc.retrieveRelevant(alice, obs, 5);
    expect(got.length).toBe(5);
  });
});
