/**
 * ReflectionService — periodic per-agent LLM reflection, persisted as
 * a new entry in the character's memory.md file.
 *
 * Reflections land in the same file-backed store the agent uses for
 * its own `memory_add` calls, so the LLM-driven summary is treated as
 * a first-class memory entry (injected into the next session's system
 * prompt) rather than as opaque DB state.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, worldId } from '@chronicle/core';
import type { Agent, World } from '@chronicle/core';
import { MemoryFileStore } from '../src/memory/file-store.js';
import { type ReflectionDeps, ReflectionService } from '../src/memory/reflection.js';

let memory: MemoryFileStore;
let tmpRoot: string;
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
      defaultModelId: 'test-model',
      defaultProvider: 'test-provider',
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
    modelTier: 'default',
    provider: 'test-provider',
    modelId: 'test-model',
    thinkingLevel: 'low',
    birthTick: 0,
    deathTick: null,
    parentIds: null,
    createdAt: new Date().toISOString(),
  };
}

const TEST_REFLECTION_MODEL = { provider: 'test-provider', modelId: 'test-model-strong' };

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'chronicle-reflection-'));
  memory = new MemoryFileStore({ root: tmpRoot });
  world = makeWorld();
  alice = makeAgent(world.id, 'Alice');
  bob = makeAgent(world.id, 'Bob');
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ReflectionService', () => {
  it("writes each agent's reflection into their own memory file", async () => {
    const reflectCalls: Array<{ prompt: string; override: unknown }> = [];
    const deps: ReflectionDeps = {
      getAgentInstance: (a) => ({
        reflect: async (prompt, override) => {
          reflectCalls.push({ prompt, override });
          return `${a.name} reflects: I should be careful around Bob.`;
        },
      }),
      reflectionModel: TEST_REFLECTION_MODEL,
    };
    const svc = new ReflectionService(world, memory, deps);

    await svc.triggerFor([alice, bob], 20);

    expect(reflectCalls.length).toBe(2);
    for (const c of reflectCalls) {
      expect(c.override).toEqual(TEST_REFLECTION_MODEL);
    }
    expect(reflectCalls[0]?.prompt).toContain('REFLECTION');

    const aliceEntries = await memory.entries(world.id, alice.id);
    const bobEntries = await memory.entries(world.id, bob.id);
    expect(aliceEntries).toHaveLength(1);
    expect(bobEntries).toHaveLength(1);
    expect(aliceEntries[0]).toContain('Alice reflects');
    expect(bobEntries[0]).toContain('Bob reflects');
  });

  it('skips agents whose instance is null (e.g., unhydrated)', async () => {
    const deps: ReflectionDeps = {
      getAgentInstance: (a) =>
        a.id === alice.id
          ? null
          : {
              reflect: async () => 'Bob reflects.',
            },
      reflectionModel: TEST_REFLECTION_MODEL,
    };
    const svc = new ReflectionService(world, memory, deps);

    await svc.triggerFor([alice, bob], 20);

    expect(await memory.entryCount(world.id, alice.id)).toBe(0);
    expect(await memory.entryCount(world.id, bob.id)).toBe(1);
  });

  it('isolates failures — one agent erroring does not block others', async () => {
    const originalError = console.error;
    console.error = mock(() => {});

    const deps: ReflectionDeps = {
      getAgentInstance: (a) => ({
        reflect: async () => {
          if (a.id === alice.id) throw new Error('boom');
          return 'Bob reflects fine.';
        },
      }),
      reflectionModel: TEST_REFLECTION_MODEL,
    };
    const svc = new ReflectionService(world, memory, deps);

    await svc.triggerFor([alice, bob], 20);

    expect(await memory.entryCount(world.id, alice.id)).toBe(0);
    expect(await memory.entryCount(world.id, bob.id)).toBe(1);

    console.error = originalError;
  });

  it('multiple reflection passes accumulate entries in order', async () => {
    let callCount = 0;
    const deps: ReflectionDeps = {
      getAgentInstance: () => ({
        reflect: async () => `reflection #${++callCount}`,
      }),
      reflectionModel: TEST_REFLECTION_MODEL,
    };
    const svc = new ReflectionService(world, memory, deps);

    await svc.triggerFor([alice], 20);
    await svc.triggerFor([alice], 40);
    await svc.triggerFor([alice], 60);

    const entries = await memory.entries(world.id, alice.id);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toContain('#1');
    expect(entries[1]).toContain('#2');
    expect(entries[2]).toContain('#3');
  });

  it('ignores empty LLM outputs instead of polluting the file', async () => {
    const deps: ReflectionDeps = {
      getAgentInstance: () => ({
        reflect: async () => '   \n  ',
      }),
      reflectionModel: TEST_REFLECTION_MODEL,
    };
    const svc = new ReflectionService(world, memory, deps);

    await svc.triggerFor([alice], 20);

    expect(await memory.entryCount(world.id, alice.id)).toBe(0);
  });
});
