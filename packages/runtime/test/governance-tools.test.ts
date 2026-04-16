/**
 * Layer 1 governance tools — form_group / join_group / leave_group.
 *
 * These exercise the compiled core tools directly with a real WorldStore
 * so the DB ↔ tool contract stays honest. The deeper authority /
 * enforcement behaviors live in governance-enforcer.test.ts (engine).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Agent, type World, agentId, worldId } from '@chronicle/core';
import { MemoryFileStore, WorldStore } from '@chronicle/engine';
import {
  type AnyAgentTool,
  type ExecutionContext,
  compileWorldTools,
} from '../src/tools/compiler.js';

let store: WorldStore;
let memory: MemoryFileStore;
let memRoot: string;
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

function findTool(tools: AnyAgentTool[], name: string): AnyAgentTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

function ctxFor(actor: Agent, tick = 1): ExecutionContext {
  return { world, character: actor, tick, store, memory };
}

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  memRoot = mkdtempSync(join(tmpdir(), 'chronicle-gov-'));
  memory = new MemoryFileStore({ root: memRoot });
  world = makeWorld();
  await store.createWorld(world);
  alice = makeAgent(world.id, 'Alice');
  bob = makeAgent(world.id, 'Bob');
  await store.createAgent(alice);
  await store.createAgent(bob);
});
afterEach(() => {
  store.close();
  rmSync(memRoot, { recursive: true, force: true });
});

describe('tool registration', () => {
  it('registers the governance trio alongside existing core tools', () => {
    const tools = compileWorldTools(world, alice, store, []);
    const names = tools.map((t) => t.name);
    expect(names).toContain('form_group');
    expect(names).toContain('join_group');
    expect(names).toContain('leave_group');
  });

  it('world action schemas cannot shadow the governance tool names', async () => {
    const tools = compileWorldTools(world, alice, store, [
      {
        id: 'act_bad',
        worldId: world.id,
        name: 'form_group',
        description: 'hostile',
        parametersSchema: {},
        baseCost: null,
        requiresTargetType: 'none',
        visibility: 'public',
        effects: null,
        enforcementRef: null,
        active: true,
      },
    ] as never);
    const hits = tools.filter((t) => t.name === 'form_group');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.description).toMatch(/Found a new group/);
  });
});

describe('form_group', () => {
  it('creates a group, enrolls the founder, stores metadata', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');

    const result = await formGroup.execute(
      {
        name: 'Council',
        description: 'The ruling council',
        procedure: 'vote',
      },
      ctxFor(alice, 3),
    );
    expect(result.ok).toBe(true);
    const groupIdOut = (result.sideEffects as { groupId: string }).groupId;

    const group = await store.getGroup(groupIdOut);
    expect(group?.name).toBe('Council');
    expect(group?.procedureKind).toBe('vote');
    expect(group?.foundedTick).toBe(3);

    expect(await store.isMember(groupIdOut, alice.id)).toBe(true);
  });

  it('for decree procedure, founder occupies the chair role', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');

    const result = await formGroup.execute(
      {
        name: 'Crown',
        description: 'tyranny',
        procedure: 'decree',
      },
      ctxFor(alice),
    );
    const g = (result.sideEffects as { groupId: string }).groupId;

    const role = await store.getGroupRole(g, 'chair');
    expect(role?.holderAgentId).toBe(alice.id);
  });

  it('delegated procedure requires toGroupId pointing at an existing group in the world', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');

    // No toGroupId → reject
    const missing = await formGroup.execute(
      { name: 'Alliance', description: '', procedure: 'delegated' },
      ctxFor(alice),
    );
    expect(missing.ok).toBe(false);
    expect(missing.detail).toBe('delegated_requires_toGroupId');

    // Bogus toGroupId → reject
    const bogus = await formGroup.execute(
      {
        name: 'Alliance',
        description: '',
        procedure: 'delegated',
        procedure_config: { toGroupId: 'grp_nope' },
      },
      ctxFor(alice),
    );
    expect(bogus.ok).toBe(false);
    expect(bogus.detail).toMatch(/no_target_group/);

    // Valid target → success
    const parent = await formGroup.execute(
      { name: 'Parent', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const parentId = (parent.sideEffects as { groupId: string }).groupId;

    const ok = await formGroup.execute(
      {
        name: 'Branch',
        description: '',
        procedure: 'delegated',
        procedure_config: { toGroupId: parentId },
      },
      ctxFor(bob),
    );
    expect(ok.ok).toBe(true);
  });

  it('rejects duplicate group names within the same world (case-insensitive)', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');

    await formGroup.execute({ name: 'Senate', description: 'x', procedure: 'vote' }, ctxFor(alice));
    const dup = await formGroup.execute(
      { name: 'SENATE', description: 'y', procedure: 'vote' },
      ctxFor(bob),
    );

    expect(dup.ok).toBe(false);
    expect(dup.detail).toMatch(/duplicate_group_name/);
  });
});

describe('join_group', () => {
  it('adds a member to an open group', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const joinGroup = findTool(tools, 'join_group');

    const form = await formGroup.execute(
      { name: 'OpenGuild', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const g = (form.sideEffects as { groupId: string }).groupId;

    const result = await joinGroup.execute({ group_id: g }, ctxFor(bob));
    expect(result.ok).toBe(true);
    expect(await store.isMember(g, bob.id)).toBe(true);
  });

  it('refuses to join a non-existent group', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const joinGroup = findTool(tools, 'join_group');

    const result = await joinGroup.execute({ group_id: 'grp_nope' }, ctxFor(alice));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/no_group/);
  });

  it('refuses to double-join', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const joinGroup = findTool(tools, 'join_group');

    const form = await formGroup.execute(
      { name: 'G', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const g = (form.sideEffects as { groupId: string }).groupId;

    const again = await joinGroup.execute({ group_id: g }, ctxFor(alice));
    expect(again.ok).toBe(false);
    expect(again.detail).toBe('already_member');
  });

  it('refuses to join a dissolved group', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const joinGroup = findTool(tools, 'join_group');

    const form = await formGroup.execute(
      { name: 'G', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const g = (form.sideEffects as { groupId: string }).groupId;
    await store.dissolveGroup(g, 5);

    const result = await joinGroup.execute({ group_id: g }, ctxFor(bob));
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('group_dissolved');
  });
});

describe('leave_group', () => {
  it('removes the caller and vacates any role they held', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const leaveGroup = findTool(tools, 'leave_group');

    const form = await formGroup.execute(
      { name: 'Tyrant', description: '', procedure: 'decree' },
      ctxFor(alice, 1),
    );
    const g = (form.sideEffects as { groupId: string }).groupId;

    // Alice is chair before leaving.
    expect((await store.getGroupRole(g, 'chair'))?.holderAgentId).toBe(alice.id);

    const leave = await leaveGroup.execute({ group_id: g }, ctxFor(alice, 5));
    expect(leave.ok).toBe(true);
    expect(await store.isMember(g, alice.id)).toBe(false);
    // Chair vacated, not dropped — Layer 2 succession will fill it.
    const role = await store.getGroupRole(g, 'chair');
    expect(role).toBeTruthy();
    expect(role?.holderAgentId).toBeNull();
  });

  it('refuses when the caller is not a member', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const leaveGroup = findTool(tools, 'leave_group');

    const form = await formGroup.execute(
      { name: 'G', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const g = (form.sideEffects as { groupId: string }).groupId;

    const result = await leaveGroup.execute({ group_id: g }, ctxFor(bob));
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('not_a_member');
  });
});
