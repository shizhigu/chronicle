/**
 * Event log and memory persistence tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, worldId } from '@chronicle/core';
import type { Agent, World } from '@chronicle/core';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;

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
    currentTick: 0,
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

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);
});
afterEach(() => store.close());

describe('Events', () => {
  it('records event and returns autoincrement id', async () => {
    const id1 = await store.recordEvent({
      worldId: world.id,
      tick: 0,
      eventType: 'tick_begin',
      data: { n: 1 },
    });
    const id2 = await store.recordEvent({
      worldId: world.id,
      tick: 0,
      eventType: 'tick_end',
      data: { n: 2 },
    });
    expect(id2).toBeGreaterThan(id1);
  });

  it('orders events ascending by tick then id', async () => {
    await store.recordEvent({ worldId: world.id, tick: 2, eventType: 'action', data: {} });
    await store.recordEvent({ worldId: world.id, tick: 1, eventType: 'action', data: {} });
    await store.recordEvent({ worldId: world.id, tick: 1, eventType: 'tick_end', data: {} });

    const all = await store.getEventsInRange(world.id, 0, 10);
    expect(all.length).toBe(3);
    expect(all[0]?.tick).toBe(1);
    expect(all[1]?.tick).toBe(1);
    expect(all[2]?.tick).toBe(2);
    // Within the same tick, ids should be ascending
    expect(all[1]!.id).toBeGreaterThan(all[0]!.id);
  });

  it('filters events by tick range', async () => {
    for (let t = 0; t < 10; t++) {
      await store.recordEvent({ worldId: world.id, tick: t, eventType: 'action', data: { t } });
    }
    const mid = await store.getEventsInRange(world.id, 3, 6);
    expect(mid.length).toBe(4);
    expect(mid[0]?.tick).toBe(3);
    expect(mid[mid.length - 1]?.tick).toBe(6);
  });

  it('getRecentEvents returns events at or after sinceTick', async () => {
    for (let t = 0; t < 5; t++) {
      await store.recordEvent({ worldId: world.id, tick: t, eventType: 'action', data: {} });
    }
    const recent = await store.getRecentEvents(world.id, 3);
    expect(recent.length).toBe(2);
  });

  it('scopes events by worldId — no bleed between worlds', async () => {
    const other = makeWorld();
    await store.createWorld(other);

    await store.recordEvent({ worldId: world.id, tick: 0, eventType: 'action', data: { w: 'A' } });
    await store.recordEvent({ worldId: other.id, tick: 0, eventType: 'action', data: { w: 'B' } });

    const a = await store.getRecentEvents(world.id, 0);
    const b = await store.getRecentEvents(other.id, 0);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect((a[0]?.data as { w: string }).w).toBe('A');
    expect((b[0]?.data as { w: string }).w).toBe('B');
  });

  it('stores and returns visibleTo as an array', async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 0,
      eventType: 'action',
      data: { action: 'speak' },
      visibleTo: ['agt_1', 'agt_2'],
    });
    const e = (await store.getRecentEvents(world.id, 0))[0];
    expect(e?.visibleTo).toEqual(['agt_1', 'agt_2']);
  });
});

describe('Memories', () => {
  let alice: Agent;
  beforeEach(async () => {
    alice = {
      id: agentId(),
      worldId: world.id,
      name: 'A',
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
    await store.createAgent(alice);
  });

  it('orders memories by importance desc, then recency desc', async () => {
    await store.addMemory({
      agentId: alice.id,
      createdTick: 0,
      memoryType: 'observation',
      content: 'mid',
      importance: 0.5,
      decay: 1,
      relatedEventId: null,
      aboutAgentId: null,
      embedding: null,
      lastAccessedTick: null,
    });
    await store.addMemory({
      agentId: alice.id,
      createdTick: 5,
      memoryType: 'observation',
      content: 'high recent',
      importance: 0.9,
      decay: 1,
      relatedEventId: null,
      aboutAgentId: null,
      embedding: null,
      lastAccessedTick: null,
    });
    await store.addMemory({
      agentId: alice.id,
      createdTick: 10,
      memoryType: 'observation',
      content: 'high later',
      importance: 0.9,
      decay: 1,
      relatedEventId: null,
      aboutAgentId: null,
      embedding: null,
      lastAccessedTick: null,
    });

    const mems = await store.getMemoriesForAgent(alice.id);
    expect(mems[0]?.content).toBe('high later');
    expect(mems[1]?.content).toBe('high recent');
    expect(mems[2]?.content).toBe('mid');
  });

  it('limits memory count', async () => {
    for (let i = 0; i < 10; i++) {
      await store.addMemory({
        agentId: alice.id,
        createdTick: i,
        memoryType: 'observation',
        content: `m${i}`,
        importance: i / 10,
        decay: 1,
        relatedEventId: null,
        aboutAgentId: null,
        embedding: null,
        lastAccessedTick: null,
      });
    }
    const mems = await store.getMemoriesForAgent(alice.id, 3);
    expect(mems.length).toBe(3);
  });

  it('updates lastAccessedTick', async () => {
    const id = await store.addMemory({
      agentId: alice.id,
      createdTick: 0,
      memoryType: 'observation',
      content: 'x',
      importance: 0.5,
      decay: 1,
      relatedEventId: null,
      aboutAgentId: null,
      embedding: null,
      lastAccessedTick: null,
    });
    await store.updateMemoryAccessed(id, 42);
    const mems = await store.getMemoriesForAgent(alice.id, 10);
    expect(mems[0]?.lastAccessedTick).toBe(42);
  });
});
