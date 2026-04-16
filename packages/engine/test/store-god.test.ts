/**
 * God intervention queue, action schemas, rule persistence, tokens accounting.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { actionId, ruleId, worldId } from '@chronicle/core';
import type { ActionSchema, Rule, World } from '@chronicle/core';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'T',
    description: 't',
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
    currentTick: 0,
    status: 'running',
    godBudgetTokens: 10_000,
    tokensUsed: 0,
    tickDurationDescription: null,
    dayNightCycleTicks: null,
    createdAt: new Date().toISOString(),
    createdByChronicle: null,
    forkFromTick: null,
    rngSeed: 1,
  };
}

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);
});
afterEach(() => store.close());

describe('God interventions', () => {
  it('queues an intervention with applyAtTick', async () => {
    const id = await store.queueIntervention({
      worldId: world.id,
      queuedTick: 0,
      applyAtTick: 5,
      description: 'Make it rain',
      compiledEffects: { weather: 'rain' },
      notes: null,
    });
    expect(id).toBeGreaterThan(0);
  });

  it('getPendingInterventions returns only those due and unapplied', async () => {
    await store.queueIntervention({
      worldId: world.id,
      queuedTick: 0,
      applyAtTick: 2,
      description: 'A',
      compiledEffects: null,
      notes: null,
    });
    await store.queueIntervention({
      worldId: world.id,
      queuedTick: 0,
      applyAtTick: 10,
      description: 'B',
      compiledEffects: null,
      notes: null,
    });

    const pendingAt2 = await store.getPendingInterventions(world.id, 2);
    expect(pendingAt2.length).toBe(1);
    expect(pendingAt2[0]?.description).toBe('A');

    const pendingAt10 = await store.getPendingInterventions(world.id, 10);
    expect(pendingAt10.length).toBe(2);
  });

  it('markInterventionApplied removes from pending', async () => {
    const id = await store.queueIntervention({
      worldId: world.id,
      queuedTick: 0,
      applyAtTick: 1,
      description: 'Once',
      compiledEffects: null,
      notes: null,
    });
    await store.markInterventionApplied(id);
    const pending = await store.getPendingInterventions(world.id, 10);
    expect(pending.length).toBe(0);
  });
});

describe('Rules persistence', () => {
  function rule(overrides: Partial<Rule>): Rule {
    return {
      id: ruleId(),
      worldId: world.id,
      description: 'x',
      tier: 'hard',
      active: true,
      priority: 0,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: null,
      ...overrides,
    } as Rule;
  }

  it('getActiveRules excludes inactive', async () => {
    await store.createRule(rule({ description: 'active' }));
    await store.createRule(rule({ description: 'inactive', active: false }));
    const rules = await store.getActiveRules(world.id);
    expect(rules.length).toBe(1);
    expect(rules[0]?.description).toBe('active');
  });

  it('getActiveRules orders by priority desc', async () => {
    await store.createRule(rule({ description: 'low', priority: 0 }));
    await store.createRule(rule({ description: 'high', priority: 10 }));
    await store.createRule(rule({ description: 'mid', priority: 5 }));
    const rules = await store.getActiveRules(world.id);
    expect(rules.map((r) => r.description)).toEqual(['high', 'mid', 'low']);
  });

  it('roundtrips all three tiers', async () => {
    await store.createRule(
      rule({
        tier: 'hard',
        hardPredicate: 'alive',
        hardCheck: 'character.alive',
        hardOnViolation: 'reject',
      }),
    );
    await store.createRule(
      rule({
        tier: 'soft',
        softNormText: 'be polite',
        softDetectionPrompt: 'rude?',
        softConsequence: 'lose respect',
      }),
    );
    await store.createRule(
      rule({
        tier: 'economic',
        economicActionType: 'speak',
        economicCostFormula: 'energy=2',
      }),
    );

    const rules = await store.getActiveRules(world.id);
    const byTier = new Map(rules.map((r) => [r.tier, r]));
    expect(byTier.get('hard')?.hardCheck).toBe('character.alive');
    expect(byTier.get('soft')?.softNormText).toBe('be polite');
    expect(byTier.get('economic')?.economicCostFormula).toBe('energy=2');
  });
});

describe('Action schemas', () => {
  it('creates and lists active action schemas', async () => {
    const schema: ActionSchema = {
      id: actionId(),
      worldId: world.id,
      name: 'speak',
      description: 'say something',
      parametersSchema: { type: 'object', properties: { content: { type: 'string' } } },
      baseCost: { energy: 1 },
      requiresTargetType: 'none',
      visibility: 'public',
      effects: {},
      enforcementRef: null,
      active: true,
    };
    await store.createActionSchema(schema);
    const got = await store.getActiveActionSchemas(world.id);
    expect(got.length).toBe(1);
    expect(got[0]?.name).toBe('speak');
    expect(got[0]?.baseCost.energy).toBe(1);
  });
});

describe('Token accounting', () => {
  it('incrementTokensUsed is atomic and cumulative', async () => {
    await store.incrementTokensUsed(world.id, 100);
    await store.incrementTokensUsed(world.id, 250);
    const w = await store.loadWorld(world.id);
    expect(w.tokensUsed).toBe(350);
  });
});

describe('Snapshots', () => {
  it('snapshot is idempotent on (world, tick)', async () => {
    await store.snapshot(world.id, 5, JSON.stringify({ state: 'a' }), 10);
    // calling again with same (world, tick) should not throw
    await store.snapshot(world.id, 5, JSON.stringify({ state: 'b' }), 15);
    // first snapshot wins via onConflictDoNothing — second is ignored
    // (we don't expose a getter here; this test just verifies no crash)
  });
});
