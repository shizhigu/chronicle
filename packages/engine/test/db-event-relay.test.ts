/**
 * DbEventRelay — verify that DB-persisted events get re-emitted on
 * an in-memory bus, with tick_begin/tick_end boundaries synthesized
 * since those aren't persisted.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { agentId, worldId } from '@chronicle/core';
import type { World } from '@chronicle/core';
import { type BusEvent, DbEventRelay, EventBus, WorldStore } from '../src/index.js';

function makeWorld(id: string): World {
  return {
    id,
    name: 'relay-smoke',
    description: '',
    systemPrompt: '',
    config: {
      atmosphere: 'neutral',
      atmosphereTag: 'default',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'claude-haiku-4-5',
      defaultProvider: 'anthropic',
      reflectionFrequency: 100,
      dramaCatalystEnabled: false,
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
    rngSeed: 1,
  };
}

describe('DbEventRelay', () => {
  let store: WorldStore;
  let bus: EventBus;
  let captured: BusEvent[];
  let world: World;
  let aliceId: string;

  beforeEach(async () => {
    store = await WorldStore.open(':memory:');
    world = makeWorld(worldId());
    await store.createWorld(world);
    aliceId = agentId();
    bus = new EventBus();
    captured = [];
    bus.subscribe((e) => captured.push(e));
  });

  it('starts at the current high-water mark so existing events are not replayed', async () => {
    // Seed an event BEFORE starting the relay.
    await store.recordEvent({
      worldId: world.id,
      tick: 1,
      eventType: 'action',
      actorId: aliceId,
      data: { action: 'observe', args: {} },
      tokenCost: 0,
    });
    const relay = new DbEventRelay({ store, bus, worldId: world.id });
    await relay.start();
    await relay.poll();
    expect(captured).toHaveLength(0);
    await relay.stop();
  });

  it('replays history when fromEventId: 0 is passed', async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 1,
      eventType: 'action',
      actorId: aliceId,
      data: { action: 'observe', args: {} },
      tokenCost: 0,
    });
    const relay = new DbEventRelay({ store, bus, worldId: world.id, fromEventId: 0 });
    await relay.start();
    await relay.poll();
    // tick_begin(1) synthesized + action_completed
    const kinds = captured.map((e) => e.type);
    expect(kinds).toContain('tick_begin');
    expect(kinds).toContain('action_completed');
    await relay.stop();
  });

  it('emits tick_end/tick_begin boundaries between ticks and surfaces speak as a speech event', async () => {
    const relay = new DbEventRelay({ store, bus, worldId: world.id });
    await relay.start();

    // Event at tick 1 — triggers tick_begin(1)
    await store.recordEvent({
      worldId: world.id,
      tick: 1,
      eventType: 'action',
      actorId: aliceId,
      data: { action: 'speak', args: { to: 'all', content: 'Hello.', tone: 'neutral' } },
      tokenCost: 0,
    });
    // Event at tick 3 — triggers tick_end(1) + tick_begin(3)
    await store.recordEvent({
      worldId: world.id,
      tick: 3,
      eventType: 'action',
      actorId: aliceId,
      data: { action: 'observe', args: {} },
      tokenCost: 0,
    });

    await relay.poll();

    // Expected ordered emissions:
    //   tick_begin(1), action_completed(speak), speech,
    //   tick_end(1), tick_begin(3), action_completed(observe)
    const kinds = captured.map((e) => e.type);
    expect(kinds).toEqual([
      'tick_begin',
      'action_completed',
      'speech',
      'tick_end',
      'tick_begin',
      'action_completed',
    ]);
    const speech = captured.find((e) => e.type === 'speech') as Extract<
      BusEvent,
      { type: 'speech' }
    >;
    expect(speech.content).toBe('Hello.');
    expect(speech.toTarget).toBe('all');
    expect(speech.tone).toBe('neutral');

    await relay.stop();
  });

  it('surfaces catalyst DB rows as catalyst BusEvents', async () => {
    const relay = new DbEventRelay({ store, bus, worldId: world.id, fromEventId: 0 });
    await relay.start();
    await store.recordEvent({
      worldId: world.id,
      tick: 1,
      eventType: 'catalyst',
      actorId: null,
      data: { description: 'A raven lands.', atmosphereTag: 'medieval_court' },
      tokenCost: 0,
    });
    await relay.poll();
    const cat = captured.find((e) => e.type === 'catalyst') as Extract<
      BusEvent,
      { type: 'catalyst' }
    >;
    expect(cat).toBeDefined();
    expect(cat.description).toBe('A raven lands.');
    expect(cat.atmosphereTag).toBe('medieval_court');
    await relay.stop();
  });

  it('drops types with no UI representation silently (agent_dormant, agent_silent)', async () => {
    const relay = new DbEventRelay({ store, bus, worldId: world.id, fromEventId: 0 });
    await relay.start();
    await store.recordEvent({
      worldId: world.id,
      tick: 1,
      eventType: 'agent_dormant',
      actorId: aliceId,
      data: { reason: 'no_signal' },
      tokenCost: 0,
    });
    await store.recordEvent({
      worldId: world.id,
      tick: 1,
      eventType: 'agent_silent',
      actorId: aliceId,
      data: { reason: 'no_tool_call' },
      tokenCost: 0,
    });
    await relay.poll();
    // Synthesized tick_begin(1) plus nothing else — both event types
    // are silenced at the relay.
    expect(captured.map((e) => e.type)).toEqual(['tick_begin']);
    await relay.stop();
  });

  it('is idempotent across multiple poll() calls', async () => {
    const relay = new DbEventRelay({ store, bus, worldId: world.id, fromEventId: 0 });
    await relay.start();
    await store.recordEvent({
      worldId: world.id,
      tick: 1,
      eventType: 'action',
      actorId: aliceId,
      data: { action: 'think', args: { thought: 'x' } },
      tokenCost: 0,
    });
    await relay.poll();
    const firstPassCount = captured.length;
    await relay.poll(); // second call should observe no new rows
    expect(captured.length).toBe(firstPassCount);
    await relay.stop();
  });
});
