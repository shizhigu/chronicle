/**
 * CatalystInjector — world-atmosphere-aware event injection.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { worldId } from '@chronicle/core';
import type { World } from '@chronicle/core';
import { CatalystInjector } from '../src/narrative/catalyst.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;

function makeWorld(atmosphereTag: string): World {
  return {
    id: worldId(),
    name: 'C',
    description: 'c',
    systemPrompt: '',
    config: {
      atmosphere: atmosphereTag,
      atmosphereTag,
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'm',
      defaultProvider: 'anthropic',
      reflectionFrequency: 20,
      dramaCatalystEnabled: true,
    },
    currentTick: 10,
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
});
afterEach(() => store.close());

describe('CatalystInjector', () => {
  it('records a catalyst event with the world id and tick', async () => {
    world = makeWorld('parlor_drama');
    await store.createWorld(world);
    const injector = new CatalystInjector(store, world);
    await injector.inject(world, 10);

    const events = await store.getEventsInRange(world.id, 10, 10);
    expect(events.length).toBe(1);
    expect(events[0]?.eventType).toBe('catalyst');
    expect(events[0]?.tick).toBe(10);
  });

  it('uses atmosphere-specific pool for tech_workplace', async () => {
    world = makeWorld('tech_workplace');
    await store.createWorld(world);
    const injector = new CatalystInjector(store, world);
    await injector.inject(world, 10);

    const events = await store.getEventsInRange(world.id, 10, 10);
    const data = events[0]?.data as { description: string; atmosphereTag: string };
    expect(data.atmosphereTag).toBe('tech_workplace');
    // Spot-check the pool — one of the known tech-workplace lines
    const pool = [
      'A critical bug report lands in the team chat.',
      'An investor emails: "We need to talk."',
      'The office suddenly loses internet.',
      'A competitor launches a similar product.',
      'An article drops mentioning the company — not favorably.',
    ];
    expect(pool).toContain(data.description);
  });

  it('falls back to default pool for unknown atmosphere', async () => {
    world = makeWorld('outer_space_mystery'); // not in pool
    await store.createWorld(world);
    const injector = new CatalystInjector(store, world);
    await injector.inject(world, 5);

    const events = await store.getEventsInRange(world.id, 5, 5);
    const data = events[0]?.data as { description: string; atmosphereTag: string };
    const defaultPool = [
      'A distant sound startles everyone — something moved outside.',
      'A cold draft sweeps through the space.',
      'Someone realizes they are being watched.',
      'An unexpected visitor appears briefly at the edge of the scene.',
    ];
    expect(defaultPool).toContain(data.description);
  });

  it('can fire multiple times; each records a separate event', async () => {
    world = makeWorld('teen_drama');
    await store.createWorld(world);
    const injector = new CatalystInjector(store, world);
    await injector.inject(world, 1);
    await injector.inject(world, 2);
    await injector.inject(world, 3);

    const all = await store.getEventsInRange(world.id, 0, 10);
    expect(all.length).toBe(3);
    expect(all.map((e) => e.tick)).toEqual([1, 2, 3]);
  });
});
