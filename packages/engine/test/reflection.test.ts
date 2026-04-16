/**
 * ReflectionService — periodic per-agent LLM reflection, persisted as a
 * high-importance memory. Drives Sonnet-tier tokens.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { agentId, worldId } from '@chronicle/core';
import type { Agent, World } from '@chronicle/core';
import { type ReflectionDeps, ReflectionService } from '../src/memory/reflection.js';
import { MemoryService } from '../src/memory/service.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;
let alice: Agent;
let bob: Agent;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'R',
    description: 'r',
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
    modelId: 'claude-haiku-4-5',
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

describe('ReflectionService', () => {
  it('records a high-importance reflection memory per agent', async () => {
    const memory = new MemoryService(store);
    const reflectCalls: Array<{ prompt: string; override: unknown }> = [];
    const deps: ReflectionDeps = {
      getAgentInstance: (a) => ({
        reflect: async (prompt, override) => {
          reflectCalls.push({ prompt, override });
          return `${a.name} reflects: I should be careful around Bob.`;
        },
      }),
      sonnetModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    };
    const svc = new ReflectionService(store, memory, deps);

    await svc.triggerFor([alice, bob], 20);

    // Both agents reflected
    expect(reflectCalls.length).toBe(2);
    // Each was asked to use Sonnet
    for (const c of reflectCalls) {
      expect(c.override).toEqual({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      });
    }
    // Prompt mentions reflection
    expect(reflectCalls[0]?.prompt).toContain('REFLECTION');

    // Each agent gained a memory
    const aliceMems = await store.getMemoriesForAgent(alice.id);
    const bobMems = await store.getMemoriesForAgent(bob.id);
    expect(aliceMems.length).toBe(1);
    expect(bobMems.length).toBe(1);

    // Memory is tagged as reflection with high importance
    expect(aliceMems[0]?.memoryType).toBe('reflection');
    expect(aliceMems[0]?.importance).toBeGreaterThanOrEqual(0.8);
    expect(aliceMems[0]?.content).toContain('Alice reflects');
    expect(aliceMems[0]?.createdTick).toBe(20);
  });

  it('skips agents whose instance is null (e.g., unhydrated)', async () => {
    const memory = new MemoryService(store);
    const deps: ReflectionDeps = {
      getAgentInstance: (a) =>
        a.id === alice.id
          ? null
          : {
              reflect: async () => 'Bob reflects.',
            },
      sonnetModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    };
    const svc = new ReflectionService(store, memory, deps);

    await svc.triggerFor([alice, bob], 20);

    const aliceMems = await store.getMemoriesForAgent(alice.id);
    const bobMems = await store.getMemoriesForAgent(bob.id);
    expect(aliceMems.length).toBe(0); // skipped
    expect(bobMems.length).toBe(1);
  });

  it('isolates failures — one agent erroring does not block others', async () => {
    const memory = new MemoryService(store);
    const originalError = console.error;
    console.error = mock(() => {});

    const deps: ReflectionDeps = {
      getAgentInstance: (a) => ({
        reflect: async () => {
          if (a.id === alice.id) throw new Error('boom');
          return 'Bob reflects fine.';
        },
      }),
      sonnetModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    };
    const svc = new ReflectionService(store, memory, deps);

    await svc.triggerFor([alice, bob], 20);

    const aliceMems = await store.getMemoriesForAgent(alice.id);
    const bobMems = await store.getMemoriesForAgent(bob.id);
    expect(aliceMems.length).toBe(0); // failed
    expect(bobMems.length).toBe(1); // succeeded

    console.error = originalError;
  });

  it('reflections persist across multiple ticks — most-recent is retrievable', async () => {
    const memory = new MemoryService(store);
    let callCount = 0;
    const deps: ReflectionDeps = {
      getAgentInstance: () => ({
        reflect: async () => `reflection #${++callCount}`,
      }),
      sonnetModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    };
    const svc = new ReflectionService(store, memory, deps);

    await svc.triggerFor([alice], 20);
    await svc.triggerFor([alice], 40);
    await svc.triggerFor([alice], 60);

    const mems = await store.getMemoriesForAgent(alice.id);
    expect(mems.length).toBe(3);
    // All have reflection type
    expect(mems.every((m) => m.memoryType === 'reflection')).toBe(true);
    // The most recent by createdTick should be #3
    const latest = mems.sort((a, b) => b.createdTick - a.createdTick)[0];
    expect(latest?.content).toContain('#3');
    expect(latest?.createdTick).toBe(60);
  });
});
