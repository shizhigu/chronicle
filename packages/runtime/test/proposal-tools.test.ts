/**
 * Layer-2 agent tools — propose / vote / withdraw_proposal.
 *
 * These exercise the tool surface end-to-end: create a group with
 * real store-backed members, submit a proposal, cast votes, then let
 * ProposalService settle and assert the effects actually applied.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Agent, type World, agentId, worldId } from '@chronicle/core';
import { EventBus, MemoryFileStore, ProposalService, WorldStore } from '@chronicle/engine';
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
    name: 'L2',
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
  memRoot = mkdtempSync(join(tmpdir(), 'chronicle-l2tools-'));
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
  it('registers propose / vote / withdraw_proposal alongside core tools', () => {
    const tools = compileWorldTools(world, alice, store, []);
    const names = tools.map((t) => t.name);
    expect(names).toContain('propose');
    expect(names).toContain('vote');
    expect(names).toContain('withdraw_proposal');
  });
});

describe('propose', () => {
  it('opens a pending proposal owned by the sponsor', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const propose = findTool(tools, 'propose');

    const form = await formGroup.execute(
      { name: 'Council', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const gid = (form.sideEffects as { groupId: string }).groupId;

    const r = await propose.execute(
      {
        target_group_id: gid,
        title: 'Found Avalon',
        rationale: 'we need a new outpost',
        effects: [{ kind: 'create_location', name: 'Avalon', description: 'new' }],
      },
      ctxFor(alice, 2),
    );
    expect(r.ok).toBe(true);
    const pid = (r.sideEffects as { proposalId: string }).proposalId;

    const prop = await store.getProposal(pid);
    expect(prop?.status).toBe('pending');
    expect(prop?.sponsorAgentId).toBe(alice.id);
    expect(prop?.targetGroupId).toBe(gid);
    expect(prop?.openedTick).toBe(2);
  });

  it('refuses when sponsor is not a member of the target group', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const propose = findTool(tools, 'propose');

    const form = await formGroup.execute(
      { name: 'Closed', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const gid = (form.sideEffects as { groupId: string }).groupId;

    // Bob is not a member.
    const r = await propose.execute(
      {
        target_group_id: gid,
        title: 'x',
        rationale: 'x',
        effects: [{ kind: 'create_location', name: 'Z', description: '' }],
      },
      ctxFor(bob),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('not_a_member');
  });

  it('rejects a proposal whose effects fail EffectRegistry validation', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const propose = findTool(tools, 'propose');

    const form = await formGroup.execute(
      { name: 'G', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const gid = (form.sideEffects as { groupId: string }).groupId;

    const r = await propose.execute(
      {
        target_group_id: gid,
        title: 'bad',
        rationale: 'bad',
        effects: [{ kind: 'add_member', groupId: 'grp_nope', agentId: alice.id }],
      },
      ctxFor(alice),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/effect_invalid:0:no_group/);
  });
});

describe('vote', () => {
  it('records a vote and overwrites a prior stance', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const propose = findTool(tools, 'propose');
    const vote = findTool(tools, 'vote');
    const joinGroup = findTool(tools, 'join_group');

    const form = await formGroup.execute(
      { name: 'G', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const gid = (form.sideEffects as { groupId: string }).groupId;
    await joinGroup.execute({ group_id: gid }, ctxFor(bob));

    const prop = await propose.execute(
      {
        target_group_id: gid,
        title: 't',
        rationale: 'r',
        effects: [{ kind: 'create_location', name: 'Q', description: '' }],
      },
      ctxFor(alice, 2),
    );
    const pid = (prop.sideEffects as { proposalId: string }).proposalId;

    // Bob votes against, then changes his mind.
    await vote.execute({ proposal_id: pid, stance: 'against' }, ctxFor(bob, 3));
    await vote.execute(
      { proposal_id: pid, stance: 'for', reasoning: 'reconsidered' },
      ctxFor(bob, 4),
    );

    const votes = await store.getVotesForProposal(pid);
    const bobVote = votes.find((v) => v.voterAgentId === bob.id);
    expect(bobVote?.stance).toBe('for');
    expect(bobVote?.reasoning).toBe('reconsidered');
    expect(votes.filter((v) => v.voterAgentId === bob.id)).toHaveLength(1); // overwrite, not append
  });

  it('uses role voting weight when the voter holds a weighted role', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const propose = findTool(tools, 'propose');
    const vote = findTool(tools, 'vote');

    const form = await formGroup.execute(
      { name: 'G', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const gid = (form.sideEffects as { groupId: string }).groupId;
    // Alice is founder-chair from form_group(decree)? No, she formed with 'vote'.
    // We assign a weight manually via the store.
    await store.upsertGroupRole({
      groupId: gid,
      roleName: 'senior',
      holderAgentId: alice.id,
      assignedTick: 0,
      votingWeight: 3,
      scopeRef: null,
    });

    const prop = await propose.execute(
      {
        target_group_id: gid,
        title: 't',
        rationale: 'r',
        effects: [{ kind: 'create_location', name: 'Q', description: '' }],
      },
      ctxFor(alice, 2),
    );
    const pid = (prop.sideEffects as { proposalId: string }).proposalId;

    await vote.execute({ proposal_id: pid, stance: 'for' }, ctxFor(alice, 3));
    const votes = await store.getVotesForProposal(pid);
    expect(votes[0]?.weight).toBe(3);
  });

  it('refuses to vote on a decided proposal', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const propose = findTool(tools, 'propose');
    const vote = findTool(tools, 'vote');

    const form = await formGroup.execute(
      { name: 'G', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const gid = (form.sideEffects as { groupId: string }).groupId;
    const prop = await propose.execute(
      {
        target_group_id: gid,
        title: 't',
        rationale: 'r',
        effects: [{ kind: 'create_location', name: 'Q', description: '' }],
      },
      ctxFor(alice, 2),
    );
    const pid = (prop.sideEffects as { proposalId: string }).proposalId;
    await store.updateProposalStatus(pid, 'withdrawn', 3, 'test');

    const r = await vote.execute({ proposal_id: pid, stance: 'for' }, ctxFor(alice, 4));
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('proposal_withdrawn');
  });
});

describe('withdraw_proposal', () => {
  it('allows the sponsor to withdraw; not anyone else', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const joinGroup = findTool(tools, 'join_group');
    const propose = findTool(tools, 'propose');
    const withdraw = findTool(tools, 'withdraw_proposal');

    const form = await formGroup.execute(
      { name: 'G', description: '', procedure: 'vote' },
      ctxFor(alice),
    );
    const gid = (form.sideEffects as { groupId: string }).groupId;
    await joinGroup.execute({ group_id: gid }, ctxFor(bob));

    const prop = await propose.execute(
      {
        target_group_id: gid,
        title: 't',
        rationale: 'r',
        effects: [{ kind: 'create_location', name: 'Q', description: '' }],
      },
      ctxFor(alice, 2),
    );
    const pid = (prop.sideEffects as { proposalId: string }).proposalId;

    // Bob can't withdraw Alice's proposal.
    const rBob = await withdraw.execute({ proposal_id: pid }, ctxFor(bob, 3));
    expect(rBob.ok).toBe(false);
    expect(rBob.detail).toBe('not_sponsor');

    // Alice can.
    const rAlice = await withdraw.execute({ proposal_id: pid }, ctxFor(alice, 3));
    expect(rAlice.ok).toBe(true);
    const reloaded = await store.getProposal(pid);
    expect(reloaded?.status).toBe('withdrawn');
  });
});

describe('end-to-end: propose → vote → settle → effect lands', () => {
  it('creates a new location via the governance pathway', async () => {
    const tools = compileWorldTools(world, alice, store, []);
    const formGroup = findTool(tools, 'form_group');
    const joinGroup = findTool(tools, 'join_group');
    const propose = findTool(tools, 'propose');
    const vote = findTool(tools, 'vote');

    const form = await formGroup.execute(
      { name: 'Council', description: '', procedure: 'vote' },
      ctxFor(alice, 1),
    );
    const gid = (form.sideEffects as { groupId: string }).groupId;
    await joinGroup.execute({ group_id: gid }, ctxFor(bob, 1));

    const prop = await propose.execute(
      {
        target_group_id: gid,
        title: 'Found Avalon',
        rationale: 'east of the harbor',
        effects: [{ kind: 'create_location', name: 'Avalon', description: 'new outpost' }],
        deadline: { kind: 'all_voted' },
      },
      ctxFor(alice, 2),
    );
    const pid = (prop.sideEffects as { proposalId: string }).proposalId;

    await vote.execute({ proposal_id: pid, stance: 'for' }, ctxFor(alice, 3));
    await vote.execute({ proposal_id: pid, stance: 'for' }, ctxFor(bob, 3));

    // Settle via the service directly (Engine would do this at tick end).
    const svc = new ProposalService(store, new EventBus());
    const results = await svc.settlePending(world, 3);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('adopted');

    const locs = await store.getLocationsForWorld(world.id);
    expect(locs.some((l) => l.name === 'Avalon')).toBe(true);
  });
});
