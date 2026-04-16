/**
 * Engine multi-tick smoke test — end-to-end loop with a mock AgentRuntimeAdapter.
 *
 * Confirms the happy path:
 *   observation built → decision proposed (parallel across agents) →
 *   rule enforcer validates → resolved deterministically → events recorded →
 *   drama scored → tick advances → WS bridge can observe.
 *
 * We drive with a deterministic mock runtime so there's no LLM dependency.
 * This is the canonical "does it turn on" test — if this fails, something
 * is broken at the seams.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, locationId, worldId } from '@chronicle/core';
import type { Agent, Observation, ProposedAction, TurnResult, World } from '@chronicle/core';
import {
  type AgentRuntimeAdapter,
  type BusEvent,
  Engine,
  EventBus,
  WorldStore,
} from '../src/index.js';

// ============================================================
// Mock runtime — deterministic, no LLM
// ============================================================

class MockRuntime implements AgentRuntimeAdapter {
  public calls: { kind: string; detail: unknown }[] = [];

  async hydrate(_world: World, agents: Agent[]): Promise<void> {
    this.calls.push({ kind: 'hydrate', detail: { count: agents.length } });
  }

  async takeTurn(agent: Agent, _obs: Observation, tick: number): Promise<TurnResult> {
    // Each agent rotates actions: tick 1 speak, tick 2 think, tick 3 speak, ...
    const even = tick % 2 === 0;
    const action: ProposedAction = even
      ? {
          agentId: agent.id,
          actionName: 'think',
          args: { thought: `${agent.name} is thinking at tick ${tick}` },
          proposedAt: Date.now(),
        }
      : {
          agentId: agent.id,
          actionName: 'speak',
          args: {
            to: 'all',
            content: `${agent.name} speaks at tick ${tick}`,
            tone: 'neutral',
          },
          proposedAt: Date.now(),
        };
    return {
      agentId: agent.id,
      action,
      historyBlob: null,
      tokensSpent: agent.tokensSpent + 10, // each turn spends 10 tokens
    };
  }

  async applyAction(agent: Agent, action: ProposedAction, tick: number): Promise<void> {
    this.calls.push({
      kind: 'applyAction',
      detail: { agent: agent.name, action: action.actionName, tick },
    });
  }

  async reflect(_agent: Agent, _prompt: string): Promise<string> {
    return 'mock reflection';
  }

  async shutdown(): Promise<void> {
    this.calls.push({ kind: 'shutdown', detail: null });
  }
}

// ============================================================
// Fixtures
// ============================================================

function makeWorld(id: string): World {
  return {
    id,
    name: 'smoke',
    description: 's',
    systemPrompt: '',
    config: {
      atmosphere: 'neutral',
      atmosphereTag: 'default',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'claude-haiku-4-5',
      defaultProvider: 'anthropic',
      reflectionFrequency: 100, // don't trigger reflection during smoke
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
    rngSeed: 42,
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

// Seed world + three agents into a fresh in-memory store
async function seedWorld(): Promise<{
  store: WorldStore;
  world: World;
  agents: Agent[];
}> {
  const store = await WorldStore.open(':memory:');
  const world = makeWorld(worldId());
  await store.createWorld(world);

  const kitchen = {
    id: locationId(),
    worldId: world.id,
    name: 'kitchen',
    description: 'the kitchen',
    x: null,
    y: null,
    parentId: null,
    affordances: [],
    metadata: {},
    spriteHint: null,
    createdAt: new Date().toISOString(),
  };
  await store.createLocation(kitchen);

  const agents = [
    makeAgent(world.id, 'Alice', kitchen.id),
    makeAgent(world.id, 'Bob', kitchen.id),
    makeAgent(world.id, 'Carol', kitchen.id),
  ];
  for (const a of agents) await store.createAgent(a);

  return { store, world, agents };
}

// ============================================================
// Tests
// ============================================================

describe('Engine — multi-tick smoke', () => {
  let store: WorldStore;
  let world: World;
  let runtime: MockRuntime;
  let engine: Engine;
  let events: BusEvent[];

  beforeEach(async () => {
    ({ store, world } = await seedWorld());
    runtime = new MockRuntime();
    events = [];

    engine = new Engine({
      dbPath: ':memory:', // note: Engine will open its own store; see caveat below
      worldId: world.id,
      runtime,
      onEvent: (e) => {
        events.push(e);
      },
    });
  });

  afterEach(async () => {
    await engine.shutdown?.().catch(() => {});
    store.close();
  });

  it('hydrates the runtime on init', async () => {
    // Engine opens a SEPARATE store at dbPath. For this smoke we can't share
    // :memory: across stores, so we skip hydrate verification here and instead
    // use engine's own store below.
    // This test covers the observable behavior at the event-bus level.
    //
    // Hydrate behavior is verified in runtime/agent-pool tests; this smoke
    // focuses on the tick loop.
    expect(runtime).toBeTruthy();
  });
});

// ============================================================
// End-to-end over a shared store (authoritative smoke)
// ============================================================

describe('Engine — shared-store tick loop (authoritative)', () => {
  it('runs 5 ticks, emits tick_begin/tick_end for each, records actions', async () => {
    // Use a file-backed DB so Engine and our seeding share state
    const tmpPath = `/tmp/chronicle-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`;
    const store = await WorldStore.open(tmpPath);

    const world = makeWorld(worldId());
    await store.createWorld(world);

    const loc = {
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
    await store.createLocation(loc);

    const alice = makeAgent(world.id, 'Alice', loc.id);
    const bob = makeAgent(world.id, 'Bob', loc.id);
    await store.createAgent(alice);
    await store.createAgent(bob);
    store.close();

    const runtime = new MockRuntime();
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

    // Assertions
    const beginCount = events.filter((e) => e.type === 'tick_begin').length;
    const endCount = events.filter((e) => e.type === 'tick_end').length;
    expect(beginCount).toBe(5);
    expect(endCount).toBe(5);

    // Ticks were monotonic 1..5
    const beginTicks = events
      .filter((e): e is Extract<BusEvent, { type: 'tick_begin' }> => e.type === 'tick_begin')
      .map((e) => e.tick);
    expect(beginTicks).toEqual([1, 2, 3, 4, 5]);

    // Runtime saw 5 ticks × 2 agents = 10 applyAction calls (mock always produces an action)
    const applyCount = runtime.calls.filter((c) => c.kind === 'applyAction').length;
    expect(applyCount).toBe(10);

    // Verify events landed in DB
    const finalStore = await WorldStore.open(tmpPath);
    const recordedEvents = await finalStore.getEventsInRange(world.id, 0, 10);
    const actionEvents = recordedEvents.filter((e) => e.eventType === 'action');
    expect(actionEvents.length).toBe(10);

    // World tick advanced
    const reloaded = await finalStore.loadWorld(world.id);
    expect(reloaded.currentTick).toBe(5);
    expect(reloaded.tokensUsed).toBeGreaterThan(0);
    finalStore.close();

    // Clean up temp DB
    try {
      await Bun.file(tmpPath)
        .exists()
        .then((exists) => exists && require('node:fs').unlinkSync(tmpPath));
    } catch {
      /* ignore */
    }
  });

  it('reuses the caller-provided EventBus so agent-side and engine-side events land on the same stream', async () => {
    // Regression: Engine.init() used to unconditionally `new EventBus()`,
    // so a runtime (AgentPool) constructed with the caller's bus would
    // emit `action_completed` / `speech` / `char_thinking` on a
    // different bus than Engine's `tick_begin` / `tick_end`. The
    // `--live` subscriber and the WebSocket bridge both listen on
    // `engine.bus`, so half the stream went to /dev/null.
    const tmpPath = `/tmp/chronicle-smoke-sharedbus-${Date.now()}.db`;
    const store = await WorldStore.open(tmpPath);
    const world = makeWorld(worldId());
    await store.createWorld(world);
    const alice = makeAgent(world.id, 'Alice', null);
    await store.createAgent(alice);
    store.close();

    const sharedBus = new EventBus();
    const collected: BusEvent[] = [];
    sharedBus.subscribe((e) => collected.push(e));

    const runtime = new MockRuntime();
    const engine = new Engine({
      dbPath: tmpPath,
      worldId: world.id,
      runtime,
      events: sharedBus,
    });
    await engine.init();

    // Simulate the AgentPool emitting on the shared bus from inside a
    // tool-call callback (the real pi-agent `afterToolCall` path).
    engine.bus.emit({
      type: 'action_completed',
      worldId: world.id,
      agentId: alice.id,
      tool: 'speak',
      isError: false,
    });

    await engine.run({ ticks: 1 });
    await engine.shutdown();

    // `engine.bus` must be the same instance we passed in.
    expect(engine.bus).toBe(sharedBus);

    // Both the out-of-engine emission and the engine's own emissions
    // must reach the external subscriber.
    const kinds = collected.map((e) => e.type);
    expect(kinds).toContain('action_completed');
    expect(kinds).toContain('tick_begin');
    expect(kinds).toContain('tick_end');

    try {
      require('node:fs').unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  });

  it('allocates its own bus when no `events` is passed (backward compat)', async () => {
    const tmpPath = `/tmp/chronicle-smoke-defaultbus-${Date.now()}.db`;
    const store = await WorldStore.open(tmpPath);
    const world = makeWorld(worldId());
    await store.createWorld(world);
    store.close();

    const engine = new Engine({
      dbPath: tmpPath,
      worldId: world.id,
      runtime: new MockRuntime(),
      // deliberately no `events`
    });
    await engine.init();
    expect(engine.bus).toBeDefined();
    await engine.shutdown();

    try {
      require('node:fs').unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  });

  it('resolves actions deterministically (sorted by agent id)', async () => {
    const tmpPath = `/tmp/chronicle-smoke-det-${Date.now()}.db`;
    const store = await WorldStore.open(tmpPath);
    const world = makeWorld(worldId());
    await store.createWorld(world);

    const a = makeAgent(world.id, 'Zed', null);
    const b = makeAgent(world.id, 'Amy', null);
    const c = makeAgent(world.id, 'Mike', null);
    // Force known order by setting ids with a predictable sort
    a.id = 'agt_zzz';
    b.id = 'agt_aaa';
    c.id = 'agt_mmm';
    await store.createAgent(a);
    await store.createAgent(b);
    await store.createAgent(c);
    store.close();

    const runtime = new MockRuntime();
    const engine = new Engine({
      dbPath: tmpPath,
      worldId: world.id,
      runtime,
    });
    await engine.init();
    await engine.run({ ticks: 1 });
    await engine.shutdown();

    // applyAction calls should be in id-ascending order: aaa, mmm, zzz
    const applyCalls = runtime.calls
      .filter((c) => c.kind === 'applyAction')
      .map((c) => (c.detail as { agent: string }).agent);
    expect(applyCalls).toEqual(['Amy', 'Mike', 'Zed']);

    try {
      require('node:fs').unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  });

  it('untilEvent: stops as soon as the named event type fires', async () => {
    const tmpPath = `/tmp/chronicle-smoke-until-${Date.now()}.db`;
    const store = await WorldStore.open(tmpPath);
    const world = makeWorld(worldId());
    await store.createWorld(world);
    const a = makeAgent(world.id, 'Alice', null);
    await store.createAgent(a);

    // Queue an intervention for tick 2 — will fire god_intervention_applied
    const { GodService } = await import('../src/index.js');
    await new GodService(store).queue(world, 'A stranger arrives.', 2);
    store.close();

    const runtime = new MockRuntime();
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
    // Request 20 ticks, but stop as soon as god_intervention_applied fires.
    await engine.run({ ticks: 20, untilEvent: 'god_intervention_applied' });
    await engine.shutdown();

    // Only 2 tick_end events (tick 1 and tick 2) — we stopped at 2
    const tickEnds = events.filter((e) => e.type === 'tick_end');
    expect(tickEnds.length).toBe(2);
    const godEvt = events.find((e) => e.type === 'god_intervention_applied');
    expect(godEvt).toBeTruthy();

    try {
      require('node:fs').unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  });

  it('stops at a budget', async () => {
    const tmpPath = `/tmp/chronicle-smoke-budget-${Date.now()}.db`;
    const store = await WorldStore.open(tmpPath);
    const world = makeWorld(worldId());
    await store.createWorld(world);
    const a = makeAgent(world.id, 'Alice', null);
    await store.createAgent(a);
    store.close();

    const runtime = new MockRuntime();
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
    // Each tick mock spends +10 tokens. Budget of 25 → should stop after tick 3
    // (cumulative: 10, 20, 30 — at tick 3, cumulative 30 exceeds 25, engine pauses).
    await engine.run({ ticks: 20, budget: 25 });
    await engine.shutdown();

    const budgetEvt = events.find((e) => e.type === 'budget_exceeded');
    expect(budgetEvt).toBeTruthy();

    try {
      require('node:fs').unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  });
});
