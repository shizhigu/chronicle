/**
 * `chronicle create-world` — tested with a mocked WorldCompiler so no LLM
 * call is made. Verifies the command writes the expected artifacts and
 * emits a NEXT_STEPS block keyed to the new world id.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledWorld } from '@chronicle/compiler';
import { WorldStore } from '@chronicle/engine';
import { createWorldCommand } from '../src/commands/create-world.js';
import { paths } from '../src/paths.js';

function sampleCompiled(): CompiledWorld {
  return {
    name: 'Test World',
    atmosphere: 'tense',
    atmosphereTag: 'parlor_drama',
    scale: 'small',
    sharedSystemPrompt: 'be in character',
    characters: [
      {
        name: 'Alice',
        persona: 'The host.',
        shortDescription: 'host',
        traits: {},
        startingLocationName: 'parlor',
      },
      {
        name: 'Bob',
        persona: 'The guest.',
        shortDescription: 'guest',
        traits: {},
        startingLocationName: 'parlor',
      },
    ],
    locations: [{ name: 'parlor', description: 'the parlor', affordances: [], adjacentTo: [] }],
    resources: [],
    rules: [], // keep zero rules so we don't need to mock RuleCompiler calls
    actions: [],
    initialScene: 'The clock strikes seven.',
  };
}

/** A minimal WorldCompiler stub that skips LLM calls entirely. */
function makeMockCompiler(compiled: CompiledWorld) {
  // Match just the public surface createWorldCommand uses.
  return {
    async parseDescription(_: string) {
      return compiled;
    },
    async persist(
      store: WorldStore,
      c: CompiledWorld,
      opts: { description: string; defaultProvider: string; defaultModelId: string },
    ) {
      // Borrow the real persist logic by importing and delegating.
      const { WorldCompiler } = await import('@chronicle/compiler');
      const real = new WorldCompiler({
        llm: {
          async call() {
            return '{}';
          },
        },
      });
      return real.persist(store, c, opts);
    },
  } as unknown as import('@chronicle/compiler').WorldCompiler;
}

let tmpHome: string;
let captured: string[];
let originalLog: typeof console.log;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'chronicle-cw-'));
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

describe('createWorldCommand', () => {
  it('persists a world + characters + initial event and prints NEXT_STEPS', async () => {
    const compiled = sampleCompiled();
    await createWorldCommand(
      { desc: 'A tense dinner party.' },
      { compiler: makeMockCompiler(compiled) },
    );

    // Output contains the world scaffold summary
    const out = captured.join('\n');
    expect(out).toContain('Test World');
    expect(out).toContain('parlor_drama');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
    expect(out).toContain('NEXT_STEPS');
    expect(out).toContain('chronicle run');
    expect(out).toContain('chronicle dashboard');

    // DB actually has the world
    const store = await WorldStore.open(paths.db);
    const worlds = await store.listWorlds();
    expect(worlds.length).toBe(1);
    expect(worlds[0]?.name).toBe('Test World');

    // Agents landed at their starting location
    const locs = await store.getLocationsForWorld(worlds[0]!.id);
    expect(locs.map((l) => l.name)).toEqual(['parlor']);
    const agents = await store.getLiveAgents(worlds[0]!.id);
    expect(agents.map((a) => a.name).sort()).toEqual(['Alice', 'Bob']);
    expect(agents[0]?.locationId).toBe(locs[0]?.id);

    // Initial scene recorded as tick-0 event
    const events = await store.getEventsInRange(worlds[0]!.id, 0, 0);
    expect(events.length).toBe(1);
    expect((events[0]?.data as { initialScene: string }).initialScene).toBe(
      'The clock strikes seven.',
    );

    store.close();
  });

  it('estimates cost visibly so users can budget', async () => {
    const compiled = sampleCompiled();
    await createWorldCommand({ desc: 'x' }, { compiler: makeMockCompiler(compiled) });
    const out = captured.join('\n');
    expect(out).toMatch(/Estimated cost.*\$/);
  });

  it('does not leak a world record if the compiler throws', async () => {
    const broken = {
      async parseDescription() {
        throw new Error('LLM refused');
      },
      async persist() {
        throw new Error('should not reach');
      },
    } as unknown as import('@chronicle/compiler').WorldCompiler;

    await expect(createWorldCommand({ desc: 'x' }, { compiler: broken })).rejects.toThrow(
      /LLM refused/,
    );

    // DB has no orphan world
    const store = await WorldStore.open(paths.db);
    const worlds = await store.listWorlds();
    expect(worlds.length).toBe(0);
    store.close();
  });
});
