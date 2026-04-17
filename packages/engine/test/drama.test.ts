import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { worldId } from '@chronicle/core';
import type { World } from '@chronicle/core';
import { DramaDetector } from '../src/narrative/drama.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = {
    id: worldId(),
    name: 'Drama Test',
    description: 'test',
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
  await store.createWorld(world);
});

afterEach(() => store.close());

describe('DramaDetector', () => {
  it('scores zero when nothing happened', async () => {
    const detector = new DramaDetector(store);
    const score = await detector.scoreRecentTicks(world, 10);
    expect(score).toBe(0);
  });

  it('scores higher when violent events happen', async () => {
    await store.recordEvent({ worldId: world.id, tick: 10, eventType: 'rule_violation', data: {} });
    await store.recordEvent({
      worldId: world.id,
      tick: 10,
      eventType: 'death',
      data: { name: 'A' },
    });
    const detector = new DramaDetector(store);
    const score = await detector.scoreRecentTicks(world, 10);
    expect(score).toBeGreaterThan(0.4);
  });

  it('treats angry speech as dramatic', async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 10,
      eventType: 'action',
      data: { action: 'speak', args: { tone: 'angry', content: 'YOU LIAR' } },
    });
    const detector = new DramaDetector(store);
    const score = await detector.scoreRecentTicks(world, 10);
    expect(score).toBeGreaterThan(0.1);
  });

  it('includes events at `upToTick` when the engine passes a tick ahead of world.currentTick', async () => {
    // Regression: `runSingleTick` calls the drama scorer BEFORE
    // advancing `world.currentTick`, so relying on `world.currentTick`
    // would silently drop the events persisted for the in-progress
    // tick (they carry `tick = nextTick`). The third-arg override
    // fixes the off-by-one so the engine's catalyst trigger sees
    // fresh activity rather than a stale window.
    const detector = new DramaDetector(store);
    // world.currentTick = 10 from the fixture. Record the dramatic
    // event at tick 11 — the "in-progress" tick the engine hasn't
    // committed yet.
    await store.recordEvent({ worldId: world.id, tick: 11, eventType: 'death', data: { a: 1 } });

    // Default behavior — uses world.currentTick=10 — misses the event.
    const missed = await detector.scoreRecentTicks(world, 10);
    expect(missed).toBe(0);

    // Override to upToTick=11 — the death event lands in the window.
    const caught = await detector.scoreRecentTicks(world, 10, 11);
    expect(caught).toBeGreaterThan(0);
  });
});
