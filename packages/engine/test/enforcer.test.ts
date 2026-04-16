/**
 * RuleEnforcer tests — all three tiers, plus scope and cost arithmetic.
 *
 * Backed by an in-memory WorldStore; no LLM calls (soft-rule judge stubbed).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, ruleId, worldId } from '@chronicle/core';
import type { Agent, ProposedAction, Rule, World } from '@chronicle/core';
import { RuleEnforcer } from '../src/rules/enforcer.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;

function makeWorld(id: string): World {
  return {
    id,
    name: 'Test',
    description: 't',
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
    currentTick: 5,
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

function makeAgent(wId: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name: 'A',
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
    ...overrides,
  };
}

function makeRule(wId: string, overrides: Partial<Rule>): Rule {
  return {
    id: ruleId(),
    worldId: wId,
    description: 'test rule',
    tier: 'hard',
    active: true,
    priority: 0,
    createdAt: new Date().toISOString(),
    createdByTick: null,
    compilerNotes: null,
    ...overrides,
  } as Rule;
}

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    agentId: 'agt_caller',
    actionName: 'speak',
    args: { content: 'hello' },
    proposedAt: 0,
    ...overrides,
  };
}

const action = makeAction();

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld(worldId());
  await store.createWorld(world);
});

afterEach(() => store.close());

describe('RuleEnforcer — hard rules', () => {
  it('allows action when no rules exist', async () => {
    const enforcer = new RuleEnforcer(store, world);
    const agent = makeAgent(world.id);
    const result = await enforcer.validate({ character: agent, action });
    expect(result.ok).toBe(true);
  });

  it('rejects action when a hard rule fails with reject-on-violation', async () => {
    await store.createRule(
      makeRule(world.id, {
        tier: 'hard',
        hardPredicate: 'character must be alive',
        hardCheck: 'character.alive',
        hardOnViolation: 'reject',
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const deadAgent = makeAgent(world.id, { alive: false });
    const result = await enforcer.validate({ character: deadAgent, action });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('rule_violated');
  });

  it('passes when hard predicate is satisfied', async () => {
    await store.createRule(
      makeRule(world.id, {
        tier: 'hard',
        hardCheck: 'character.alive',
        hardOnViolation: 'reject',
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const aliveAgent = makeAgent(world.id, { alive: true });
    const result = await enforcer.validate({ character: aliveAgent, action });
    expect(result.ok).toBe(true);
  });
});

describe('RuleEnforcer — economic rules', () => {
  it('accumulates cost across economic rules that apply to the action', async () => {
    await store.createRule(
      makeRule(world.id, {
        tier: 'economic',
        economicActionType: 'speak',
        economicCostFormula: 'energy=2,tokens=5',
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const agent = makeAgent(world.id, { energy: 100 });
    const result = await enforcer.validate({ character: agent, action });
    expect(result.ok).toBe(true);
    expect(result.cost?.energy).toBe(2);
    expect(result.cost?.tokens).toBe(5);
  });

  it('skips economic rules for a different action type', async () => {
    await store.createRule(
      makeRule(world.id, {
        tier: 'economic',
        economicActionType: 'fight',
        economicCostFormula: 'energy=20',
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const agent = makeAgent(world.id);
    const result = await enforcer.validate({ character: agent, action });
    expect(result.ok).toBe(true);
    expect(result.cost?.energy).toBeUndefined();
  });

  it('rejects when actor cannot afford the energy cost', async () => {
    await store.createRule(
      makeRule(world.id, {
        tier: 'economic',
        economicActionType: 'speak',
        economicCostFormula: 'energy=50',
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const tired = makeAgent(world.id, { energy: 10 });
    const result = await enforcer.validate({ character: tired, action });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_energy');
  });

  it('rejects when actor would exceed token budget', async () => {
    await store.createRule(
      makeRule(world.id, {
        tier: 'economic',
        economicActionType: 'speak',
        economicCostFormula: 'tokens=100',
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const agent = makeAgent(world.id, { tokensBudget: 50, tokensSpent: 0 });
    const result = await enforcer.validate({ character: agent, action });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_tokens');
  });
});

describe('RuleEnforcer — scope filtering', () => {
  it('ignores rule that targets a different agent', async () => {
    const agent = makeAgent(world.id);
    await store.createRule(
      makeRule(world.id, {
        tier: 'economic',
        economicActionType: 'speak',
        economicCostFormula: 'energy=50',
        scope: { agentIds: ['other_agent_id'] },
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const result = await enforcer.validate({ character: agent, action });
    expect(result.ok).toBe(true);
    expect(result.cost?.energy).toBeUndefined();
  });

  it('applies rule that targets this agent', async () => {
    const agent = makeAgent(world.id);
    await store.createRule(
      makeRule(world.id, {
        tier: 'economic',
        economicActionType: 'speak',
        economicCostFormula: 'energy=3',
        scope: { agentIds: [agent.id] },
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const result = await enforcer.validate({ character: agent, action });
    expect(result.cost?.energy).toBe(3);
  });
});

describe('RuleEnforcer — cache invalidation', () => {
  it('picks up new rules after invalidateCache()', async () => {
    const enforcer = new RuleEnforcer(store, world);
    const agent = makeAgent(world.id);
    let result = await enforcer.validate({ character: agent, action });
    expect(result.cost?.energy).toBeUndefined();

    await store.createRule(
      makeRule(world.id, {
        tier: 'economic',
        economicActionType: 'speak',
        economicCostFormula: 'energy=7',
      }),
    );
    enforcer.invalidateCache();
    result = await enforcer.validate({ character: agent, action });
    expect(result.cost?.energy).toBe(7);
  });
});

describe('RuleEnforcer — soft-rule judge', () => {
  it('returns empty violations when judge returns no violations (stub)', async () => {
    await store.createRule(
      makeRule(world.id, {
        tier: 'soft',
        softNormText: 'Be polite.',
        softDetectionPrompt: 'Was the speaker rude?',
      }),
    );
    const enforcer = new RuleEnforcer(store, world);
    const agent = makeAgent(world.id);
    const violations = await enforcer.judgeSoftRules(agent, action, []);
    expect(violations).toEqual([]);
  });
});
