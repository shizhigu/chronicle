/**
 * WorldStateServer — integration test over a real HTTP fetch.
 * Uses a second Bun.serve instance and a seeded in-memory-ish store.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, locationId, worldId } from '@chronicle/core';
import type { Agent, Location, World } from '@chronicle/core';
import { WorldStateServer } from '../src/bridge/state-server.js';
import { WorldStore } from '../src/store.js';

const PORT = 39402;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'State Test',
    description: 'x',
    systemPrompt: '',
    config: {
      atmosphere: 'tense',
      atmosphereTag: 'parlor_drama',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'm',
      defaultProvider: 'anthropic',
      reflectionFrequency: 20,
      dramaCatalystEnabled: true,
    },
    currentTick: 7,
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

function makeLocation(wId: string, name: string): Location {
  return {
    id: locationId(),
    worldId: wId,
    name,
    description: `the ${name}`,
    x: null,
    y: null,
    parentId: null,
    affordances: [],
    metadata: {},
    spriteHint: null,
    createdAt: new Date().toISOString(),
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
    mood: 'calm',
    energy: 90,
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

let store: WorldStore;
let server: WorldStateServer;
let world: World;

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);

  const kitchen = makeLocation(world.id, 'kitchen');
  const garden = makeLocation(world.id, 'garden');
  await store.createLocation(kitchen);
  await store.createLocation(garden);

  await store.createAgent(makeAgent(world.id, 'Alice', kitchen.id));
  await store.createAgent(makeAgent(world.id, 'Bob', garden.id));

  server = new WorldStateServer(store, { port: PORT });
  server.start();
});

afterEach(() => {
  server.stop();
  store.close();
});

describe('WorldStateServer', () => {
  it('GET /api/worlds returns the world list', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Array<{ id: string; name: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.id).toBe(world.id);
  });

  it('GET /api/worlds/:id/state returns hydration payload', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/state`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      world: { id: string; atmosphereTag: string; currentTick: number };
      locations: Array<{ name: string }>;
      agents: Array<{ name: string; locationId: string | null }>;
    };

    expect(body.world.id).toBe(world.id);
    expect(body.world.atmosphereTag).toBe('parlor_drama');
    expect(body.world.currentTick).toBe(7);
    expect(body.locations.map((l) => l.name).sort()).toEqual(['garden', 'kitchen']);
    expect(body.agents.map((a) => a.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('GET /api/worlds/:id/events?since=N filters by tick', async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 5,
      eventType: 'action',
      data: { note: 'before' },
    });
    await store.recordEvent({
      worldId: world.id,
      tick: 8,
      eventType: 'action',
      data: { note: 'after' },
    });

    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/events?since=6`);
    expect(res.ok).toBe(true);
    const events = (await res.json()) as Array<{ tick: number; data: { note: string } }>;
    expect(events.length).toBe(1);
    expect(events[0]?.data.note).toBe('after');
  });

  it('returns 404 on unknown world', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds/chr_doesntexist/state`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  it('returns 404 on bad path', async () => {
    const res = await fetch(`http://localhost:${PORT}/bogus`);
    expect(res.status).toBe(404);
  });

  it('responds to CORS preflight', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds`, {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });
});
