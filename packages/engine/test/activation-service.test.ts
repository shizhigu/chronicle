/**
 * ActivationService — one test per signal + no-signal dormancy.
 *
 * Each test isolates a single signal and asserts the service returns
 * `active: true` with the correct reason tag. A final test verifies
 * that when nothing fires, the service reports `active: false`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  type Agent,
  type Group,
  type Proposal,
  type World,
  agentId,
  groupId,
  proposalId,
  worldId,
} from '@chronicle/core';
import { ActivationService } from '../src/activation/service.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;
let alice: Agent;
let bob: Agent;
let svc: ActivationService;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'A',
    description: '',
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
      activation: { idleTimeout: 5, lookbackTicks: 2 },
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

function makeAgent(wId: string, name: string, lastActiveTick: number | null = 0): Agent {
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
    lastActiveTick,
  };
}

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);
  alice = makeAgent(world.id, 'Alice', 0);
  bob = makeAgent(world.id, 'Bob', 0);
  await store.createAgent(alice);
  await store.createAgent(bob);
  svc = new ActivationService(store, world);
});
afterEach(() => store.close());

describe('first_tick', () => {
  it('activates an agent who has never acted (lastActiveTick null)', async () => {
    const newborn = makeAgent(world.id, 'Newborn', null);
    await store.createAgent(newborn);
    const decision = await svc.shouldActivate(newborn, 1);
    expect(decision.active).toBe(true);
    expect(decision.reason).toBe('first_tick');
  });
});

describe('witnessed event signal', () => {
  it('activates when any event in the lookback window targets the agent', async () => {
    // Seed a speech event addressed to alice at tick 2.
    await store.recordEvent({
      worldId: world.id,
      tick: 2,
      eventType: 'action',
      actorId: bob.id,
      data: { action: 'speak', args: { content: 'hey Alice' } },
      visibleTo: [alice.id, bob.id],
    });

    const decision = await svc.shouldActivate(alice, 3);
    expect(decision.active).toBe(true);
    expect(decision.reason).toBe('witnessed');
  });

  it('activates on a public event (empty visibleTo = public per convention)', async () => {
    // Public events land with visibleTo:[] (see observation.ts).
    await store.recordEvent({
      worldId: world.id,
      tick: 2,
      eventType: 'catalyst',
      actorId: null,
      data: { text: 'A storm breaks out.' },
    });
    const decision = await svc.shouldActivate(alice, 3);
    expect(decision.active).toBe(true);
    expect(decision.reason).toBe('witnessed');
  });

  it('does NOT activate from an event outside the lookback window', async () => {
    // lookbackTicks = 2, so a tick-0 event is invisible from tick 5.
    await store.recordEvent({
      worldId: world.id,
      tick: 0,
      eventType: 'action',
      actorId: bob.id,
      data: {},
      visibleTo: [alice.id],
    });
    // Set alice's lastActiveTick close enough that idle doesn't also fire.
    const a = { ...alice, lastActiveTick: 4 };
    const decision = await svc.shouldActivate(a, 5);
    expect(decision.active).toBe(false);
  });

  it("does NOT activate from the agent's own event (no self-retrigger)", async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 2,
      eventType: 'action',
      actorId: alice.id,
      data: { action: 'speak' },
      // Public visibility but actor is self — must be filtered.
    });
    const a = { ...alice, lastActiveTick: 2 };
    const decision = await svc.shouldActivate(a, 3);
    expect(decision.active).toBe(false);
  });
});

describe('pending_vote signal', () => {
  it('activates a member with an open proposal they have not voted on', async () => {
    const g: Group = {
      id: groupId(),
      worldId: world.id,
      name: 'Council',
      description: '',
      procedureKind: 'vote',
      procedureConfig: {},
      joinPredicate: null,
      successionKind: null,
      visibilityPolicy: 'open',
      foundedTick: 0,
      dissolvedTick: null,
      createdAt: new Date().toISOString(),
    };
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 0);

    const p: Proposal = {
      id: proposalId(),
      worldId: world.id,
      sponsorAgentId: bob.id,
      targetGroupId: g.id,
      title: 'a',
      rationale: 'b',
      effects: [{ kind: 'create_location', name: 'X', description: '' }],
      compiledEffects: null,
      openedTick: 1,
      deadline: { kind: 'tick', at: 10 },
      procedureOverride: null,
      status: 'pending',
      decidedTick: null,
      outcomeDetail: null,
    };
    await store.createProposal(p);

    const a = { ...alice, lastActiveTick: 2 };
    const decision = await svc.shouldActivate(a, 3);
    expect(decision.active).toBe(true);
    expect(decision.reason).toBe('pending_vote');
  });

  it('does NOT activate after the agent has cast a vote (and no other signals fire)', async () => {
    const g: Group = {
      id: groupId(),
      worldId: world.id,
      name: 'Council',
      description: '',
      procedureKind: 'vote',
      procedureConfig: {},
      joinPredicate: null,
      successionKind: null,
      visibilityPolicy: 'open',
      foundedTick: 0,
      dissolvedTick: null,
      createdAt: new Date().toISOString(),
    };
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 0);

    const p: Proposal = {
      id: proposalId(),
      worldId: world.id,
      sponsorAgentId: bob.id,
      targetGroupId: g.id,
      title: 'a',
      rationale: 'b',
      effects: [{ kind: 'create_location', name: 'X', description: '' }],
      compiledEffects: null,
      openedTick: 1,
      deadline: { kind: 'tick', at: 10 },
      procedureOverride: null,
      status: 'pending',
      decidedTick: null,
      outcomeDetail: null,
    };
    await store.createProposal(p);
    // Cast the vote *without* generating a vote_cast event — go
    // straight to the store so the witnessed signal cannot fire and
    // we isolate the pending_vote behavior cleanly.
    await store.castVote({
      proposalId: p.id,
      voterAgentId: alice.id,
      stance: 'for',
      weight: 1,
      castTick: 2,
      reasoning: null,
    });

    // Set lastActiveTick close enough that idle_timeout can't fire.
    const a = { ...alice, lastActiveTick: 3 };
    const decision = await svc.shouldActivate(a, 4);
    expect(decision.active).toBe(false);
    expect(decision.reason).toBe('no_signal');
  });
});

describe('idle_timeout signal', () => {
  it('activates when gap equals or exceeds idleTimeout', async () => {
    const a = { ...alice, lastActiveTick: 0 };
    // idleTimeout=5, tick=5 → gap=5 → active
    const decision = await svc.shouldActivate(a, 5);
    expect(decision.active).toBe(true);
    expect(decision.reason).toBe('idle_timeout');
  });

  it('stays dormant within the timeout window when no other signal fires', async () => {
    const a = { ...alice, lastActiveTick: 3 };
    const decision = await svc.shouldActivate(a, 4);
    expect(decision.active).toBe(false);
    expect(decision.reason).toBe('no_signal');
  });

  it('Infinity disables the signal (reactive-only mode)', async () => {
    const reactiveWorld: World = {
      ...world,
      config: {
        ...world.config,
        activation: { idleTimeout: Number.POSITIVE_INFINITY, lookbackTicks: 2 },
      },
    };
    const reactiveSvc = new ActivationService(store, reactiveWorld);
    const a = { ...alice, lastActiveTick: 0 };
    const decision = await reactiveSvc.shouldActivate(a, 999);
    expect(decision.active).toBe(false);
  });
});

describe('no signal at all', () => {
  it('returns dormant with reason no_signal', async () => {
    const a = { ...alice, lastActiveTick: 3 };
    const decision = await svc.shouldActivate(a, 4); // no events, no votes, 1 tick gap
    expect(decision.active).toBe(false);
    expect(decision.reason).toBe('no_signal');
  });
});

describe('config validation', () => {
  it('throws on non-positive idleTimeout', () => {
    const bad: World = {
      ...world,
      config: { ...world.config, activation: { idleTimeout: 0, lookbackTicks: 2 } },
    };
    expect(() => new ActivationService(store, bad)).toThrow(/idleTimeout/);
    const worse: World = {
      ...world,
      config: { ...world.config, activation: { idleTimeout: -1, lookbackTicks: 2 } },
    };
    expect(() => new ActivationService(store, worse)).toThrow(/idleTimeout/);
  });

  it('throws on negative or non-finite lookbackTicks', () => {
    const bad: World = {
      ...world,
      config: { ...world.config, activation: { idleTimeout: 5, lookbackTicks: -1 } },
    };
    expect(() => new ActivationService(store, bad)).toThrow(/lookbackTicks/);
    const worse: World = {
      ...world,
      config: {
        ...world.config,
        activation: { idleTimeout: 5, lookbackTicks: Number.POSITIVE_INFINITY },
      },
    };
    expect(() => new ActivationService(store, worse)).toThrow(/lookbackTicks/);
  });

  it('accepts Infinity for idleTimeout (reactive-only mode) without throwing', () => {
    const ok: World = {
      ...world,
      config: {
        ...world.config,
        activation: { idleTimeout: Number.POSITIVE_INFINITY, lookbackTicks: 2 },
      },
    };
    expect(() => new ActivationService(store, ok)).not.toThrow();
  });
});

describe('determinism', () => {
  it('identical inputs produce identical decisions', async () => {
    const a = { ...alice, lastActiveTick: 2 };
    const first = await svc.shouldActivate(a, 4);
    const second = await svc.shouldActivate(a, 4);
    expect(first).toEqual(second);
  });
});
