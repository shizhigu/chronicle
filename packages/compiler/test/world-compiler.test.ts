/**
 * WorldCompiler integration test — mocked LLM produces a CompiledWorld, we
 * persist it to a real in-memory WorldStore and verify the shape end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { WorldStore } from '@chronicle/engine';
import type { Llm } from '../src/llm.js';
import { type CompiledWorld, WorldCompiler } from '../src/world-compiler.js';

let store: WorldStore;

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
});
afterEach(() => store.close());

function sequencedLlm(seq: string[]): Llm {
  let i = 0;
  return {
    async call(): Promise<string> {
      return seq[i++] ?? '{}';
    },
  };
}

function sampleCompiled(): CompiledWorld {
  return {
    name: 'Dinner Party',
    atmosphere: 'tense',
    atmosphereTag: 'parlor_drama',
    scale: 'small',
    tickDurationDescription: '5 minutes in-world',
    dayNightCycleTicks: null,
    sharedSystemPrompt: 'You are a guest at an ill-fated dinner.',
    characters: [
      {
        name: 'Marcus',
        persona: 'The host, confident yet hiding a financial ruin.',
        shortDescription: 'Nervous host',
        traits: { openness: 0.6 },
        privateState: { secret: 'bankrupt' },
        startingMood: 'anxious',
        startingLocationName: 'parlor',
      },
      {
        name: 'Eliza',
        persona: 'A guest who came to collect a debt.',
        shortDescription: 'Patient creditor',
        traits: { patience: 0.9 },
        startingMood: 'calm',
        startingLocationName: 'parlor',
      },
      {
        name: 'Butler',
        persona: 'The long-suffering butler.',
        shortDescription: 'Observant staff',
        traits: {},
        startingMood: 'neutral',
        startingLocationName: 'kitchen',
      },
    ],
    locations: [
      {
        name: 'parlor',
        description: 'A dim parlor with faded grandeur.',
        affordances: ['sit', 'speak'],
        adjacentTo: ['kitchen'],
      },
      {
        name: 'kitchen',
        description: 'The kitchen behind a swinging door.',
        affordances: ['cook'],
        adjacentTo: ['parlor'],
      },
    ],
    resources: [
      { type: 'wine', initialQuantity: 3, atLocationName: 'parlor', perAgent: false },
      { type: 'coin', initialQuantity: 0, perAgent: true },
    ],
    rules: [
      'Only living characters can speak.',
      'Insulting the host is considered rude.',
      'Drinking wine costs energy.',
    ],
    actions: [
      {
        name: 'pour_wine',
        description: 'Pour a glass of wine for someone.',
        parameters: { target: { type: 'string' } },
        baseCost: { energy: 1 },
        visibility: 'public',
      },
    ],
    initialScene: 'Candles flicker. Five guests sit at a long table. Silence.',
  };
}

describe('WorldCompiler.parseDescription', () => {
  it('parses and validates a complete CompiledWorld shape', async () => {
    const llm = sequencedLlm([JSON.stringify(sampleCompiled())]);
    const compiler = new WorldCompiler({ llm });
    const compiled = await compiler.parseDescription(
      'A dinner party where the host hides that he is bankrupt.',
    );

    expect(compiled.name).toBe('Dinner Party');
    expect(compiled.characters.length).toBe(3);
    expect(compiled.locations.length).toBe(2);
    expect(compiled.rules.length).toBe(3);
    expect(compiled.atmosphereTag).toBe('parlor_drama');
  });

  it('rejects malformed output (missing required fields)', async () => {
    const broken = { name: 'Empty', atmosphere: 'bleh' }; // missing many fields
    const llm = sequencedLlm([JSON.stringify(broken)]);
    const compiler = new WorldCompiler({ llm });
    expect(compiler.parseDescription('something')).rejects.toThrow();
  });

  it('enforces the 2-50 character count constraint', async () => {
    const tooFew = { ...sampleCompiled(), characters: [sampleCompiled().characters[0]!] };
    const llm = sequencedLlm([JSON.stringify(tooFew)]);
    const compiler = new WorldCompiler({ llm });
    expect(compiler.parseDescription('solo scenario')).rejects.toThrow();
  });
});

describe('WorldCompiler.persist', () => {
  it('writes a world, locations, adjacencies, agents, resources, actions, rules, and initial event', async () => {
    const compiledWorld = sampleCompiled();
    // parseDescription happens first (1 LLM call). Then 3 rules × 2 LLM calls each = 6.
    // = 7 total LLM calls for this path.
    const llm = sequencedLlm([
      // classify + parse for each rule (3 rules × 2 = 6 calls)
      JSON.stringify({ tier: 'hard' }),
      JSON.stringify({ predicate: 'alive', check: 'character.alive', onViolation: 'reject' }),
      JSON.stringify({ tier: 'soft' }),
      JSON.stringify({
        normText: 'Be polite to the host',
        detectionPrompt: 'was the speaker rude to the host?',
        consequence: 'lose trust',
      }),
      JSON.stringify({ tier: 'economic' }),
      JSON.stringify({ appliesToAction: 'drink_wine', costs: { energy: 2 } }),
    ]);
    const compiler = new WorldCompiler({ llm });

    const worldId = await compiler.persist(store, compiledWorld, {
      description: 'A dinner party.',
      defaultProvider: 'anthropic',
      defaultModelId: 'claude-haiku-4-5',
    });

    // World persisted
    const w = await store.loadWorld(worldId);
    expect(w.name).toBe('Dinner Party');
    expect(w.config.atmosphereTag).toBe('parlor_drama');
    expect(w.currentTick).toBe(0);

    // Locations
    const locs = await store.getLocationsForWorld(worldId);
    expect(locs.map((l) => l.name).sort()).toEqual(['kitchen', 'parlor']);

    // Adjacencies bidirectional
    const parlor = locs.find((l) => l.name === 'parlor')!;
    const kitchen = locs.find((l) => l.name === 'kitchen')!;
    expect(await store.getAdjacentLocations(parlor.id)).toContain(kitchen.id);
    expect(await store.getAdjacentLocations(kitchen.id)).toContain(parlor.id);

    // Agents placed at starting locations
    const agents = await store.getLiveAgents(worldId);
    expect(agents.length).toBe(3);
    const marcus = agents.find((a) => a.name === 'Marcus')!;
    expect(marcus.locationId).toBe(parlor.id);
    expect(marcus.mood).toBe('anxious');
    expect(marcus.privateState).toEqual({ secret: 'bankrupt' });
    const butler = agents.find((a) => a.name === 'Butler')!;
    expect(butler.locationId).toBe(kitchen.id);

    // Resources — location-owned wine, per-agent coin
    const wineAtParlor = await store.getResourcesAtLocation(parlor.id);
    expect(wineAtParlor.find((r) => r.type === 'wine')?.quantity).toBe(3);
    // Each agent gets 0 coin
    for (const a of agents) {
      const owned = await store.getResourcesOwnedBy(a.id);
      expect(owned.some((r) => r.type === 'coin')).toBe(true);
    }

    // Actions
    const actions = await store.getActiveActionSchemas(worldId);
    expect(actions.map((a) => a.name)).toContain('pour_wine');

    // Rules compiled
    const rules = await store.getActiveRules(worldId);
    expect(rules.length).toBe(3);
    const tiers = rules.map((r) => r.tier).sort();
    expect(tiers).toEqual(['economic', 'hard', 'soft']);

    // Initial scene recorded as tick-0 event
    const initialEvents = await store.getEventsInRange(worldId, 0, 0);
    expect(initialEvents.length).toBe(1);
    expect((initialEvents[0]?.data as { initialScene: string }).initialScene).toContain(
      'Candles flicker',
    );
  });
});
