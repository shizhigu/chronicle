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
});
