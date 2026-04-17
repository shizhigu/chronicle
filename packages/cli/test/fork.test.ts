/**
 * `chronicle fork` — clones a world under a new id.
 *
 * Regression-level tests: verify the forked world is structurally
 * distinct (new ids), carries forkFromTick + createdByChronicle,
 * preserves core entities (agents, locations, governance), and
 * filters events to the fork point.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, groupId, locationId, worldId } from '@chronicle/core';
import type { Agent, Group, Location, World } from '@chronicle/core';
import { WorldStore } from '@chronicle/engine';
import { forkCommand } from '../src/commands/fork.js';
import { paths } from '../src/paths.js';

let tmpHome: string;
let store: WorldStore;
let world: World;
let alice: Agent;
let hall: Location;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'Source',
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
    currentTick: 10,
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
function makeAgent(wId: string, locId: string): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name: 'Alice',
    persona: 'p',
    traits: {},
    privateState: null,
    alive: true,
    locationId: locId,
    mood: 'calm',
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
function makeLocation(wId: string): Location {
  return {
    id: locationId(),
    worldId: wId,
    name: 'Hall',
    description: '',
    x: null,
    y: null,
    parentId: null,
    affordances: [],
    metadata: {},
    spriteHint: null,
    createdAt: new Date().toISOString(),
  };
}
function makeCouncil(wId: string): Group {
  return {
    id: groupId(),
    worldId: wId,
    name: 'Council',
    description: '',
    procedureKind: 'vote',
    procedureConfig: {},
    joinPredicate: null,
    successionKind: null,
    visibilityPolicy: 'open',
    foundedTick: 1,
    dissolvedTick: null,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-fork-'));
  process.env.CHRONICLE_HOME = tmpHome;
  store = await WorldStore.open(paths.db);
  world = makeWorld();
  await store.createWorld(world);
  hall = makeLocation(world.id);
  await store.createLocation(hall);
  alice = makeAgent(world.id, hall.id);
  await store.createAgent(alice);

  // Seed a few events so the filter has something to do.
  for (let t = 1; t <= 10; t++) {
    await store.recordEvent({
      worldId: world.id,
      tick: t,
      eventType: 'action',
      actorId: alice.id,
      data: { action: 'think', args: { thought: `tick ${t}` } },
      tokenCost: 0,
    });
  }
});

afterEach(() => {
  store.close();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('chronicle fork', () => {
  it('requires --desc', async () => {
    await expect(forkCommand(world.id, {})).rejects.toThrow(/--desc is required/);
  });

  it('rejects --at-tick outside [0, currentTick]', async () => {
    await expect(forkCommand(world.id, { desc: 'test', atTick: '999' })).rejects.toThrow(
      /at-tick must be in/,
    );
  });

  it('clones the world with a fresh id + forkFromTick pinned + createdByChronicle linked', async () => {
    await forkCommand(world.id, { desc: 'what if Alice was hostile', atTick: '5' });

    const reopened = await WorldStore.open(paths.db);
    const worlds = await reopened.listWorlds();
    const forked = worlds.find((w) => w.id !== world.id);
    expect(forked).toBeDefined();
    const full = await reopened.loadWorld(forked!.id);
    expect(full.forkFromTick).toBe(5);
    expect(full.createdByChronicle).toBe(world.id);
    expect(full.currentTick).toBe(5);
    expect(full.status).toBe('paused');
    // Fresh seed — not the source's seed.
    expect(full.rngSeed).not.toBe(world.rngSeed);
    reopened.close();
  });

  it('filters events to the fork tick and remaps actor ids', async () => {
    await forkCommand(world.id, { desc: 'mid-run split', atTick: '5' });

    const reopened = await WorldStore.open(paths.db);
    const worlds = await reopened.listWorlds();
    const forked = worlds.find((w) => w.id !== world.id)!;
    const events = await reopened.getEventsInRange(forked.id, 0, 100);
    expect(events.every((e) => e.tick <= 5)).toBe(true);
    // Events from ticks 1..5 → 5 events.
    expect(events.length).toBe(5);
    // Actor id on the forked events must NOT match the source agent's id.
    for (const e of events) expect(e.actorId).not.toBe(alice.id);
    reopened.close();
  });

  it('carries governance state (groups + memberships) across the fork', async () => {
    const council = makeCouncil(world.id);
    await store.createGroup(council);
    await store.addMembership(council.id, alice.id, 1);

    await forkCommand(world.id, { desc: 'different council decision' });

    const reopened = await WorldStore.open(paths.db);
    const worlds = await reopened.listWorlds();
    const forked = worlds.find((w) => w.id !== world.id)!;
    const groups = await reopened.getGroupsForWorld(forked.id);
    expect(groups.map((g) => g.name)).toContain('Council');
    const members = await reopened.getActiveMembershipsForGroup(groups[0]!.id);
    // Alice's id is remapped — so the source alice.id should NOT appear.
    expect(members.some((m) => m.agentId === alice.id)).toBe(false);
    // But there should still be one member (the remapped Alice).
    expect(members).toHaveLength(1);
    reopened.close();
  });
});
