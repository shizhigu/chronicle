/**
 * list-groups / list-locations / list-agents — read-only CLI tests.
 *
 * Capture console.log and assert on the formatted output. --json mode
 * is easier to assert structurally; plain mode we just sanity-check
 * that identifying substrings appear.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, groupId, locationId, worldId } from '@chronicle/core';
import type { Agent, Group, Location, World } from '@chronicle/core';
import { WorldStore } from '@chronicle/engine';
import { listAgentsCommand } from '../src/commands/list-agents.js';
import { listGroupsCommand } from '../src/commands/list-groups.js';
import { listLocationsCommand } from '../src/commands/list-locations.js';
import { paths } from '../src/paths.js';

let tmpHome: string;
let captured: string[];
let originalLog: typeof console.log;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'ListTest',
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
      dramaCatalystEnabled: false,
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
function makeAgent(wId: string, name: string, locId: string | null, alive = true): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name,
    persona: '',
    traits: {},
    privateState: null,
    alive,
    locationId: locId,
    mood: 'calm',
    energy: 80,
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
    deathTick: alive ? null : 3,
    parentIds: null,
    createdAt: new Date().toISOString(),
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
function makeGroup(wId: string, name: string, procedure: Group['procedureKind'] = 'vote'): Group {
  return {
    id: groupId(),
    worldId: wId,
    name,
    description: '',
    procedureKind: procedure,
    procedureConfig: {},
    joinPredicate: null,
    successionKind: null,
    visibilityPolicy: 'open',
    foundedTick: 0,
    dissolvedTick: null,
    createdAt: new Date().toISOString(),
  };
}

let worldRef: World;
let alice: Agent;
let bob: Agent;
let harbor: Location;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-list-cli-'));
  process.env.CHRONICLE_HOME = tmpHome;
  const store = await WorldStore.open(paths.db);
  worldRef = makeWorld();
  await store.createWorld(worldRef);

  harbor = makeLocation(worldRef.id, 'Harbor');
  const market = makeLocation(worldRef.id, 'Market');
  await store.createLocation(harbor);
  await store.createLocation(market);
  await store.addAdjacency(harbor.id, market.id, 1, true);

  alice = makeAgent(worldRef.id, 'Alice', harbor.id);
  bob = makeAgent(worldRef.id, 'Bob', market.id);
  await store.createAgent(alice);
  await store.createAgent(bob);

  store.close();

  captured = [];
  originalLog = console.log;
  console.log = (msg?: unknown) => captured.push(String(msg ?? ''));
});

afterEach(() => {
  console.log = originalLog;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('list-groups', () => {
  it('prints "no groups" on an empty world', async () => {
    await listGroupsCommand(worldRef.id, {});
    expect(captured.some((l) => l.includes('no groups'))).toBe(true);
  });

  it('prints a table row per group with member/role counts', async () => {
    const store = await WorldStore.open(paths.db);
    const council = makeGroup(worldRef.id, 'Council');
    await store.createGroup(council);
    await store.addMembership(council.id, alice.id, 0);
    await store.addMembership(council.id, bob.id, 0);
    await store.upsertGroupRole({
      groupId: council.id,
      roleName: 'chair',
      holderAgentId: alice.id,
      assignedTick: 0,
      votingWeight: 1,
      scopeRef: null,
    });
    store.close();

    await listGroupsCommand(worldRef.id, {});
    const joined = captured.join('\n');
    expect(joined).toContain('Council');
    expect(joined).toMatch(/NAME\s+PROC\s+VIS\s+MEMBERS\s+ROLES/);
    // Member + role counts are on the data row.
    const dataRow = captured.find((l) => l.includes('Council'))!;
    expect(dataRow).toMatch(/\b2\b/); // 2 members
    expect(dataRow).toMatch(/\b1\b/); // 1 role
  });

  it('hides dissolved groups by default; --include-dissolved shows them', async () => {
    const store = await WorldStore.open(paths.db);
    const gone = makeGroup(worldRef.id, 'Retired');
    await store.createGroup(gone);
    await store.dissolveGroup(gone.id, 3);
    store.close();

    await listGroupsCommand(worldRef.id, {});
    expect(captured.join('\n')).not.toContain('Retired');

    captured = [];
    await listGroupsCommand(worldRef.id, { includeDissolved: true });
    const joined = captured.join('\n');
    expect(joined).toContain('Retired');
    expect(joined).toContain('dissolved@3');
  });

  it('emits JSON in --json mode', async () => {
    const store = await WorldStore.open(paths.db);
    const g = makeGroup(worldRef.id, 'J');
    await store.createGroup(g);
    store.close();

    await listGroupsCommand(worldRef.id, { json: true });
    const parsed = JSON.parse(captured.join('\n')) as Array<{
      id: string;
      name: string;
      procedure: string;
    }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe('J');
    expect(parsed[0]?.procedure).toBe('vote');
  });
});

describe('list-locations', () => {
  it('renders adjacency by name in plain mode', async () => {
    await listLocationsCommand(worldRef.id, {});
    const joined = captured.join('\n');
    expect(joined).toContain('Harbor');
    expect(joined).toContain('Market');
    // Adjacency column — each side should reference the other.
    const harborRow = captured.find((l) => l.includes('Harbor'))!;
    expect(harborRow).toContain('Market');
    const marketRow = captured.find((l) => l.includes('Market'))!;
    expect(marketRow).toContain('Harbor');
  });

  it('emits ids (not names) for adjacency in --json mode', async () => {
    await listLocationsCommand(worldRef.id, { json: true });
    const parsed = JSON.parse(captured.join('\n')) as Array<{
      id: string;
      name: string;
      description: string;
      adjacentIds: string[];
    }>;
    const h = parsed.find((p) => p.name === 'Harbor')!;
    expect(h.adjacentIds).toEqual(expect.arrayContaining([expect.stringMatching(/^loc_/)]));
    // --json path is the programmatic CC contract: shape should be
    // exactly {id, name, description, adjacentIds} — no name-resolved
    // adjacency slipping in via future refactors.
    for (const row of parsed) {
      expect(Object.keys(row).sort()).toEqual(['adjacentIds', 'description', 'id', 'name'].sort());
    }
  });

  it('prints "(isolated)" for a location with no neighbours', async () => {
    const store = await WorldStore.open(paths.db);
    await store.createLocation(makeLocation(worldRef.id, 'Attic'));
    store.close();

    await listLocationsCommand(worldRef.id, {});
    const row = captured.find((l) => l.includes('Attic'))!;
    expect(row).toContain('(isolated)');
  });
});

describe('list-agents', () => {
  it('prints agents with resolved location names', async () => {
    await listAgentsCommand(worldRef.id, {});
    const joined = captured.join('\n');
    expect(joined).toContain('Alice');
    expect(joined).toContain('Bob');
    const aliceRow = captured.find((l) => l.includes('Alice'))!;
    expect(aliceRow).toContain('Harbor'); // location resolved to name
  });

  it('excludes dead agents by default; --include-dead surfaces them', async () => {
    const store = await WorldStore.open(paths.db);
    const ghost = makeAgent(worldRef.id, 'Ghost', null, false /* dead */);
    await store.createAgent(ghost);
    store.close();

    await listAgentsCommand(worldRef.id, {});
    expect(captured.join('\n')).not.toContain('Ghost');

    captured = [];
    await listAgentsCommand(worldRef.id, { includeDead: true });
    const joined = captured.join('\n');
    expect(joined).toContain('Ghost');
    expect(joined).toContain('dead@3');
  });

  it('emits JSON array in --json mode', async () => {
    await listAgentsCommand(worldRef.id, { json: true });
    const parsed = JSON.parse(captured.join('\n')) as Array<{
      name: string;
      location: string;
      alive: boolean;
    }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
    expect(parsed.every((p) => p.alive)).toBe(true);
  });

  it('shows "(unplaced)" for an agent with no locationId', async () => {
    const store = await WorldStore.open(paths.db);
    const wanderer = makeAgent(worldRef.id, 'Wanderer', null);
    await store.createAgent(wanderer);
    store.close();

    await listAgentsCommand(worldRef.id, {});
    const row = captured.find((l) => l.includes('Wanderer'))!;
    expect(row).toContain('(unplaced)');
  });

  it('--json --include-dead surfaces dead agents with correct shape', async () => {
    // Lock the JSON contract so the (formerly raw-SQL) dead-agent path
    // can't silently drop fields as the schema evolves.
    const store = await WorldStore.open(paths.db);
    const ghost = makeAgent(worldRef.id, 'Ghost', null, false);
    await store.createAgent(ghost);
    store.close();

    await listAgentsCommand(worldRef.id, { json: true, includeDead: true });
    const parsed = JSON.parse(captured.join('\n')) as Array<{
      id: string;
      name: string;
      location: string;
      mood: string;
      energy: number;
      health: number;
      alive: boolean;
      deathTick: number | null;
    }>;
    const dead = parsed.find((p) => p.name === 'Ghost')!;
    expect(dead).toBeDefined();
    expect(dead.alive).toBe(false);
    expect(dead.deathTick).toBe(3);
    expect(dead.location).toBe('(unplaced)');
    // Every live+dead agent should expose the full row contract.
    for (const row of parsed) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.mood).toBe('string');
      expect(typeof row.energy).toBe('number');
      expect(typeof row.health).toBe('number');
    }
    // Live agents should still be present alongside the dead one.
    expect(parsed.map((p) => p.name).sort()).toEqual(['Alice', 'Bob', 'Ghost']);
  });
});
