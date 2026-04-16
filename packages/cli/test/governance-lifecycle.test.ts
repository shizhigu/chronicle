/**
 * dissolve-group / add-member / remove-member — CLI tests.
 *
 * Each command queues a god intervention; we validate by inspecting
 * the queued intervention's effects (via store) and reasserting
 * behaviour in both the happy path and the typed-error paths (wrong
 * name, ambiguous name, already-member, not-member, etc.).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, groupId, locationId, worldId } from '@chronicle/core';
import type { Agent, Group, Location, World } from '@chronicle/core';
import { WorldStore } from '@chronicle/engine';
import { addMemberCommand } from '../src/commands/add-member.js';
import { dissolveGroupCommand } from '../src/commands/dissolve-group.js';
import { removeMemberCommand } from '../src/commands/remove-member.js';
import { paths } from '../src/paths.js';

let tmpHome: string;
let captured: string[];
let originalLog: typeof console.log;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'LifecycleTest',
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
function makeAgent(wId: string, name: string, alive = true): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name,
    persona: '',
    traits: {},
    privateState: null,
    alive,
    locationId: null,
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
    deathTick: alive ? null : 5,
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

let world: World;
let council: Group;
let alice: Agent;
let bob: Agent;
let carol: Agent;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-gov-cli-'));
  process.env.CHRONICLE_HOME = tmpHome;
  const store = await WorldStore.open(paths.db);
  world = makeWorld();
  await store.createWorld(world);
  // Every test exercises a group; build one pre-populated with Alice.
  await store.createLocation(makeLocation(world.id, 'Agora'));
  alice = makeAgent(world.id, 'Alice');
  bob = makeAgent(world.id, 'Bob');
  carol = makeAgent(world.id, 'Carol');
  await store.createAgent(alice);
  await store.createAgent(bob);
  await store.createAgent(carol);
  council = makeGroup(world.id, 'Council');
  await store.createGroup(council);
  await store.addMembership(council.id, alice.id, 0);
  store.close();

  captured = [];
  originalLog = console.log;
  console.log = (msg?: unknown) => captured.push(String(msg ?? ''));
});

afterEach(() => {
  console.log = originalLog;
  rmSync(tmpHome, { recursive: true, force: true });
});

async function pendingEffectKinds(wid: string): Promise<string[]> {
  // Interventions queue at currentTick+1; introspect the store to
  // confirm the right effect kind was recorded. Layer-2 effects are
  // stored under `compiledEffects.effects` (see GodService).
  const store = await WorldStore.open(paths.db);
  try {
    const pending = await store.getPendingInterventions(wid, world.currentTick + 1);
    return pending.flatMap((i) => {
      const bag = i.compiledEffects as { effects?: Array<{ kind: string }> } | null;
      return bag?.effects?.map((e) => e.kind) ?? [];
    });
  } finally {
    store.close();
  }
}

describe('dissolve-group', () => {
  it('queues a dissolve_group effect by group name', async () => {
    await dissolveGroupCommand(world.id, 'Council', {});
    const kinds = await pendingEffectKinds(world.id);
    expect(kinds).toContain('dissolve_group');
    expect(captured.join('\n')).toContain('will dissolve at tick 8');
  });

  it('resolves by id as well as name', async () => {
    await dissolveGroupCommand(world.id, council.id, {});
    const kinds = await pendingEffectKinds(world.id);
    expect(kinds).toContain('dissolve_group');
  });

  it('refuses if the group is already dissolved', async () => {
    const store = await WorldStore.open(paths.db);
    await store.dissolveGroup(council.id, 2);
    store.close();
    await expect(dissolveGroupCommand(world.id, 'Council', {})).rejects.toThrow(
      /already dissolved at tick 2/,
    );
  });

  it('errors on unknown group name', async () => {
    await expect(dissolveGroupCommand(world.id, 'Phantom', {})).rejects.toThrow(
      /no group "Phantom"/,
    );
  });
});

describe('add-member', () => {
  it('queues add_member for a non-member (by name)', async () => {
    await addMemberCommand(world.id, 'Council', 'Bob', {});
    const kinds = await pendingEffectKinds(world.id);
    expect(kinds).toContain('add_member');
    expect(captured.join('\n')).toContain('Bob will join group "Council"');
  });

  it('errors with typed message if agent is already a member', async () => {
    // Alice is pre-seeded as a member in beforeEach.
    await expect(addMemberCommand(world.id, 'Council', 'Alice', {})).rejects.toThrow(
      /Alice is already an active member of "Council"/,
    );
  });

  it('errors with typed message if the group has been dissolved', async () => {
    const store = await WorldStore.open(paths.db);
    await store.dissolveGroup(council.id, 2);
    store.close();
    await expect(addMemberCommand(world.id, 'Council', 'Bob', {})).rejects.toThrow(
      /group "Council" has been dissolved/,
    );
  });

  it('errors on unknown agent', async () => {
    await expect(addMemberCommand(world.id, 'Council', 'Nobody', {})).rejects.toThrow(
      /no agent "Nobody"/,
    );
  });

  it('detects ambiguous agent names', async () => {
    const store = await WorldStore.open(paths.db);
    await store.createAgent(makeAgent(world.id, 'Bob')); // second "Bob"
    store.close();
    await expect(addMemberCommand(world.id, 'Council', 'Bob', {})).rejects.toThrow(
      /ambiguous agent — 2 agents named "Bob"/,
    );
  });
});

describe('remove-member', () => {
  it('queues remove_member for an active member', async () => {
    await removeMemberCommand(world.id, 'Council', 'Alice', {});
    const kinds = await pendingEffectKinds(world.id);
    expect(kinds).toContain('remove_member');
    expect(captured.join('\n')).toContain('Alice will leave group "Council"');
  });

  it('errors with typed message if agent was never a member', async () => {
    await expect(removeMemberCommand(world.id, 'Council', 'Bob', {})).rejects.toThrow(
      /Bob is not an active member of "Council"/,
    );
  });

  it('can remove a dead member (cleanup)', async () => {
    // Dead agents can still hold stale memberships until explicitly cleared.
    const store = await WorldStore.open(paths.db);
    const ghost = makeAgent(world.id, 'Ghost', false);
    await store.createAgent(ghost);
    await store.addMembership(council.id, ghost.id, 1);
    store.close();
    await removeMemberCommand(world.id, 'Council', 'Ghost', {});
    const kinds = await pendingEffectKinds(world.id);
    expect(kinds).toContain('remove_member');
  });

  it('errors on unknown group', async () => {
    await expect(removeMemberCommand(world.id, 'Phantom', 'Alice', {})).rejects.toThrow(
      /no group "Phantom"/,
    );
  });
});
