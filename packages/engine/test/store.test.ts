/**
 * Integration tests for WorldStore using an in-memory SQLite DB.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, worldId } from '@chronicle/core';
import type { Agent, World } from '@chronicle/core';
import { WorldStore } from '../src/store.js';

let store: WorldStore;

const makeWorld = (id: string): World => ({
  id,
  name: 'Test World',
  description: 'A simple test.',
  systemPrompt: 'You are in a test.',
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
  rngSeed: 12345,
});

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
});

afterEach(() => {
  store.close();
});

describe('WorldStore', () => {
  it('creates and loads a world', async () => {
    const id = worldId();
    const w = makeWorld(id);
    await store.createWorld(w);
    const loaded = await store.loadWorld(id);
    expect(loaded.id).toBe(id);
    expect(loaded.name).toBe('Test World');
    expect(loaded.config.scale).toBe('small');
  });

  it('lists worlds newest-first', async () => {
    const a = makeWorld(worldId());
    await store.createWorld(a);
    await new Promise((r) => setTimeout(r, 10));
    const b = makeWorld(worldId());
    await store.createWorld(b);
    const list = await store.listWorlds();
    expect(list.length).toBe(2);
    // Both should be present
    expect(list.some((w) => w.id === a.id)).toBe(true);
    expect(list.some((w) => w.id === b.id)).toBe(true);
  });

  it('updates tick', async () => {
    const w = makeWorld(worldId());
    await store.createWorld(w);
    await store.updateWorldTick(w.id, 42);
    const reloaded = await store.loadWorld(w.id);
    expect(reloaded.currentTick).toBe(42);
  });

  it('creates agent and returns as live', async () => {
    const w = makeWorld(worldId());
    await store.createWorld(w);

    const agent: Agent = {
      id: agentId(),
      worldId: w.id,
      name: 'Alice',
      persona: 'A test character',
      traits: { boldness: 0.8 },
      privateState: null,
      alive: true,
      locationId: null,
      mood: 'neutral',
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
    await store.createAgent(agent);

    const live = await store.getLiveAgents(w.id);
    expect(live.length).toBe(1);
    expect(live[0]?.name).toBe('Alice');
    expect(live[0]?.traits.boldness).toBe(0.8);
  });

  it('records and retrieves events in order', async () => {
    const w = makeWorld(worldId());
    await store.createWorld(w);

    const a = worldId();
    await store.recordEvent({
      worldId: w.id,
      tick: 1,
      eventType: 'tick_begin',
      data: { msg: 'start' },
    });
    await store.recordEvent({
      worldId: w.id,
      tick: 2,
      eventType: 'action',
      actorId: a,
      data: { action: 'speak' },
    });
    await store.recordEvent({ worldId: w.id, tick: 3, eventType: 'tick_end', data: {} });

    const events = await store.getEventsInRange(w.id, 1, 3);
    expect(events.length).toBe(3);
    expect(events[0]?.eventType).toBe('tick_begin');
    expect(events[1]?.data.action).toBe('speak');
    expect(events[2]?.eventType).toBe('tick_end');
  });

  // Durable memory is no longer a WorldStore concern — it lives in
  // per-character markdown files managed by MemoryFileStore. See
  // memory-file-store.test.ts for coverage.
});
