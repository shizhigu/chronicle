/**
 * `chronicle watch` — prints recent events without touching the engine.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, worldId } from '@chronicle/core';
import type { Agent, World } from '@chronicle/core';
import { WorldStore } from '@chronicle/engine';
import { watchCommand } from '../src/commands/watch.js';
import { paths } from '../src/paths.js';

function makeWorld(name: string, tick: number): World {
  return {
    id: worldId(),
    name,
    description: name,
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
    currentTick: tick,
    status: 'paused',
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

let tmpHome: string;
let captured: string[];
let originalLog: typeof console.log;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-watch-'));
  process.env.CHRONICLE_HOME = tmpHome;
  captured = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    captured.push(args.join(' '));
  };
});

afterEach(() => {
  console.log = originalLog;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('watchCommand', () => {
  it('prints header with world name, tick, status', async () => {
    const store = await WorldStore.open(paths.db);
    const w = makeWorld('the-tavern', 12);
    await store.createWorld(w);
    store.close();

    await watchCommand(w.id);
    const out = captured.join('\n');
    expect(out).toContain('the-tavern');
    expect(out).toContain('tick 12');
    expect(out).toContain('paused');
  });

  it('prints recent events (last 20 ticks) with actor short-ids', async () => {
    const store = await WorldStore.open(paths.db);
    const w = makeWorld('with-events', 10);
    await store.createWorld(w);
    const alice = makeAgent(w.id, 'Alice');
    await store.createAgent(alice);

    // Event inside window (tick 5-10)
    await store.recordEvent({
      worldId: w.id,
      tick: 8,
      eventType: 'action',
      actorId: alice.id,
      data: { action: 'speak', args: { content: 'hi' } },
    });
    // Event outside window (too old — would be shown if window includes it,
    // but with currentTick=10, window starts at tick 0 so this IS included)
    await store.recordEvent({
      worldId: w.id,
      tick: 0,
      eventType: 'tick_begin',
      data: {},
    });
    store.close();

    await watchCommand(w.id);
    const out = captured.join('\n');

    // Shows tick + event type + data snippet
    expect(out).toMatch(/\[\s*8\]\s+action/);
    expect(out).toContain('speak');
    // Actor short-id (last 6 chars of Alice's id)
    expect(out).toContain(alice.id.slice(-6));
    // NEXT_STEPS present
    expect(out).toContain('NEXT_STEPS');
  });

  it('handles a world with no events gracefully', async () => {
    const store = await WorldStore.open(paths.db);
    const w = makeWorld('empty', 0);
    await store.createWorld(w);
    store.close();

    await expect(watchCommand(w.id)).resolves.toBeUndefined();
    const out = captured.join('\n');
    expect(out).toContain('empty');
  });

  it('throws a sensible error for an unknown world id', async () => {
    await expect(watchCommand('chr_doesnotexist')).rejects.toThrow(/not found/i);
  });
});
