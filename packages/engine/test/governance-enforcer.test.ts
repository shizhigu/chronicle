/**
 * Layer 1 enforcer behaviors: primary scope filtering + authority
 * overrides. The table below summarises what each test pins down.
 *
 *   | test                                   | shows                            |
 *   |----------------------------------------|----------------------------------|
 *   | world-scoped rules still bind all      | backward-compat                  |
 *   | group-scoped rules only bind members   | primary scope narrows            |
 *   | agent-scoped rules only bind agent     | primary scope narrows            |
 *   | authority on agent waives violation    | direct authority resolution      |
 *   | authority on group waives violation    | group-member resolution          |
 *   | authority on role waives violation     | role-holder resolution           |
 *   | expired authority does NOT waive       | tick filter                      |
 *   | revoked authority does NOT waive       | revocation filter                |
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  type Agent,
  type Authority,
  type Group,
  type ProposedAction,
  type Rule,
  type World,
  agentId,
  authorityId,
  groupId,
  ruleId,
  worldId,
} from '@chronicle/core';
import { RuleEnforcer } from '../src/rules/enforcer.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;
let alice: Agent;
let bob: Agent;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'G',
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

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: groupId(),
    worldId: world.id,
    name: 'Test',
    description: '',
    procedureKind: 'vote',
    procedureConfig: {},
    joinPredicate: null,
    successionKind: null,
    visibilityPolicy: 'open',
    foundedTick: 0,
    dissolvedTick: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * A rule that ALWAYS rejects. Useful to prove that a rule fired — if
 * validate() returns ok:true, the rule must have been filtered out of
 * scope or waived by authority.
 */
function alwaysRejectRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: ruleId(),
    worldId: world.id,
    description: 'forbidden',
    tier: 'hard',
    hardPredicate: 'true',
    hardCheck: 'false',
    hardOnViolation: 'reject',
    active: true,
    priority: 100,
    scopeKind: 'world',
    scopeRef: null,
    createdAt: new Date().toISOString(),
    createdByTick: null,
    compilerNotes: null,
    ...overrides,
  };
}

function proposedAction(actor: Agent): ProposedAction {
  return {
    agentId: actor.id,
    actionName: 'speak',
    args: {},
    proposedAt: Date.now(),
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

describe('primary scope filtering', () => {
  it('world-scoped rule binds every actor', async () => {
    await store.createRule(alwaysRejectRule({ scopeKind: 'world', scopeRef: null }));
    const enf = new RuleEnforcer(store, world);

    const r = await enf.validate({ character: alice, action: proposedAction(alice) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/rule_violated/);
  });

  it('group-scoped rule binds only members of the referenced group', async () => {
    const g = makeGroup();
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 0);

    await store.createRule(alwaysRejectRule({ scopeKind: 'group', scopeRef: g.id }));
    const enf = new RuleEnforcer(store, world);

    // Alice (member) — rule binds, action rejected.
    const rA = await enf.validate({ character: alice, action: proposedAction(alice) });
    expect(rA.ok).toBe(false);

    // Bob (non-member) — rule out of scope, action passes.
    const rB = await enf.validate({ character: bob, action: proposedAction(bob) });
    expect(rB.ok).toBe(true);
  });

  it('agent-scoped rule binds only the named agent', async () => {
    await store.createRule(alwaysRejectRule({ scopeKind: 'agent', scopeRef: alice.id }));
    const enf = new RuleEnforcer(store, world);

    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(
      false,
    );
    expect((await enf.validate({ character: bob, action: proposedAction(bob) })).ok).toBe(true);
  });
});

describe('authority overrides', () => {
  it('direct agent authority waives a matching rule violation', async () => {
    const rule = alwaysRejectRule();
    await store.createRule(rule);

    const auth: Authority = {
      id: authorityId(),
      worldId: world.id,
      holderKind: 'agent',
      holderRef: alice.id,
      powers: [{ kind: 'override_rule', ruleId: rule.id }],
      grantedTick: 0,
      expiresTick: null,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    };
    await store.grantAuthority(auth);

    const enf = new RuleEnforcer(store, world);

    // Alice has the power — she passes through.
    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(true);
    // Bob does not — he is still rejected.
    expect((await enf.validate({ character: bob, action: proposedAction(bob) })).ok).toBe(false);
  });

  it('group-held authority waives for every active member', async () => {
    const rule = alwaysRejectRule();
    await store.createRule(rule);

    const g = makeGroup();
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 0);

    await store.grantAuthority({
      id: authorityId(),
      worldId: world.id,
      holderKind: 'group',
      holderRef: g.id,
      powers: [{ kind: 'override_rule', ruleId: rule.id }],
      grantedTick: 0,
      expiresTick: null,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    });

    const enf = new RuleEnforcer(store, world);

    // Alice (member) — waived.
    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(true);
    // Bob (non-member) — still blocked.
    expect((await enf.validate({ character: bob, action: proposedAction(bob) })).ok).toBe(false);

    // If Alice leaves, the waiver no longer reaches her.
    await store.removeMembership(g.id, alice.id, 1);
    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(
      false,
    );
  });

  it('role-held authority waives only for the current role holder', async () => {
    const rule = alwaysRejectRule();
    await store.createRule(rule);

    const g = makeGroup();
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 0);
    await store.addMembership(g.id, bob.id, 0);

    await store.upsertGroupRole({
      groupId: g.id,
      roleName: 'chair',
      holderAgentId: alice.id,
      assignedTick: 0,
      votingWeight: 1,
      scopeRef: null,
    });

    await store.grantAuthority({
      id: authorityId(),
      worldId: world.id,
      holderKind: 'role',
      holderRef: `${g.id}#chair`,
      powers: [{ kind: 'override_rule', ruleId: rule.id }],
      grantedTick: 0,
      expiresTick: null,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    });

    const enf = new RuleEnforcer(store, world);

    // Alice sits in the chair — waived.
    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(true);
    // Bob is in the group but not in the role — still blocked.
    expect((await enf.validate({ character: bob, action: proposedAction(bob) })).ok).toBe(false);

    // Role reassignment flips the waiver without touching authority rows.
    await store.upsertGroupRole({
      groupId: g.id,
      roleName: 'chair',
      holderAgentId: bob.id,
      assignedTick: 5,
      votingWeight: 1,
      scopeRef: null,
    });
    // Enforcer caches authorities + rules; clear to pick up the role change.
    enf.invalidateCache();

    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(
      false,
    );
    expect((await enf.validate({ character: bob, action: proposedAction(bob) })).ok).toBe(true);
  });

  it('expired authority does NOT waive', async () => {
    const rule = alwaysRejectRule();
    await store.createRule(rule);

    await store.grantAuthority({
      id: authorityId(),
      worldId: world.id,
      holderKind: 'agent',
      holderRef: alice.id,
      powers: [{ kind: 'override_rule', ruleId: rule.id }],
      grantedTick: 0,
      expiresTick: 3, // expires before our test tick
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    });

    // world.currentTick is 0, enforcer asks at tick+1 = 1 — still in force.
    world.currentTick = 0;
    let enf = new RuleEnforcer(store, world);
    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(true);

    // Advance the world past expiry; the waiver no longer applies.
    world.currentTick = 10;
    enf = new RuleEnforcer(store, world);
    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(
      false,
    );
  });

  it('revoked authority does NOT waive even if not expired', async () => {
    const rule = alwaysRejectRule();
    await store.createRule(rule);

    const auth: Authority = {
      id: authorityId(),
      worldId: world.id,
      holderKind: 'agent',
      holderRef: alice.id,
      powers: [{ kind: 'override_rule', ruleId: rule.id }],
      grantedTick: 0,
      expiresTick: null,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    };
    await store.grantAuthority(auth);
    await store.revokeAuthority(auth.id, 1);

    const enf = new RuleEnforcer(store, world);
    expect((await enf.validate({ character: alice, action: proposedAction(alice) })).ok).toBe(
      false,
    );
  });
});
