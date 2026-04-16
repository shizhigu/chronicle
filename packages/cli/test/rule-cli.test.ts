/**
 * add-rule / remove-rule / list-rules — CLI command tests (ADR-0011 § 3b).
 *
 * Drives the handlers against an in-memory world and asserts:
 *   - add-rule validates tier + tier-specific flags, queues the
 *     create_rule effect with the right shape
 *   - remove-rule queues repeal_rule, fails cleanly on bad ruleId /
 *     inviolable rule
 *   - list-rules prints expected output in both --json and plain modes
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, ruleId, worldId } from '@chronicle/core';
import type { Agent, Rule, World } from '@chronicle/core';
import { GodService, INVIOLABLE_MARKER, WorldStore } from '@chronicle/engine';
import { addRuleCommand } from '../src/commands/add-rule.js';
import { listRulesCommand } from '../src/commands/list-rules.js';
import { removeRuleCommand } from '../src/commands/remove-rule.js';
import { paths } from '../src/paths.js';

let tmpHome: string;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'RuleTest',
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
    currentTick: 3,
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

let worldRef: World;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-rule-cli-'));
  process.env.CHRONICLE_HOME = tmpHome;
  const store = await WorldStore.open(paths.db);
  worldRef = makeWorld();
  await store.createWorld(worldRef);
  await store.createAgent(makeAgent(worldRef.id, 'Alice'));
  store.close();
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('add-rule', () => {
  it('queues a hard rule with a check', async () => {
    await addRuleCommand(worldRef.id, {
      description: 'no theft',
      tier: 'hard',
      check: "action.name != 'take'",
      onViolation: 'reject',
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 4);
    expect(queued).toHaveLength(1);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]).toMatchObject({
      kind: 'create_rule',
      tier: 'hard',
      description: 'no theft',
      check: "action.name != 'take'",
      onViolation: 'reject',
    });
    store.close();
  });

  it('rejects hard tier without a --check', async () => {
    await expect(addRuleCommand(worldRef.id, { description: 'x', tier: 'hard' })).rejects.toThrow(
      /--check is required/,
    );
  });

  it('queues a soft rule carrying softNormText', async () => {
    await addRuleCommand(worldRef.id, {
      description: 'do not interrupt',
      tier: 'soft',
      softNorm: 'Wait your turn before speaking.',
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 4);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]).toMatchObject({
      kind: 'create_rule',
      tier: 'soft',
      softNormText: 'Wait your turn before speaking.',
    });
    store.close();
  });

  it('queues an economic rule', async () => {
    await addRuleCommand(worldRef.id, {
      description: 'speaking costs energy',
      tier: 'economic',
      economicActionType: 'speak',
      economicCostFormula: 'energy=2',
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 4);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]).toMatchObject({
      kind: 'create_rule',
      tier: 'economic',
      economicActionType: 'speak',
      economicCostFormula: 'energy=2',
    });
    store.close();
  });

  it('rejects an unknown --tier value', async () => {
    await expect(
      addRuleCommand(worldRef.id, { description: 'x', tier: 'chaotic' }),
    ).rejects.toThrow(/--tier must be one of/);
  });

  it('honors --scope-kind + --scope-ref', async () => {
    await addRuleCommand(worldRef.id, {
      description: 'council-only rule',
      tier: 'hard',
      check: 'true',
      scopeKind: 'group',
      scopeRef: 'grp_council',
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 4);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]).toMatchObject({
      scopeKind: 'group',
      scopeRef: 'grp_council',
    });
    store.close();
  });

  it('requires --scope-ref when scope-kind != world', async () => {
    await expect(
      addRuleCommand(worldRef.id, {
        description: 'x',
        tier: 'hard',
        check: 'true',
        scopeKind: 'group',
      }),
    ).rejects.toThrow(/--scope-ref is required/);
  });
});

describe('remove-rule', () => {
  it('queues a repeal_rule effect for an existing rule', async () => {
    // Seed a rule we can remove.
    const rid = ruleId();
    const store = await WorldStore.open(paths.db);
    await store.createRule({
      id: rid,
      worldId: worldRef.id,
      description: 'silly',
      tier: 'hard',
      hardCheck: 'true',
      hardOnViolation: 'reject',
      active: true,
      priority: 100,
      scopeKind: 'world',
      scopeRef: null,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: null,
    });
    store.close();

    await removeRuleCommand(worldRef.id, rid, {});

    const check = await WorldStore.open(paths.db);
    const god = new GodService(check);
    const queued = await god.getQueuedFor(worldRef.id, 4);
    expect(queued).toHaveLength(1);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<
      Record<string, unknown>
    >;
    expect(effects[0]).toEqual({ kind: 'repeal_rule', ruleId: rid });
    check.close();
  });

  it('fails for an unknown ruleId with a humanized message + list-rules hint', async () => {
    await expect(removeRuleCommand(worldRef.id, 'rul_nope', {})).rejects.toThrow(
      /no rule with id "rul_nope".*list-rules/s,
    );
  });

  it('refuses to repeal an inviolable rule', async () => {
    const rid = ruleId();
    const store = await WorldStore.open(paths.db);
    await store.createRule({
      id: rid,
      worldId: worldRef.id,
      description: 'no killing',
      tier: 'hard',
      hardCheck: 'true',
      hardOnViolation: 'reject',
      active: true,
      priority: 100,
      scopeKind: 'world',
      scopeRef: null,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: `seed:${INVIOLABLE_MARKER}`,
    });
    store.close();

    await expect(removeRuleCommand(worldRef.id, rid, {})).rejects.toThrow(
      /marked inviolable and cannot be repealed/,
    );
  });
});

describe('list-rules', () => {
  let captured: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    captured = [];
    originalLog = console.log;
    console.log = (msg?: unknown) => captured.push(String(msg ?? ''));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('prints "no active rules" when the world has none', async () => {
    await listRulesCommand(worldRef.id, {});
    expect(captured.some((l) => l.includes('no active rules'))).toBe(true);
  });

  it('prints a row per active rule in plain mode', async () => {
    const store = await WorldStore.open(paths.db);
    for (const [desc, tier] of [
      ['no theft', 'hard'],
      ['no insult', 'soft'],
    ] as const) {
      await store.createRule({
        id: ruleId(),
        worldId: worldRef.id,
        description: desc,
        tier,
        hardCheck: tier === 'hard' ? 'true' : undefined,
        hardOnViolation: tier === 'hard' ? 'reject' : undefined,
        active: true,
        priority: 100,
        scopeKind: 'world',
        scopeRef: null,
        createdAt: new Date().toISOString(),
        createdByTick: null,
        compilerNotes: null,
      } as Rule);
    }
    store.close();

    await listRulesCommand(worldRef.id, {});
    const joined = captured.join('\n');
    expect(joined).toContain('no theft');
    expect(joined).toContain('no insult');
    expect(joined).toMatch(/ID\s+TIER\s+SCOPE\s+DESCRIPTION/);
  });

  it('emits JSON array in --json mode', async () => {
    const store = await WorldStore.open(paths.db);
    await store.createRule({
      id: ruleId(),
      worldId: worldRef.id,
      description: 'visible',
      tier: 'hard',
      hardCheck: 'true',
      hardOnViolation: 'reject',
      active: true,
      priority: 100,
      scopeKind: 'world',
      scopeRef: null,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: null,
    } as Rule);
    store.close();

    await listRulesCommand(worldRef.id, { json: true });
    const joined = captured.join('\n');
    const parsed = JSON.parse(joined) as Array<{ description: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.description).toBe('visible');
  });
});
