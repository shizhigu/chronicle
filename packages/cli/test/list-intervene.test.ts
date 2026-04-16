/**
 * CLI list + intervene command handlers — direct invocation tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worldId } from '@chronicle/core';
import type { World } from '@chronicle/core';
import { WorldStore } from '@chronicle/engine';
import { interveneCommand } from '../src/commands/intervene.js';
import { listCommand } from '../src/commands/list.js';
import { paths } from '../src/paths.js';

function makeWorld(name: string): World {
  return {
    id: worldId(),
    name,
    description: `${name} scenario`,
    systemPrompt: '',
    config: {
      atmosphere: 'neutral',
      atmosphereTag: 'default',
      scale: 'small',
      mapLayout: { kind: 'graph', locations: [] },
      defaultModelId: 'claude-haiku-4-5',
      defaultProvider: 'anthropic',
      reflectionFrequency: 20,
      dramaCatalystEnabled: true,
    },
    currentTick: 7,
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

let tmpHome: string;
let originalLog: typeof console.log;
let captured: string[];

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-list-iv-'));
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

describe('list command', () => {
  it('prints the no-worlds helper when DB is empty', async () => {
    await listCommand();
    const out = captured.join('\n');
    expect(out).toContain('No chronicles yet');
    expect(out).toContain('NEXT_STEPS');
    expect(out).toContain('create-world');
  });

  it('prints a table with id + status + tick + name for each world', async () => {
    const store = await WorldStore.open(paths.db);
    const w1 = makeWorld('dinner-party');
    const w2 = { ...makeWorld('desert-island'), status: 'running' as const, currentTick: 42 };
    await store.createWorld(w1);
    await store.createWorld(w2);
    store.close();

    await listCommand();
    const out = captured.join('\n');

    expect(out).toContain('Your chronicles:');
    expect(out).toContain(w1.id);
    expect(out).toContain(w2.id);
    expect(out).toContain('dinner-party');
    expect(out).toContain('desert-island');
    expect(out).toContain('paused');
    expect(out).toContain('running');
    // Tick shown
    expect(out).toMatch(/tick\s+42/);
  });
});

describe('intervene command', () => {
  it('queues an intervention for currentTick+1 by default', async () => {
    const store = await WorldStore.open(paths.db);
    const w = makeWorld('test');
    await store.createWorld(w);
    store.close();

    await interveneCommand(w.id, { event: 'A stranger knocks.' });

    // Re-open and verify it was queued
    const reopened = await WorldStore.open(paths.db);
    const pending = await reopened.getPendingInterventions(w.id, w.currentTick + 1);
    expect(pending.length).toBe(1);
    expect(pending[0]?.description).toBe('A stranger knocks.');
    expect(pending[0]?.applyAtTick).toBe(w.currentTick + 1);
    reopened.close();

    const out = captured.join('\n');
    expect(out).toContain('queued');
    expect(out).toContain('NEXT_STEPS');
  });

  it('respects an explicit --at tick', async () => {
    const store = await WorldStore.open(paths.db);
    const w = makeWorld('test-at');
    await store.createWorld(w);
    store.close();

    await interveneCommand(w.id, { event: 'Later event.', at: '25' });

    const reopened = await WorldStore.open(paths.db);
    const pending = await reopened.getPendingInterventions(w.id, 25);
    expect(pending.some((p) => p.description === 'Later event.' && p.applyAtTick === 25)).toBe(
      true,
    );
    reopened.close();
  });

  it('throws a sensible error for an unknown world id', async () => {
    expect(interveneCommand('chr_nonexistent', { event: 'nope' })).rejects.toThrow(/not found/i);
  });
});
