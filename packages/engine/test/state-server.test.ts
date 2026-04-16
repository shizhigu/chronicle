/**
 * WorldStateServer — integration test over a real HTTP fetch.
 * Uses a second Bun.serve instance and a seeded in-memory-ish store.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, locationId, worldId } from '@chronicle/core';
import type { Agent, Location, World } from '@chronicle/core';
import { WorldStateServer } from '../src/bridge/state-server.js';
import { WorldStore } from '../src/store.js';

const PORT = 39402;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'State Test',
    description: 'x',
    systemPrompt: '',
    config: {
      atmosphere: 'tense',
      atmosphereTag: 'parlor_drama',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'm',
      defaultProvider: 'anthropic',
      reflectionFrequency: 20,
      dramaCatalystEnabled: true,
    },
    currentTick: 7,
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

function makeLocation(wId: string, name: string): Location {
  return {
    id: locationId(),
    worldId: wId,
    name,
    description: `the ${name}`,
    x: null,
    y: null,
    parentId: null,
    affordances: [],
    metadata: {},
    spriteHint: null,
    createdAt: new Date().toISOString(),
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
    mood: 'calm',
    energy: 90,
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

let store: WorldStore;
let server: WorldStateServer;
let world: World;

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);

  const kitchen = makeLocation(world.id, 'kitchen');
  const garden = makeLocation(world.id, 'garden');
  await store.createLocation(kitchen);
  await store.createLocation(garden);

  await store.createAgent(makeAgent(world.id, 'Alice', kitchen.id));
  await store.createAgent(makeAgent(world.id, 'Bob', garden.id));

  server = new WorldStateServer(store, { port: PORT });
  server.start();
});

afterEach(() => {
  server.stop();
  store.close();
});

describe('WorldStateServer', () => {
  it('GET /api/worlds returns the world list', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Array<{ id: string; name: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.id).toBe(world.id);
  });

  it('GET /api/worlds/:id/state returns hydration payload', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/state`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      world: { id: string; atmosphereTag: string; currentTick: number };
      locations: Array<{ name: string }>;
      agents: Array<{ name: string; locationId: string | null }>;
    };

    expect(body.world.id).toBe(world.id);
    expect(body.world.atmosphereTag).toBe('parlor_drama');
    expect(body.world.currentTick).toBe(7);
    expect(body.locations.map((l) => l.name).sort()).toEqual(['garden', 'kitchen']);
    expect(body.agents.map((a) => a.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('GET /api/worlds/:id/events?since=N filters by tick', async () => {
    await store.recordEvent({
      worldId: world.id,
      tick: 5,
      eventType: 'action',
      data: { note: 'before' },
    });
    await store.recordEvent({
      worldId: world.id,
      tick: 8,
      eventType: 'action',
      data: { note: 'after' },
    });

    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/events?since=6`);
    expect(res.ok).toBe(true);
    const events = (await res.json()) as Array<{ tick: number; data: { note: string } }>;
    expect(events.length).toBe(1);
    expect(events[0]?.data.note).toBe('after');
  });

  it('GET /api/worlds/:id/politics returns the governance snapshot', async () => {
    // Seed the political layer: a Council, Alice + Bob members, Alice
    // as chair, an authority on the group, one pending proposal with
    // one vote cast.
    const { groupId, authorityId, proposalId } = await import('@chronicle/core');
    const agents = await store.getLiveAgents(world.id);
    const alice = agents.find((a) => a.name === 'Alice')!;
    const bob = agents.find((a) => a.name === 'Bob')!;

    const gid = groupId();
    await store.createGroup({
      id: gid,
      worldId: world.id,
      name: 'Council',
      description: 'the ruling council',
      procedureKind: 'vote',
      procedureConfig: { threshold: 0.5 },
      joinPredicate: null,
      successionKind: null,
      visibilityPolicy: 'open',
      foundedTick: 1,
      dissolvedTick: null,
      createdAt: new Date().toISOString(),
    });
    await store.addMembership(gid, alice.id, 1);
    await store.addMembership(gid, bob.id, 1);
    await store.upsertGroupRole({
      groupId: gid,
      roleName: 'chair',
      holderAgentId: alice.id,
      assignedTick: 1,
      votingWeight: 2,
      scopeRef: null,
    });

    const authId = authorityId();
    await store.grantAuthority({
      id: authId,
      worldId: world.id,
      holderKind: 'group',
      holderRef: gid,
      powers: [{ kind: 'override_rule', ruleId: 'rul_x' }],
      grantedTick: 2,
      expiresTick: null,
      sourceEventId: null,
      revokedTick: null,
      revocationEventId: null,
    });

    const pid = proposalId();
    await store.createProposal({
      id: pid,
      worldId: world.id,
      sponsorAgentId: alice.id,
      targetGroupId: gid,
      title: 'Build a new harbour',
      rationale: 'We need it',
      effects: [{ kind: 'create_location', name: 'Harbour', description: '' }],
      compiledEffects: null,
      openedTick: 5,
      deadline: { kind: 'tick', at: 15 },
      procedureOverride: null,
      status: 'pending',
      decidedTick: null,
      outcomeDetail: null,
    });
    await store.castVote({
      proposalId: pid,
      voterAgentId: alice.id,
      stance: 'for',
      weight: 2, // uses her chair's weighted vote
      castTick: 6,
      reasoning: null,
    });

    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/politics`);
    expect(res.ok).toBe(true);

    const body = (await res.json()) as {
      world: { id: string; currentTick: number };
      groups: Array<{
        id: string;
        name: string;
        procedureKind: string;
        memberIds: string[];
        roles: Array<{ roleName: string; holderAgentId: string | null; votingWeight: number }>;
      }>;
      authorities: Array<{ id: string; holderKind: string; holderRef: string }>;
      pendingProposals: Array<{
        id: string;
        title: string;
        tally: { for: number; against: number; abstain: number; totalWeight: number };
      }>;
    };

    expect(body.world.currentTick).toBe(7);
    expect(body.groups).toHaveLength(1);
    const council = body.groups[0]!;
    expect(council.name).toBe('Council');
    expect(council.procedureKind).toBe('vote');
    expect(council.memberIds.sort()).toEqual([alice.id, bob.id].sort());
    const chair = council.roles.find((r) => r.roleName === 'chair');
    expect(chair?.holderAgentId).toBe(alice.id);
    expect(chair?.votingWeight).toBe(2);

    expect(body.authorities).toHaveLength(1);
    expect(body.authorities[0]?.holderKind).toBe('group');
    expect(body.authorities[0]?.holderRef).toBe(gid);

    expect(body.pendingProposals).toHaveLength(1);
    const prop = body.pendingProposals[0]!;
    expect(prop.title).toBe('Build a new harbour');
    expect(prop.tally.for).toBe(2);
    expect(prop.tally.against).toBe(0);
    expect(prop.tally.totalWeight).toBe(2);
  });

  it('abstain tally is a WEIGHT sum, not a count — same scale as for/against', async () => {
    const { groupId, proposalId } = await import('@chronicle/core');
    const agents = await store.getLiveAgents(world.id);
    const alice = agents.find((a) => a.name === 'Alice')!;
    const bob = agents.find((a) => a.name === 'Bob')!;

    const gid = groupId();
    await store.createGroup({
      id: gid,
      worldId: world.id,
      name: 'Tally',
      description: '',
      procedureKind: 'vote',
      procedureConfig: {},
      joinPredicate: null,
      successionKind: null,
      visibilityPolicy: 'open',
      foundedTick: 0,
      dissolvedTick: null,
      createdAt: new Date().toISOString(),
    });
    await store.addMembership(gid, alice.id, 0);
    await store.addMembership(gid, bob.id, 0);

    const pid = proposalId();
    await store.createProposal({
      id: pid,
      worldId: world.id,
      sponsorAgentId: alice.id,
      targetGroupId: gid,
      title: 't',
      rationale: 'r',
      effects: [{ kind: 'create_location', name: 'L', description: '' }],
      compiledEffects: null,
      openedTick: 1,
      deadline: { kind: 'tick', at: 10 },
      procedureOverride: null,
      status: 'pending',
      decidedTick: null,
      outcomeDetail: null,
    });
    // Alice abstains with weight 3 (heavy hitter abstaining); bob votes for at 1.
    await store.castVote({
      proposalId: pid,
      voterAgentId: alice.id,
      stance: 'abstain',
      weight: 3,
      castTick: 2,
      reasoning: null,
    });
    await store.castVote({
      proposalId: pid,
      voterAgentId: bob.id,
      stance: 'for',
      weight: 1,
      castTick: 2,
      reasoning: null,
    });

    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/politics`);
    const body = (await res.json()) as {
      pendingProposals: Array<{
        tally: { for: number; against: number; abstain: number; totalWeight: number };
      }>;
    };
    const tally = body.pendingProposals[0]!.tally;
    expect(tally.abstain).toBe(3); // weight, not 1
    expect(tally.for).toBe(1);
    expect(tally.totalWeight).toBe(1); // decisive denominator — abstain excluded
  });

  it('opaque group proposals are hidden from the snapshot', async () => {
    const { groupId, proposalId } = await import('@chronicle/core');
    const agents = await store.getLiveAgents(world.id);
    const alice = agents.find((a) => a.name === 'Alice')!;

    const secretId = groupId();
    await store.createGroup({
      id: secretId,
      worldId: world.id,
      name: 'Shadow Cabinet',
      description: 'a secret cabal',
      procedureKind: 'vote',
      procedureConfig: {},
      joinPredicate: null,
      successionKind: null,
      visibilityPolicy: 'opaque',
      foundedTick: 0,
      dissolvedTick: null,
      createdAt: new Date().toISOString(),
    });
    await store.addMembership(secretId, alice.id, 0);

    const secretProp = proposalId();
    await store.createProposal({
      id: secretProp,
      worldId: world.id,
      sponsorAgentId: alice.id,
      targetGroupId: secretId,
      title: 'Plot against the crown',
      rationale: '...',
      effects: [{ kind: 'create_location', name: 'Hideout', description: '' }],
      compiledEffects: null,
      openedTick: 1,
      deadline: { kind: 'tick', at: 20 },
      procedureOverride: null,
      status: 'pending',
      decidedTick: null,
      outcomeDetail: null,
    });

    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/politics`);
    const body = (await res.json()) as {
      pendingProposals: Array<{ id: string; title: string }>;
    };
    // The conspiratorial proposal is not exposed.
    expect(body.pendingProposals.some((p) => p.id === secretProp)).toBe(false);
    expect(body.pendingProposals.some((p) => p.title.includes('Plot'))).toBe(false);
  });

  it('GET /api/worlds/:id/politics returns empty arrays when no political entities exist', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/politics`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      groups: unknown[];
      authorities: unknown[];
      pendingProposals: unknown[];
    };
    expect(body.groups).toEqual([]);
    expect(body.authorities).toEqual([]);
    expect(body.pendingProposals).toEqual([]);
  });

  it('returns 404 on unknown world', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds/chr_doesntexist/state`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  it('returns 404 on bad path', async () => {
    const res = await fetch(`http://localhost:${PORT}/bogus`);
    expect(res.status).toBe(404);
  });

  it('redacts API keys in persona strings on the /state endpoint', async () => {
    // Seed a character whose persona accidentally contains a key.
    // The `state` endpoint returns name + mood etc., not persona in
    // its current shape — but redaction is defensive and runs on
    // every outbound JSON body. We verify by inspecting the raw
    // response text for the raw secret.
    const { agentId: newAgentId } = await import('@chronicle/core');
    const leakedId = newAgentId();
    await store.createAgent({
      id: leakedId,
      worldId: world.id,
      name: 'Leaker',
      persona: 'I carry the key sk-ant-supersecretvalue12345xyz everywhere',
      traits: { boldness: 0.5, key: 'AKIAIOSFODNN7EXAMPLE' },
      privateState: { credential: 'ghp_gitbuttonkey1234567890' },
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
    });

    // State endpoint doesn't surface persona/traits/privateState, but
    // any path that accidentally returns them will be redacted.
    // Hit a path that DOES — /api/worlds/:id loads the world metadata
    // (no secrets expected), so use a direct curl-style path that
    // echoes back the full agent; since buildState only shows name +
    // mood etc., we simulate by hitting `/events` after recording an
    // event whose data contains the secret.
    await store.recordEvent({
      worldId: world.id,
      tick: 9,
      eventType: 'action',
      actorId: leakedId,
      data: { quoted: 'sk-ant-supersecretvalue12345xyz' },
    });

    const res = await fetch(`http://localhost:${PORT}/api/worlds/${world.id}/events?since=8`);
    const text = await res.text();
    expect(text).not.toContain('sk-ant-supersecretvalue12345xyz');
    // Prefix preserved (partial mask for debuggability).
    expect(text).toContain('sk-ant');
  });

  it('responds to CORS preflight', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/worlds`, {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });
});
