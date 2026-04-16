/**
 * EffectRegistry — validate + execute for each effect kind.
 *
 * Each block covers one effect. We hit the store directly to seed
 * prerequisites, run validateEffects (should be null for happy path),
 * then applyEffects and assert the world actually mutated.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  type Agent,
  type Effect,
  type Group,
  type Location,
  type Resource,
  type World,
  agentId,
  groupId,
  locationId,
  resourceId,
  ruleId,
  worldId,
} from '@chronicle/core';
import { INVIOLABLE_MARKER, applyEffects, validateEffects } from '../src/governance/effects.js';
import { WorldStore } from '../src/store.js';

let store: WorldStore;
let world: World;
let alice: Agent;
let bob: Agent;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'E',
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

function makeGroup(wId: string, name: string): Group {
  return {
    id: groupId(),
    worldId: wId,
    name,
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
}

function ctx(tick = 5) {
  return { store, world, tick };
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

describe('create_location', () => {
  it('creates the location and connects adjacencies by name', async () => {
    const harbor: Location = {
      id: locationId(),
      worldId: world.id,
      name: 'Harbor',
      description: '',
      x: null,
      y: null,
      parentId: null,
      affordances: [],
      metadata: {},
      spriteHint: null,
      createdAt: new Date().toISOString(),
    };
    await store.createLocation(harbor);

    const effect: Effect = {
      kind: 'create_location',
      name: 'Avalon',
      description: 'A new colony',
      adjacentTo: ['Harbor'],
    };
    expect(await validateEffects([effect], ctx())).toBeNull();
    const results = await applyEffects([effect], ctx());
    expect(results[0]?.ok).toBe(true);

    const locs = await store.getLocationsForWorld(world.id);
    const avalon = locs.find((l) => l.name === 'Avalon');
    expect(avalon).toBeTruthy();
    const adj = await store.getAdjacentLocations(avalon!.id);
    expect(adj).toContain(harbor.id);
  });

  it('rejects a duplicate name', async () => {
    const loc: Location = {
      id: locationId(),
      worldId: world.id,
      name: 'Market',
      description: '',
      x: null,
      y: null,
      parentId: null,
      affordances: [],
      metadata: {},
      spriteHint: null,
      createdAt: new Date().toISOString(),
    };
    await store.createLocation(loc);

    const v = await validateEffects(
      [{ kind: 'create_location', name: 'market', description: '' }],
      ctx(),
    );
    expect(v?.reason).toMatch(/duplicate_location_name/);
  });
});

describe('create_group + dissolve_group + add_member + remove_member', () => {
  it('round-trips the group lifecycle', async () => {
    const results = await applyEffects(
      [
        {
          kind: 'create_group',
          name: 'Council',
          description: 'the council',
          procedure: 'vote',
          initialMembers: [alice.id],
        },
      ],
      ctx(),
    );
    const gid = (results[0]?.created as { groupId: string }).groupId;
    expect(await store.isMember(gid, alice.id)).toBe(true);

    // add_member
    const r2 = await applyEffects([{ kind: 'add_member', groupId: gid, agentId: bob.id }], ctx());
    expect(r2[0]?.ok).toBe(true);
    expect(await store.isMember(gid, bob.id)).toBe(true);

    // remove_member + implicit role vacate
    await store.upsertGroupRole({
      groupId: gid,
      roleName: 'chair',
      holderAgentId: bob.id,
      assignedTick: 0,
      votingWeight: 1,
      scopeRef: null,
    });
    const r3 = await applyEffects(
      [{ kind: 'remove_member', groupId: gid, agentId: bob.id }],
      ctx(),
    );
    expect(r3[0]?.ok).toBe(true);
    expect(await store.isMember(gid, bob.id)).toBe(false);
    const chair = await store.getGroupRole(gid, 'chair');
    expect(chair?.holderAgentId).toBeNull();

    // dissolve
    const r4 = await applyEffects([{ kind: 'dissolve_group', groupId: gid }], ctx());
    expect(r4[0]?.ok).toBe(true);
    const g = await store.getGroup(gid);
    expect(g?.dissolvedTick).not.toBeNull();
  });
});

describe('assign_role + vacate_role', () => {
  it('assigns then vacates a role', async () => {
    const g = makeGroup(world.id, 'Senate');
    await store.createGroup(g);
    await store.addMembership(g.id, alice.id, 0);

    const r1 = await applyEffects(
      [
        {
          kind: 'assign_role',
          groupId: g.id,
          roleName: 'consul',
          agentId: alice.id,
          votingWeight: 2,
        },
      ],
      ctx(),
    );
    expect(r1[0]?.ok).toBe(true);
    const role = await store.getGroupRole(g.id, 'consul');
    expect(role?.holderAgentId).toBe(alice.id);
    expect(role?.votingWeight).toBe(2);

    const r2 = await applyEffects(
      [{ kind: 'vacate_role', groupId: g.id, roleName: 'consul' }],
      ctx(),
    );
    expect(r2[0]?.ok).toBe(true);
    expect((await store.getGroupRole(g.id, 'consul'))?.holderAgentId).toBeNull();
  });

  it('refuses to assign a role to a non-member', async () => {
    const g = makeGroup(world.id, 'Senate');
    await store.createGroup(g);

    const v = await validateEffects(
      [{ kind: 'assign_role', groupId: g.id, roleName: 'consul', agentId: alice.id }],
      ctx(),
    );
    expect(v?.reason).toMatch(/agent_not_in_group/);
  });
});

describe('grant_authority + revoke_authority', () => {
  it('grants and revokes', async () => {
    const g = makeGroup(world.id, 'Crown');
    await store.createGroup(g);

    const r1 = await applyEffects(
      [
        {
          kind: 'grant_authority',
          holderKind: 'group',
          holderRef: g.id,
          powers: [{ kind: 'override_rule', ruleId: 'rul_x' }],
        },
      ],
      ctx(),
    );
    expect(r1[0]?.ok).toBe(true);
    const authId = (r1[0]?.created as { authorityId: string }).authorityId;

    const active = await store.getActiveAuthoritiesForWorld(world.id, 10);
    expect(active.map((a) => a.id)).toContain(authId);

    const r2 = await applyEffects([{ kind: 'revoke_authority', authorityId: authId }], ctx());
    expect(r2[0]?.ok).toBe(true);
    expect((await store.getActiveAuthoritiesForWorld(world.id, 10)).map((a) => a.id)).not.toContain(
      authId,
    );
  });

  it('rejects cross-world holder', async () => {
    const otherW = { ...makeWorld(), id: worldId() };
    await store.createWorld(otherW);

    const v = await validateEffects(
      [
        {
          kind: 'grant_authority',
          holderKind: 'agent',
          holderRef: 'agt_nope',
          powers: [{ kind: 'override_rule', ruleId: 'rul_x' }],
        },
      ],
      ctx(),
    );
    expect(v?.reason).toMatch(/bad_holder/);
  });
});

describe('create_rule + repeal_rule + inviolable guard', () => {
  it('creates a rule then repeals it', async () => {
    const r1 = await applyEffects(
      [
        {
          kind: 'create_rule',
          description: 'no loitering',
          tier: 'hard',
          check: 'action.name != "loiter"',
          onViolation: 'reject',
        },
      ],
      ctx(),
    );
    const rid = (r1[0]?.created as { ruleId: string }).ruleId;

    let rules = await store.getActiveRules(world.id);
    expect(rules.some((r) => r.id === rid)).toBe(true);

    const r2 = await applyEffects([{ kind: 'repeal_rule', ruleId: rid }], ctx());
    expect(r2[0]?.ok).toBe(true);
    rules = await store.getActiveRules(world.id);
    expect(rules.some((r) => r.id === rid)).toBe(false);
  });

  it('refuses to repeal a rule flagged inviolable', async () => {
    // Seed an inviolable rule manually — normally the world-compiler
    // would tag it at creation, but the flag is just a substring in
    // compilerNotes so we can fabricate the fixture here.
    const rid = ruleId();
    await store.createRule({
      id: rid,
      worldId: world.id,
      description: 'no killing, ever',
      tier: 'hard',
      hardCheck: 'true',
      hardOnViolation: 'reject',
      active: true,
      priority: 100,
      scopeKind: 'world',
      scopeRef: null,
      createdAt: new Date().toISOString(),
      createdByTick: 0,
      compilerNotes: `seed:${INVIOLABLE_MARKER}`,
    });

    const v = await validateEffects([{ kind: 'repeal_rule', ruleId: rid }], ctx());
    expect(v?.reason).toMatch(/inviolable_rule/);
  });
});

describe('change_procedure', () => {
  it('switches a group from vote to decree', async () => {
    const g = makeGroup(world.id, 'Shifty');
    await store.createGroup(g);

    const r = await applyEffects(
      [
        {
          kind: 'change_procedure',
          groupId: g.id,
          newProcedure: 'decree',
          newConfig: { holderRole: 'emperor' },
        },
      ],
      ctx(),
    );
    expect(r[0]?.ok).toBe(true);

    const reloaded = await store.getGroup(g.id);
    expect(reloaded?.procedureKind).toBe('decree');
    expect(reloaded?.procedureConfig).toEqual({ holderRole: 'emperor' });
  });
});

describe('transfer_resource', () => {
  it('moves quantity from one owner to another', async () => {
    const loc: Location = {
      id: locationId(),
      worldId: world.id,
      name: 'stash',
      description: '',
      x: null,
      y: null,
      parentId: null,
      affordances: [],
      metadata: {},
      spriteHint: null,
      createdAt: new Date().toISOString(),
    };
    await store.createLocation(loc);

    const res: Resource = {
      id: resourceId(),
      worldId: world.id,
      type: 'gold',
      ownerAgentId: alice.id,
      ownerLocationId: null,
      quantity: 10,
      metadata: {},
    };
    await store.createResource(res);

    const r = await applyEffects(
      [
        {
          kind: 'transfer_resource',
          resourceId: res.id,
          toOwnerKind: 'agent',
          toOwnerRef: bob.id,
          quantity: 4,
        },
      ],
      ctx(),
    );
    expect(r[0]?.ok).toBe(true);

    const aliceOwns = await store.getResourcesOwnedBy(alice.id);
    const bobOwns = await store.getResourcesOwnedBy(bob.id);
    const aliceGold = aliceOwns.find((x) => x.type === 'gold');
    const bobGold = bobOwns.find((x) => x.type === 'gold');
    expect(aliceGold?.quantity).toBe(6);
    expect(bobGold?.quantity).toBe(4);
  });
});

describe('update_agent', () => {
  it('patches the specified fields and leaves omitted ones untouched', async () => {
    const r = await applyEffects(
      [
        {
          kind: 'update_agent',
          agentId: alice.id,
          persona: 'Alice, now a schemer',
          mood: 'paranoid',
          traits: { boldness: 0.9 },
        },
      ],
      ctx(),
    );
    expect(r[0]?.ok).toBe(true);
    const fresh = await store.getAgent(alice.id);
    expect(fresh.persona).toBe('Alice, now a schemer');
    expect(fresh.mood).toBe('paranoid');
    expect(fresh.traits).toEqual({ boldness: 0.9 });
    // Fields we didn't touch stay as they were.
    expect(fresh.energy).toBe(alice.energy);
  });

  it('null mood clears the field; null privateState clears it too', async () => {
    await store.updateAgentState(alice.id, {
      mood: 'ecstatic',
      privateState: { secret: 'seed' },
    });

    const r = await applyEffects(
      [{ kind: 'update_agent', agentId: alice.id, mood: null, privateState: null }],
      ctx(),
    );
    expect(r[0]?.ok).toBe(true);
    const fresh = await store.getAgent(alice.id);
    expect(fresh.mood).toBeNull();
    expect(fresh.privateState).toBeNull();
  });

  it('validates the agent lives in the current world', async () => {
    const otherW = { ...makeWorld(), id: worldId() };
    await store.createWorld(otherW);
    const outsider = makeAgent(otherW.id, 'Outsider');
    await store.createAgent(outsider);

    const v = await validateEffects(
      [{ kind: 'update_agent', agentId: outsider.id, mood: 'confused' }],
      ctx(),
    );
    expect(v?.reason).toMatch(/no_agent/);
  });

  it('validate rejects an update with no changes', async () => {
    const v = await validateEffects([{ kind: 'update_agent', agentId: alice.id }], ctx());
    expect(v?.reason).toBe('update_agent_no_changes');
  });
});

describe('revoke_authority — inviolable guard', () => {
  it('refuses to revoke an authority carrying the inviolable power', async () => {
    const g = makeGroup(world.id, 'Crown');
    await store.createGroup(g);

    // Seed an inviolable authority — imagine the world-compiler did this at
    // world creation to protect a runtime invariant.
    const { authorityId } = await import('@chronicle/core');
    const inviolableId = authorityId();
    await store.grantAuthority({
      id: inviolableId,
      worldId: world.id,
      holderKind: 'group',
      holderRef: g.id,
      powers: [{ kind: 'inviolable' }, { kind: 'override_rule', ruleId: 'rul_safety' }],
      grantedTick: 0,
      expiresTick: null,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    });

    // Attempting to revoke must fail at validate-time.
    const v = await validateEffects(
      [{ kind: 'revoke_authority', authorityId: inviolableId }],
      ctx(),
    );
    expect(v?.reason).toMatch(/inviolable_authority/);

    // Even if it somehow slipped to applyEffects, the per-effect
    // pre-execute re-validation catches it.
    const results = await applyEffects(
      [{ kind: 'revoke_authority', authorityId: inviolableId }],
      ctx(),
    );
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toMatch(/validate_failed:inviolable_authority/);

    // Still active — privilege escalation chain blocked.
    const active = await store.getActiveAuthoritiesForWorld(world.id, 10);
    expect(active.map((a) => a.id)).toContain(inviolableId);
  });

  it('revoke_authority with a non-existent id fails cleanly', async () => {
    const v = await validateEffects(
      [{ kind: 'revoke_authority', authorityId: 'auth_nope' }],
      ctx(),
    );
    expect(v?.reason).toMatch(/no_authority/);
  });
});

describe('transfer_resource — location destination uses context worldId', () => {
  it('creates the new resource row under the correct world', async () => {
    const loc: Location = {
      id: locationId(),
      worldId: world.id,
      name: 'barn',
      description: '',
      x: null,
      y: null,
      parentId: null,
      affordances: [],
      metadata: {},
      spriteHint: null,
      createdAt: new Date().toISOString(),
    };
    await store.createLocation(loc);

    const res: Resource = {
      id: resourceId(),
      worldId: world.id,
      type: 'grain',
      ownerAgentId: alice.id,
      ownerLocationId: null,
      quantity: 5,
      metadata: {},
    };
    await store.createResource(res);

    const r = await applyEffects(
      [
        {
          kind: 'transfer_resource',
          resourceId: res.id,
          toOwnerKind: 'location',
          toOwnerRef: loc.id,
          quantity: 3,
        },
      ],
      ctx(),
    );
    expect(r[0]?.ok).toBe(true);

    // The new resource row at the location is under the right world,
    // not under empty string / wrong world.
    const db = store.raw;
    const rows = db
      .query<{ id: string; world_id: string; quantity: number }, [string]>(
        'SELECT id, world_id, quantity FROM resources WHERE owner_location_id = ?',
      )
      .all(loc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.world_id).toBe(world.id);
    expect(rows[0]?.quantity).toBe(3);
  });
});

describe('applyEffects does NOT roll back earlier effects on later failure', () => {
  it('records the failure but keeps prior effects committed', async () => {
    const r = await applyEffects(
      [
        { kind: 'create_group', name: 'Kept', description: '', procedure: 'vote' },
        // This one is invalid at execute-time (no such group), but
        // execute() will throw and result in a failure entry.
        { kind: 'dissolve_group', groupId: 'grp_nope' },
      ],
      ctx(),
    );
    expect(r[0]?.ok).toBe(true);
    expect(r[1]?.ok).toBe(false);
    const groups = await store.getGroupsForWorld(world.id);
    expect(groups.some((g) => g.name === 'Kept')).toBe(true);
  });
});
