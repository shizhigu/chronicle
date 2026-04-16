/**
 * chronicle apply-effect / edit-character — mid-run edit CLI (ADR-0011).
 *
 * We drive the command handlers against an in-memory world and check
 * (a) the intervention is queued with the right compiledEffects
 * payload, (b) applyEffects validation rejects bad payloads before
 * queueing, (c) edit-character composes the expected update_agent
 * effect, and (d) end-to-end a queued edit actually mutates the
 * agent when the engine processes the intervention.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, worldId } from '@chronicle/core';
import type { Agent, World } from '@chronicle/core';
import { GodService, WorldStore } from '@chronicle/engine';
import { applyEffectCommand } from '../src/commands/apply-effect.js';
import { editCharacterCommand } from '../src/commands/edit-character.js';
import { paths } from '../src/paths.js';

let tmpHome: string;

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'EditTest',
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
function makeAgent(wId: string, name: string): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name,
    persona: 'original persona',
    traits: { boldness: 0.3 },
    privateState: null,
    alive: true,
    locationId: null,
    mood: 'neutral',
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
let carol: Agent;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-edit-'));
  process.env.CHRONICLE_HOME = tmpHome;
  const store = await WorldStore.open(paths.db);
  worldRef = makeWorld();
  await store.createWorld(worldRef);
  carol = makeAgent(worldRef.id, 'Carol');
  await store.createAgent(carol);
  store.close();
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('apply-effect', () => {
  it('queues a god intervention carrying the compiled effects', async () => {
    await applyEffectCommand(worldRef.id, {
      json: JSON.stringify({
        kind: 'update_agent',
        agentId: carol.id,
        mood: 'paranoid',
      }),
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    // Queue stores by applyAtTick; world.currentTick=5, default next=6.
    const queued = await god.getQueuedFor(worldRef.id, 6);
    expect(queued).toHaveLength(1);
    const iv = queued[0]!;
    expect(iv.compiledEffects).toEqual({
      effects: [{ kind: 'update_agent', agentId: carol.id, mood: 'paranoid' }],
    });
    store.close();
  });

  it('validates effects up-front — bad payload is rejected before queueing', async () => {
    await expect(
      applyEffectCommand(worldRef.id, {
        json: JSON.stringify({
          kind: 'update_agent',
          agentId: 'agt_nope',
          mood: 'x',
        }),
      }),
    ).rejects.toThrow(/no_agent/);

    // Nothing queued.
    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 6);
    expect(queued).toHaveLength(0);
    store.close();
  });

  it('accepts --json-array for batched effects', async () => {
    await applyEffectCommand(worldRef.id, {
      jsonArray: JSON.stringify([
        { kind: 'update_agent', agentId: carol.id, mood: 'paranoid' },
        { kind: 'update_agent', agentId: carol.id, traits: { cunning: 0.9 } },
      ]),
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 6);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects;
    expect(effects).toHaveLength(2);
    store.close();
  });

  it('refuses both --json and --json-array in one call', async () => {
    await expect(
      applyEffectCommand(worldRef.id, {
        json: '{"kind":"update_agent","agentId":"x","mood":"y"}',
        jsonArray: '[]',
      }),
    ).rejects.toThrow(/either --json OR --json-array/);
  });

  it('gives a readable error when --json is malformed (not raw SyntaxError)', async () => {
    await expect(applyEffectCommand(worldRef.id, { json: '{not: json}' })).rejects.toThrow(
      /--json is not valid JSON/,
    );
  });

  it('rejects an unknown effect kind cleanly (no TypeError)', async () => {
    await expect(
      applyEffectCommand(worldRef.id, {
        json: JSON.stringify({ kind: 'remove_location', id: 'loc_nope' }),
      }),
    ).rejects.toThrow(/unknown_effect_kind/);
  });
});

describe('edit-character', () => {
  it('looks up by name and queues an update_agent effect', async () => {
    await editCharacterCommand(worldRef.id, 'Carol', {
      mood: 'paranoid',
      persona: 'Carol has turned.',
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 6);
    expect(queued).toHaveLength(1);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects;
    expect(effects).toEqual([
      {
        kind: 'update_agent',
        agentId: carol.id,
        persona: 'Carol has turned.',
        mood: 'paranoid',
      },
    ]);
    store.close();
  });

  it('accepts id as well as name', async () => {
    await editCharacterCommand(worldRef.id, carol.id, { mood: 'anxious' });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 6);
    expect(queued).toHaveLength(1);
    store.close();
  });

  it('errors on unknown character', async () => {
    await expect(editCharacterCommand(worldRef.id, 'Nobody', { mood: 'x' })).rejects.toThrow(
      /no agent/,
    );
  });

  it('errors on ambiguous name (two agents named the same)', async () => {
    // Seed a second Carol so name resolution has two matches.
    const store = await WorldStore.open(paths.db);
    const secondCarol = makeAgent(worldRef.id, 'Carol');
    await store.createAgent(secondCarol);
    store.close();

    await expect(editCharacterCommand(worldRef.id, 'Carol', { mood: 'x' })).rejects.toThrow(
      /ambiguous/,
    );
  });

  it('gives a readable error when --traits is malformed JSON', async () => {
    await expect(
      editCharacterCommand(worldRef.id, 'Carol', { traits: 'not json' }),
    ).rejects.toThrow(/--traits is not valid JSON/);
  });

  it('errors when no flags are given', async () => {
    await expect(editCharacterCommand(worldRef.id, 'Carol', {})).rejects.toThrow(/at least one of/);
  });

  it('empty --mood clears the mood (null semantics)', async () => {
    await editCharacterCommand(worldRef.id, 'Carol', { mood: '' });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 6);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<{
      mood: unknown;
    }>;
    expect(effects[0]?.mood).toBeNull();
    store.close();
  });

  it('--private-state accepts JSON object', async () => {
    await editCharacterCommand(worldRef.id, 'Carol', {
      privateState: '{"secret":"she is plotting"}',
    });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 6);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<{
      privateState: unknown;
    }>;
    expect(effects[0]?.privateState).toEqual({ secret: 'she is plotting' });
    store.close();
  });

  it('--private-state empty string clears it (null)', async () => {
    await editCharacterCommand(worldRef.id, 'Carol', { privateState: '' });

    const store = await WorldStore.open(paths.db);
    const god = new GodService(store);
    const queued = await god.getQueuedFor(worldRef.id, 6);
    const effects = (queued[0]?.compiledEffects as { effects: unknown[] })?.effects as Array<{
      privateState: unknown;
    }>;
    expect(effects[0]?.privateState).toBeNull();
    store.close();
  });
});

describe('end-to-end: edit-character → god intervention → agent mutated', () => {
  it('applying a queued intervention actually updates the agent', async () => {
    await editCharacterCommand(worldRef.id, 'Carol', {
      mood: 'paranoid',
      persona: 'Carol has turned.',
    });

    // Directly drive the god pipeline at tick 6 to simulate what the
    // engine's tick loop would do — applyEffects routes through the
    // EffectRegistry and mutates the agent row.
    const store = await WorldStore.open(paths.db);
    try {
      const god = new GodService(store);
      const queued = await god.getQueuedFor(worldRef.id, 6);
      expect(queued).toHaveLength(1);
      await god.applyEffects(worldRef, queued[0]!, 6);
      await god.markApplied(queued[0]!.id);

      const fresh = await store.getAgent(carol.id);
      expect(fresh.mood).toBe('paranoid');
      expect(fresh.persona).toBe('Carol has turned.');
      // Untouched fields survive.
      expect(fresh.traits).toEqual({ boldness: 0.3 });
    } finally {
      store.close();
    }
  });
});
