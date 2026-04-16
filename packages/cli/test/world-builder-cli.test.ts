/**
 * add-location / add-group / grant-authority — CLI command tests
 * (ADR-0011 § 3b continuation).
 *
 * Each block exercises happy + sad paths, effect-shape assertions,
 * and humanized error messages. We hit a real WorldStore and
 * inspect the queued god intervention's compiledEffects payload.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, locationId, worldId } from '@chronicle/core';
import type { Agent, Location, World } from '@chronicle/core';
import { GodService, WorldStore } from '@chronicle/engine';
import { addGroupCommand } from '../src/commands/add-group.js';
import { addLocationCommand } from '../src/commands/add-location.js';
import { grantAuthorityCommand } from '../src/commands/grant-authority.js';
import { paths } from '../src/paths.js';

let tmpHome: string;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'Builder',
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
    currentTick: 2,
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

let worldRef: World;
let alice: Agent;
let bob: Agent;
let harbor: Location;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-builder-'));
  process.env.CHRONICLE_HOME = tmpHome;
  const store = await WorldStore.open(paths.db);
  worldRef = makeWorld();
  await store.createWorld(worldRef);

  alice = makeAgent(worldRef.id, 'Alice');
  bob = makeAgent(worldRef.id, 'Bob');
  await store.createAgent(alice);
  await store.createAgent(bob);

  harbor = makeLocation(worldRef.id, 'Harbor');
  await store.createLocation(harbor);

  store.close();
});
afterEach(() => rmSync(tmpHome, { recursive: true, force: true }));

describe('add-location', () => {
  it('queues a create_location effect with adjacency', async () => {
    await addLocationCommand(worldRef.id, {
      name: 'Avalon',
      description: 'a colony east of the Harbor',
      adjacent: 'Harbor',
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 3);
    expect(queued).toHaveLength(1);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]).toMatchObject({
      kind: 'create_location',
      name: 'Avalon',
      adjacentTo: ['Harbor'],
    });
    store.close();
  });

  it('humanizes duplicate-name error', async () => {
    await expect(
      addLocationCommand(worldRef.id, { name: 'harbor', description: 'dup' }),
    ).rejects.toThrow(/already exists.*case-insensitive/s);
  });

  it('humanizes missing-adjacent error with a dashboard hint', async () => {
    await expect(
      addLocationCommand(worldRef.id, {
        name: 'Ghost Town',
        description: 'nowhere',
        adjacent: 'Nowhere',
      }),
    ).rejects.toThrow(/does not exist.*dashboard/s);
  });

  it('splits comma-separated --adjacent and trims whitespace', async () => {
    // Seed a second adjacent peer.
    const store = await WorldStore.open(paths.db);
    await store.createLocation(makeLocation(worldRef.id, 'Market'));
    store.close();

    await addLocationCommand(worldRef.id, {
      name: 'Plaza',
      description: '',
      adjacent: ' Harbor , Market ',
    });
    const check = await WorldStore.open(paths.db);
    const god = new GodService(check);
    const queued = await god.getQueuedFor(worldRef.id, 3);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]?.adjacentTo).toEqual(['Harbor', 'Market']);
    check.close();
  });
});

describe('add-group', () => {
  it('queues a create_group effect with name-resolved members', async () => {
    await addGroupCommand(worldRef.id, {
      name: 'Council',
      description: 'the council',
      procedure: 'vote',
      members: 'Alice, Bob',
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 3);
    expect(queued).toHaveLength(1);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]).toMatchObject({
      kind: 'create_group',
      name: 'Council',
      procedure: 'vote',
      initialMembers: [alice.id, bob.id],
    });
    store.close();
  });

  it('accepts ids in --members as well', async () => {
    await addGroupCommand(worldRef.id, {
      name: 'IDs',
      description: '',
      procedure: 'vote',
      members: `${alice.id},${bob.id}`,
    });
    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 3);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]?.initialMembers).toEqual([alice.id, bob.id]);
    store.close();
  });

  it('errors on ambiguous member name (two Carols)', async () => {
    const store = await WorldStore.open(paths.db);
    await store.createAgent(makeAgent(worldRef.id, 'Carol'));
    await store.createAgent(makeAgent(worldRef.id, 'Carol'));
    store.close();

    await expect(
      addGroupCommand(worldRef.id, {
        name: 'Amb',
        description: '',
        procedure: 'vote',
        members: 'Carol',
      }),
    ).rejects.toThrow(/ambiguous member/);
  });

  it('errors on unknown member name', async () => {
    await expect(
      addGroupCommand(worldRef.id, {
        name: 'Nope',
        description: '',
        procedure: 'vote',
        members: 'Zephyr',
      }),
    ).rejects.toThrow(/no agent "Zephyr"/);
  });

  it('rejects a bad --procedure value', async () => {
    await expect(
      addGroupCommand(worldRef.id, {
        name: 'Bad',
        description: '',
        procedure: 'anarchy',
      }),
    ).rejects.toThrow(/--procedure must be one of/);
  });

  it('accepts --procedure-config JSON and forwards it', async () => {
    await addGroupCommand(worldRef.id, {
      name: 'Weighted',
      description: '',
      procedure: 'vote',
      procedureConfig: '{"threshold":0.66,"quorum":0.75}',
    });
    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 3);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]?.procedureConfig).toEqual({ threshold: 0.66, quorum: 0.75 });
    store.close();
  });

  it('rejects malformed --procedure-config JSON with a readable error', async () => {
    await expect(
      addGroupCommand(worldRef.id, {
        name: 'Bad',
        description: '',
        procedure: 'vote',
        procedureConfig: '{not-json}',
      }),
    ).rejects.toThrow(/--procedure-config is not a valid JSON/);
  });
});

describe('grant-authority', () => {
  it('queues a grant_authority effect for an agent holder', async () => {
    await grantAuthorityCommand(worldRef.id, {
      toKind: 'agent',
      toRef: alice.id,
      powers: JSON.stringify([{ kind: 'override_rule', ruleId: 'rul_x' }]),
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 3);
    expect(queued).toHaveLength(1);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]).toMatchObject({
      kind: 'grant_authority',
      holderKind: 'agent',
      holderRef: alice.id,
      powers: [{ kind: 'override_rule', ruleId: 'rul_x' }],
    });
    store.close();
  });

  it('honors --expires-tick', async () => {
    await grantAuthorityCommand(worldRef.id, {
      toKind: 'agent',
      toRef: alice.id,
      powers: JSON.stringify([{ kind: 'override_rule', ruleId: 'rul_y' }]),
      expiresTick: '50',
    });
    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 3);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]?.expiresTick).toBe(50);
    store.close();
  });

  it('rejects bad --to-kind', async () => {
    await expect(
      grantAuthorityCommand(worldRef.id, {
        toKind: 'wizard',
        toRef: 'x',
        powers: '[]',
      }),
    ).rejects.toThrow(/--to-kind must be one of/);
  });

  it('rejects empty --powers array', async () => {
    await expect(
      grantAuthorityCommand(worldRef.id, {
        toKind: 'agent',
        toRef: alice.id,
        powers: '[]',
      }),
    ).rejects.toThrow(/non-empty JSON array/);
  });

  it('humanizes bad_holder error', async () => {
    await expect(
      grantAuthorityCommand(worldRef.id, {
        toKind: 'agent',
        toRef: 'agt_ghost',
        powers: JSON.stringify([{ kind: 'override_rule', ruleId: 'rul_x' }]),
      }),
    ).rejects.toThrow(/is not an entity in this world/);
  });

  it('rejects malformed override_rule power missing ruleId', async () => {
    await expect(
      grantAuthorityCommand(worldRef.id, {
        toKind: 'agent',
        toRef: alice.id,
        // Intentionally drop ruleId to exercise the per-power shape check.
        powers: JSON.stringify([{ kind: 'override_rule' }]),
      }),
    ).rejects.toThrow(/malformed_power\[0\]:override_rule_requires_ruleId/);
  });

  it('rejects malformed propose power missing effectTypes', async () => {
    await expect(
      grantAuthorityCommand(worldRef.id, {
        toKind: 'agent',
        toRef: alice.id,
        powers: JSON.stringify([{ kind: 'propose' }]),
      }),
    ).rejects.toThrow(/malformed_power\[0\]:propose_requires_effectTypes/);
  });

  it('rejects unknown power kind', async () => {
    await expect(
      grantAuthorityCommand(worldRef.id, {
        toKind: 'agent',
        toRef: alice.id,
        powers: JSON.stringify([{ kind: 'godlike' }]),
      }),
    ).rejects.toThrow(/unknown_power_kind:godlike/);
  });
});
