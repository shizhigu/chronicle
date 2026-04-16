/**
 * Engine + ActivationService end-to-end.
 *
 * Confirms the pre-filter actually saves LLM round-trips in the tick
 * loop: dormant agents get an agent_dormant event, active ones run
 * takeTurn normally, and `lastActiveTick` is stamped.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Agent,
  type Observation,
  type ProposedAction,
  type TurnResult,
  type World,
  agentId,
  worldId,
} from '@chronicle/core';
import type { AgentActivation } from '../src/activation/service.js';
import { Engine } from '../src/engine.js';
import type { AgentRuntimeAdapter } from '../src/engine.js';
import { MemoryFileStore } from '../src/memory/file-store.js';
import { WorldStore } from '../src/store.js';

class CountingRuntime implements AgentRuntimeAdapter {
  takeTurnCalls = 0;
  async hydrate() {}
  async takeTurn(agent: Agent, _obs: Observation, _tick: number): Promise<TurnResult> {
    this.takeTurnCalls++;
    const action: ProposedAction = {
      agentId: agent.id,
      actionName: 'pass',
      args: { reason: 'test' },
      proposedAt: Date.now(),
    };
    return {
      agentId: agent.id,
      action,
      historyBlob: null,
      tokensSpent: agent.tokensSpent + 1,
    };
  }
  async applyAction() {}
  async reflect() {
    return '';
  }
  async shutdown() {}
}

function makeWorld(id: string, activation?: World['config']['activation']): World {
  return {
    id,
    name: 'act',
    description: '',
    systemPrompt: '',
    config: {
      atmosphere: 'neutral',
      atmosphereTag: 'default',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'm',
      defaultProvider: 'anthropic',
      reflectionFrequency: 99,
      dramaCatalystEnabled: false,
      activation,
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
    rngSeed: 7,
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
    modelId: 'm',
    thinkingLevel: 'low',
    birthTick: 0,
    deathTick: null,
    parentIds: null,
    createdAt: new Date().toISOString(),
  };
}

let tmpDir: string;
let dbPath: string;
let memoryRoot: string;
let sharedWorldId: string;
let sharedAliceId: string;
let sharedBobId: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'chronicle-act-int-'));
  dbPath = join(tmpDir, 'w.db');
  memoryRoot = join(tmpDir, 'mem');
  const store = await WorldStore.open(dbPath);
  const world = makeWorld(worldId(), { idleTimeout: 5, lookbackTicks: 2 });
  await store.createWorld(world);
  const alice = makeAgent(world.id, 'Alice');
  const bob = makeAgent(world.id, 'Bob');
  await store.createAgent(alice);
  await store.createAgent(bob);
  sharedWorldId = world.id;
  sharedAliceId = alice.id;
  sharedBobId = bob.id;
  store.close();
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('engine integration', () => {
  it('injected activation that always returns dormant skips all takeTurn calls', async () => {
    const runtime = new CountingRuntime();
    const alwaysDormant: AgentActivation = {
      shouldActivate: async () => ({ active: false, reason: 'test_dormant' }),
    };

    const engine = new Engine({
      dbPath,
      worldId: sharedWorldId,
      runtime,
      activation: alwaysDormant,
      memory: new MemoryFileStore({ root: memoryRoot }),
    });
    await engine.init();
    await engine.run({ ticks: 3 });
    await engine.shutdown();

    expect(runtime.takeTurnCalls).toBe(0);

    // Dormant events recorded, one per agent per tick.
    const store = await WorldStore.open(dbPath);
    const events = await store.getEventsInRange(sharedWorldId, 0, 10);
    const dormantEvents = events.filter((e) => e.eventType === 'agent_dormant');
    expect(dormantEvents.length).toBe(6); // 2 agents × 3 ticks
    expect(
      dormantEvents.every((e) => (e.data as { reason: string }).reason === 'test_dormant'),
    ).toBe(true);
    store.close();
  });

  it('injected activation that always returns active runs takeTurn every tick', async () => {
    const runtime = new CountingRuntime();
    const alwaysActive: AgentActivation = {
      shouldActivate: async () => ({ active: true, reason: 'test_active' }),
    };

    const engine = new Engine({
      dbPath,
      worldId: sharedWorldId,
      runtime,
      activation: alwaysActive,
      memory: new MemoryFileStore({ root: memoryRoot }),
    });
    await engine.init();
    await engine.run({ ticks: 3 });
    await engine.shutdown();

    expect(runtime.takeTurnCalls).toBe(6); // 2 agents × 3 ticks

    const store = await WorldStore.open(dbPath);
    const agents = await store.getLiveAgents(sharedWorldId);
    for (const a of agents) {
      expect(a.lastActiveTick).toBe(3);
    }
    store.close();
  });

  it('stamps lastActiveTick on every active agent when default ActivationService runs', async () => {
    const runtime = new CountingRuntime();
    const engine = new Engine({
      dbPath,
      worldId: sharedWorldId,
      runtime,
      memory: new MemoryFileStore({ root: memoryRoot }),
    });
    await engine.init();
    await engine.run({ ticks: 3 });
    await engine.shutdown();

    const store = await WorldStore.open(dbPath);
    const agents = await store.getLiveAgents(sharedWorldId);
    expect(agents.every((a) => a.lastActiveTick === 3)).toBe(true);
    store.close();
  });

  it('runs with ONE active agent and one always-dormant via fixed decision', async () => {
    const runtime = new CountingRuntime();
    const oneActive: AgentActivation = {
      shouldActivate: async (a) =>
        a.id === sharedAliceId
          ? { active: true, reason: 'pinned_active' }
          : { active: false, reason: 'pinned_dormant' },
    };

    const engine = new Engine({
      dbPath,
      worldId: sharedWorldId,
      runtime,
      activation: oneActive,
      memory: new MemoryFileStore({ root: memoryRoot }),
    });
    await engine.init();
    await engine.run({ ticks: 3 });
    await engine.shutdown();

    expect(runtime.takeTurnCalls).toBe(3); // alice only

    const store = await WorldStore.open(dbPath);
    const events = await store.getEventsInRange(sharedWorldId, 0, 10);
    const dormant = events.filter(
      (e) => e.eventType === 'agent_dormant' && e.actorId === sharedBobId,
    );
    expect(dormant.length).toBe(3);

    const freshAgents = await store.getLiveAgents(sharedWorldId);
    const freshAlice = freshAgents.find((a) => a.id === sharedAliceId);
    const freshBob = freshAgents.find((a) => a.id === sharedBobId);
    expect(freshAlice?.lastActiveTick).toBe(3);
    expect(freshBob?.lastActiveTick == null).toBe(true);
    store.close();
  });
});
