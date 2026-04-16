/**
 * Further DramaDetector tests — edge cases and clamping.
 */

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
    name: 'D',
    description: 'd',
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
    currentTick: 20,
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

describe('DramaDetector — edge cases', () => {
  it('clamps to 1.0 when many dramatic events fire', async () => {
    for (let i = 0; i < 50; i++) {
      await store.recordEvent({
        worldId: world.id,
        tick: 20,
        eventType: 'death',
        data: { i },
      });
    }
    const d = new DramaDetector(store);
    const s = await d.scoreRecentTicks(world, 5);
    expect(s).toBe(1);
  });

  it('respects the window — events before window are ignored', async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 0,
      eventType: 'death',
      data: {},
    });
    const d = new DramaDetector(store);
    const s = await d.scoreRecentTicks(world, 5);
    // currentTick=20, window=5 → events from tick 15..20 — tick 0 is out
    expect(s).toBe(0);
  });

  it('treats whispered speech as low-medium drama', async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 20,
      eventType: 'action',
      data: { action: 'speak', args: { tone: 'whispered' } },
    });
    const d = new DramaDetector(store);
    const s = await d.scoreRecentTicks(world, 5);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.5);
  });

  it('catalyst event contributes drama', async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 20,
      eventType: 'catalyst',
      data: { name: 'storm' },
    });
    const d = new DramaDetector(store);
    const s = await d.scoreRecentTicks(world, 5);
    expect(s).toBeGreaterThan(0);
  });
});
