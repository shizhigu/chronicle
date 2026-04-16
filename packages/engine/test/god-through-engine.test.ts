/**
 * God intervention end-to-end through the engine — queue an intervention,
 * run ticks until the apply-at tick, verify the event fires with the right
 * visibility and that it gets marked applied (so reruns don't double-fire).
 *
 * This closes the loop that the unit tests for GodService alone leave open:
 * does the engine actually call GodService at each tick? Does it mark applied?
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'node:fs';
import { agentId, locationId, worldId } from '@chronicle/core';
import type { Agent, Observation, ProposedAction, TurnResult, World } from '@chronicle/core';
import {
  type AgentRuntimeAdapter,
  type BusEvent,
  Engine,
  GodService,
  WorldStore,
} from '../src/index.js';

// ============================================================
// Silent mock runtime — no actions, just keeps the engine ticking
// ============================================================

class QuietRuntime implements AgentRuntimeAdapter {
  async hydrate(_world: World, _agents: Agent[]): Promise<void> {}
  async takeTurn(a: Agent, _o: Observation, _t: number): Promise<TurnResult> {
    return { agentId: a.id, action: null, historyBlob: null, tokensSpent: a.tokensSpent };
  }
  async applyAction(_a: Agent, _action: ProposedAction, _t: number): Promise<void> {}
  async reflect(): Promise<string> {
    return '';
  }
  async shutdown(): Promise<void> {}
}

function makeWorld(id: string): World {
  return {
    id,
    name: 'god-smoke',
    description: 's',
    systemPrompt: '',
    config: {
      atmosphere: 'neutral',
      atmosphereTag: 'default',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'claude-haiku-4-5',
      defaultProvider: 'anthropic',
      reflectionFrequency: 999, // never trigger reflection
      dramaCatalystEnabled: false,
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
    rngSeed: 1,
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

const TMP_DBS: string[] = [];

function freshDbPath(): string {
  const p = `/tmp/chronicle-god-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;
  TMP_DBS.push(p);
  return p;
}

afterAll(() => {
  for (const p of TMP_DBS) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

describe('God intervention through Engine tick loop', () => {
  it('applies a queued intervention at its applyAtTick and records an event visible to all', async () => {
    const tmpPath = freshDbPath();
    const store = await WorldStore.open(tmpPath);
    const world = makeWorld(worldId());
    await store.createWorld(world);

    const hall = {
      id: locationId(),
      worldId: world.id,
      name: 'hall',
      description: 'the hall',
      x: null,
      y: null,
      parentId: null,
      affordances: [],
      metadata: {},
      spriteHint: null,
      createdAt: new Date().toISOString(),
    };
    await store.createLocation(hall);

    const alice = makeAgent(world.id, 'Alice', hall.id);
    const bob = makeAgent(world.id, 'Bob', hall.id);
    await store.createAgent(alice);
    await store.createAgent(bob);

    // Queue an intervention for tick 3
    const god = new GodService(store);
    await god.queue(world, 'A stranger arrives at the door.', 3);

    store.close();

    // Run the engine for 5 ticks — should fire on tick 3
    const runtime = new QuietRuntime();
    const events: BusEvent[] = [];
    const engine = new Engine({
      dbPath: tmpPath,
      worldId: world.id,
      runtime,
      onEvent: (e) => {
        events.push(e);
      },
    });
    await engine.init();
    await engine.run({ ticks: 5 });
    await engine.shutdown();

    // Event bus should have seen exactly one god_intervention_applied at tick 3
    const godEvents = events.filter(
      (e): e is Extract<BusEvent, { type: 'god_intervention_applied' }> =>
        e.type === 'god_intervention_applied',
    );
    expect(godEvents.length).toBe(1);
    expect(godEvents[0]?.tick).toBe(3);
    expect(godEvents[0]?.description).toBe('A stranger arrives at the door.');

    // The event is in the DB as well, visible to both agents
    const reopened = await WorldStore.open(tmpPath);
    const stored = await reopened.getEventsInRange(world.id, 3, 3);
    const godEvent = stored.find((e) => e.eventType === 'god_intervention');
    expect(godEvent).toBeTruthy();
    expect(godEvent?.visibleTo.sort()).toEqual([alice.id, bob.id].sort());

    // Intervention is marked applied — rerunning won't fire again
    const stillPending = await reopened.getPendingInterventions(world.id, 10);
    expect(stillPending.length).toBe(0);

    reopened.close();
  });

  it('interventions queued for earlier ticks fire on the first tick the engine runs', async () => {
    const tmpPath = freshDbPath();
    const store = await WorldStore.open(tmpPath);
    const world = makeWorld(worldId());
    await store.createWorld(world);

    const a = makeAgent(world.id, 'Solo', null); // no location — FK-safe
    await store.createAgent(a);

    // Queue for tick 0 (past) — should fire as soon as we hit tick >= 0
    await new GodService(store).queue(world, 'Pre-simulation omen.', 0);

    store.close();

    const events: BusEvent[] = [];
    const engine = new Engine({
      dbPath: tmpPath,
      worldId: world.id,
      runtime: new QuietRuntime(),
      onEvent: (e) => {
        events.push(e);
      },
    });
    await engine.init();
    await engine.run({ ticks: 2 });
    await engine.shutdown();

    const godEvents = events.filter((e) => e.type === 'god_intervention_applied');
    expect(godEvents.length).toBe(1);
  });

  it('two interventions for the same tick both fire in order', async () => {
    const tmpPath = freshDbPath();
    const store = await WorldStore.open(tmpPath);
    const world = makeWorld(worldId());
    await store.createWorld(world);

    const a = makeAgent(world.id, 'A', null);
    await store.createAgent(a);

    const god = new GodService(store);
    await god.queue(world, 'First omen.', 2);
    await god.queue(world, 'Second omen.', 2);

    store.close();

    const events: BusEvent[] = [];
    const engine = new Engine({
      dbPath: tmpPath,
      worldId: world.id,
      runtime: new QuietRuntime(),
      onEvent: (e) => {
        events.push(e);
      },
    });
    await engine.init();
    await engine.run({ ticks: 3 });
    await engine.shutdown();

    const godEvents = events.filter(
      (e): e is Extract<BusEvent, { type: 'god_intervention_applied' }> =>
        e.type === 'god_intervention_applied',
    );
    expect(godEvents.length).toBe(2);
    expect(godEvents.map((e) => e.description)).toEqual(['First omen.', 'Second omen.']);
  });
});
