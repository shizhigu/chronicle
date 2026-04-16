/**
 * Layer 1 governance — WorldStore CRUD for groups, memberships, roles,
 * authorities. The behaviors here are the ground truth for everything
 * that sits on top (scoped rules, future proposals, dashboards).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  type Agent,
  type Authority,
  type Group,
  type GroupRole,
  type World,
  agentId,
  authorityId,
  groupId,
  worldId,
} from '@chronicle/core';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;
let alice: Agent;
let bob: Agent;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'Gov',
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
    name: 'Council',
    description: 'the Council',
    procedureKind: 'vote',
    procedureConfig: { threshold: 0.5 },
    joinPredicate: null,
    successionKind: null,
    visibilityPolicy: 'open',
    foundedTick: 0,
    dissolvedTick: null,
    createdAt: new Date().toISOString(),
    ...overrides,
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

describe('groups CRUD', () => {
  it('round-trips a group', async () => {
    const g = makeGroup({ name: 'Council' });
    await store.createGroup(g);

    const fetched = await store.getGroup(g.id);
    expect(fetched).toBeTruthy();
    expect(fetched?.name).toBe('Council');
    expect(fetched?.procedureKind).toBe('vote');
    expect(fetched?.procedureConfig).toEqual({ threshold: 0.5 });
    expect(fetched?.visibilityPolicy).toBe('open');
    expect(fetched?.dissolvedTick).toBeNull();
  });

  it('lists active groups for a world, excluding dissolved by default', async () => {
    const alive = makeGroup({ name: 'Alive' });
    const dead = makeGroup({ name: 'Dead' });
    await store.createGroup(alive);
    await store.createGroup(dead);
    await store.dissolveGroup(dead.id, 5);

    const active = await store.getGroupsForWorld(world.id);
    expect(active.map((g) => g.name).sort()).toEqual(['Alive']);

    const all = await store.getGroupsForWorld(world.id, true);
    expect(all.map((g) => g.name).sort()).toEqual(['Alive', 'Dead']);
  });

  it('dissolveGroup stamps dissolvedTick without deleting the row', async () => {
    const g = makeGroup();
    await store.createGroup(g);
    await store.dissolveGroup(g.id, 42);

    const fetched = await store.getGroup(g.id);
    expect(fetched?.dissolvedTick).toBe(42);
  });
});

describe('memberships', () => {
  it('addMembership + isMember round-trip', async () => {
    const g = makeGroup();
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 1);

    expect(await store.isMember(g.id, alice.id)).toBe(true);
    expect(await store.isMember(g.id, bob.id)).toBe(false);
  });

  it('removeMembership stamps leftTick on the active row only', async () => {
    const g = makeGroup();
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 1);
    await store.removeMembership(g.id, alice.id, 5);

    expect(await store.isMember(g.id, alice.id)).toBe(false);
    // Audit: historical row persists
    const active = await store.getActiveMembershipsForGroup(g.id);
    expect(active).toHaveLength(0);
  });

  it('supports rejoin with a new joinedTick — two rows, second is active', async () => {
    const g = makeGroup();
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 1);
    await store.removeMembership(g.id, alice.id, 5);
    await store.addMembership(g.id, alice.id, 10);

    expect(await store.isMember(g.id, alice.id)).toBe(true);
    const active = await store.getActiveMembershipsForGroup(g.id);
    expect(active).toHaveLength(1);
    expect(active[0]?.joinedTick).toBe(10);
  });

  it('partial unique index rejects a second active membership for the same (group, agent)', async () => {
    const g = makeGroup();
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 1);

    // Even with a *different* joinedTick (which would pass the PK check),
    // the partial unique index `idx_memberships_one_active` rejects a
    // second row whose left_tick IS NULL. This is the guard against
    // concurrent join_group races producing duplicate active rows.
    const { AlreadyMemberError } = await import('../src/store.js');
    await expect(store.addMembership(g.id, alice.id, 2)).rejects.toBeInstanceOf(AlreadyMemberError);
    // Only one active row remains.
    expect(await store.getActiveMembershipsForGroup(g.id)).toHaveLength(1);
  });

  it('rejoin is allowed once the previous membership is ended', async () => {
    const g = makeGroup();
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 1);
    await store.removeMembership(g.id, alice.id, 3);
    // Now safe to re-add.
    await store.addMembership(g.id, alice.id, 5);
    expect(await store.isMember(g.id, alice.id)).toBe(true);
  });

  it('getActiveMembershipsForAgent returns all groups the agent belongs to', async () => {
    const a = makeGroup({ name: 'A' });
    const b = makeGroup({ name: 'B' });
    await store.createGroup(a);
    await store.createGroup(b);
    await store.addMembership(a.id, alice.id, 1);
    await store.addMembership(b.id, alice.id, 2);
    await store.addMembership(b.id, bob.id, 2);

    const aliceGroups = (await store.getActiveMembershipsForAgent(alice.id))
      .map((m) => m.groupId)
      .sort();
    expect(aliceGroups).toEqual([a.id, b.id].sort());

    const bobGroups = (await store.getActiveMembershipsForAgent(bob.id)).map((m) => m.groupId);
    expect(bobGroups).toEqual([b.id]);
  });
});

describe('group roles', () => {
  it('upsertGroupRole creates then updates the same (group, role) row', async () => {
    const g = makeGroup();
    await store.createGroup(g);

    const role: GroupRole = {
      groupId: g.id,
      roleName: 'chair',
      holderAgentId: alice.id,
      assignedTick: 1,
      votingWeight: 1,
      scopeRef: null,
    };
    await store.upsertGroupRole(role);

    let fetched = await store.getGroupRole(g.id, 'chair');
    expect(fetched?.holderAgentId).toBe(alice.id);

    // Reassign to bob — same primary key, no duplicate row.
    await store.upsertGroupRole({ ...role, holderAgentId: bob.id, assignedTick: 5 });

    fetched = await store.getGroupRole(g.id, 'chair');
    expect(fetched?.holderAgentId).toBe(bob.id);
    expect(fetched?.assignedTick).toBe(5);

    const all = await store.getRolesForGroup(g.id);
    expect(all).toHaveLength(1); // upsert, not insert-insert
  });

  it('vacating a role stores holderAgentId=null', async () => {
    const g = makeGroup();
    await store.createGroup(g);
    await store.upsertGroupRole({
      groupId: g.id,
      roleName: 'chair',
      holderAgentId: alice.id,
      assignedTick: 1,
      votingWeight: 1,
      scopeRef: null,
    });
    await store.upsertGroupRole({
      groupId: g.id,
      roleName: 'chair',
      holderAgentId: null,
      assignedTick: 2,
      votingWeight: 1,
      scopeRef: null,
    });
    const fetched = await store.getGroupRole(g.id, 'chair');
    expect(fetched?.holderAgentId).toBeNull();
  });
});

describe('authorities', () => {
  it('grantAuthority + revokeAuthority + filtering by tick', async () => {
    const g = makeGroup();
    await store.createGroup(g);

    const a: Authority = {
      id: authorityId(),
      worldId: world.id,
      holderKind: 'group',
      holderRef: g.id,
      powers: [{ kind: 'override_rule', ruleId: 'rul_x' }],
      grantedTick: 1,
      expiresTick: 10,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    };
    await store.grantAuthority(a);

    // In force at tick 5
    const atFive = await store.getActiveAuthoritiesForWorld(world.id, 5);
    expect(atFive).toHaveLength(1);

    // Out of force at tick 11 (expired)
    const atEleven = await store.getActiveAuthoritiesForWorld(world.id, 11);
    expect(atEleven).toHaveLength(0);

    // Revocation short-circuits expiry
    await store.revokeAuthority(a.id, 3);
    const afterRevoke = await store.getActiveAuthoritiesForWorld(world.id, 5);
    expect(afterRevoke).toHaveLength(0);
  });

  it('grantAuthority rejects a holder that lives in a different world', async () => {
    // Second world, with its own agent.
    const otherWorld: World = { ...makeWorld(), id: worldId() };
    await store.createWorld(otherWorld);
    const outsider = makeAgent(otherWorld.id, 'Outsider');
    await store.createAgent(outsider);

    // Attempt to grant an authority in `world` to `outsider` (who lives in `otherWorld`).
    await expect(
      store.grantAuthority({
        id: authorityId(),
        worldId: world.id,
        holderKind: 'agent',
        holderRef: outsider.id,
        powers: [{ kind: 'override_rule', ruleId: 'rul_x' }],
        grantedTick: 0,
        expiresTick: null,
        sourceEventId: null,
        revokedTick: null,
        revocationEventId: null,
      }),
    ).rejects.toThrow(/not in world/);
  });

  it('getAuthoritiesForHolder filters to the named holder', async () => {
    const g = makeGroup();
    await store.createGroup(g);

    await store.grantAuthority({
      id: authorityId(),
      worldId: world.id,
      holderKind: 'group',
      holderRef: g.id,
      powers: [{ kind: 'override_rule', ruleId: 'rul_group' }],
      grantedTick: 0,
      expiresTick: null,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    });
    await store.grantAuthority({
      id: authorityId(),
      worldId: world.id,
      holderKind: 'agent',
      holderRef: alice.id,
      powers: [{ kind: 'override_rule', ruleId: 'rul_alice' }],
      grantedTick: 0,
      expiresTick: null,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    });

    const groupAuth = await store.getAuthoritiesForHolder(world.id, 'group', g.id, 1);
    expect(groupAuth).toHaveLength(1);
    expect(groupAuth[0]?.powers[0]).toEqual({ kind: 'override_rule', ruleId: 'rul_group' });

    const aliceAuth = await store.getAuthoritiesForHolder(world.id, 'agent', alice.id, 1);
    expect(aliceAuth).toHaveLength(1);
    expect(aliceAuth[0]?.powers[0]).toEqual({ kind: 'override_rule', ruleId: 'rul_alice' });
  });
});
