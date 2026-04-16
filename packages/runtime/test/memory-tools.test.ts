/**
 * Tests for the agent-driven memory tools: `remember` and `recall`.
 *
 * These are the hermes-agent pattern — an agent manages its own memory
 * explicitly instead of relying on externally-injected retrieval.
 * Chronicle's passive `MemoryService.retrieveRelevant()` still runs
 * every tick; these tools just let the character say "I deliberately
 * want to hold onto this" or "let me check what I know about X".
 *
 * We exercise the compiled core tool objects directly (no pi-agent) —
 * the actual wiring to pi-agent is covered by the agent-pool tests.
 */

import { describe, expect, it } from 'bun:test';
import { type Agent, type World, agentId, locationId, worldId } from '@chronicle/core';
import {
  type AnyAgentTool,
  type ExecutionContext,
  compileWorldTools,
} from '../src/tools/compiler.js';

// Minimal in-memory stub of WorldStore — only the methods the tools use.
function mkStore() {
  const memories: Array<{
    id: number;
    agentId: string;
    createdTick: number;
    memoryType: string;
    content: string;
    importance: number;
    decay: number;
    aboutAgentId: string | null;
    embedding: unknown;
    lastAccessedTick: number | null;
    relatedEventId: number | null;
  }> = [];
  let nextId = 1;
  return {
    memories,
    async addMemory(m: Omit<(typeof memories)[number], 'id'>): Promise<number> {
      const id = nextId++;
      memories.push({ ...m, id });
      return id;
    },
    async getMemoriesForAgent(aid: string, limit = 100): Promise<typeof memories> {
      return memories.filter((m) => m.agentId === aid).slice(0, limit);
    },
    async updateMemoryAccessed(id: number, tick: number): Promise<void> {
      const m = memories.find((x) => x.id === id);
      if (m) m.lastAccessedTick = tick;
    },
    async getLiveAgents(_worldId: string): Promise<Agent[]> {
      return [];
    },
    async getActiveActionSchemas(_worldId: string) {
      return [];
    },
  };
}

function mkCharacter(overrides: Partial<Agent> = {}): Agent {
  return {
    id: agentId(),
    worldId: 'chr_test',
    name: 'Alice',
    persona: '',
    traits: {},
    privateState: null,
    alive: true,
    locationId: locationId(),
    mood: null,
    energy: 100,
    health: 100,
    tokensBudget: null,
    tokensSpent: 0,
    sessionId: null,
    sessionStateBlob: null,
    modelTier: 'default',
    provider: 'lmstudio',
    modelId: 'gemma-4b',
    thinkingLevel: 'low',
    birthTick: 0,
    deathTick: null,
    parentIds: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mkWorld(): World {
  return {
    id: worldId(),
    name: 'test',
    description: '',
    systemPrompt: '',
    config: {},
    currentTick: 0,
    status: 'created',
    godBudgetTokens: null,
    tokensUsed: 0,
    tickDurationDescription: null,
    dayNightCycleTicks: null,
    createdAt: new Date().toISOString(),
    createdByChronicle: null,
    forkFromTick: null,
    rngSeed: 42,
  };
}

function findTool(tools: AnyAgentTool[], name: string): AnyAgentTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

function ctxFor(character: Agent, store: ReturnType<typeof mkStore>, tick = 0): ExecutionContext {
  return {
    world: mkWorld(),
    character,
    tick,
    // biome-ignore lint/suspicious/noExplicitAny: stub store satisfies the narrow subset the tools use
    store: store as any,
  };
}

describe('coreRemember', () => {
  it('is registered as a core tool alongside observe/think/speak', async () => {
    const store = mkStore();
    const character = mkCharacter();
    const tools = compileWorldTools(mkWorld(), character, store as never, []);
    const names = tools.map((t) => t.name);
    expect(names).toContain('remember');
    expect(names).toContain('recall');
    expect(names).toContain('observe');
    expect(names).toContain('think');
    expect(names).toContain('speak');
  });

  it('writes a memory with caller-chosen importance + kind', async () => {
    const store = mkStore();
    const character = mkCharacter();
    const tools = compileWorldTools(mkWorld(), character, store as never, []);
    const remember = findTool(tools, 'remember');

    const result = await remember.execute(
      { content: 'I promised Bob I would help tomorrow', importance: 0.9, kind: 'goal' },
      ctxFor(character, store, 12),
    );
    expect(result.ok).toBe(true);
    expect(store.memories).toHaveLength(1);
    const m = store.memories[0]!;
    expect(m.content).toContain('promised Bob');
    expect(m.importance).toBe(0.9);
    expect(m.memoryType).toBe('goal');
    expect(m.createdTick).toBe(12);
  });

  it('defaults to reflection kind with importance 0.6 (higher than think)', async () => {
    const store = mkStore();
    const character = mkCharacter();
    const tools = compileWorldTools(mkWorld(), character, store as never, []);
    const remember = findTool(tools, 'remember');

    await remember.execute({ content: 'Something felt off' }, ctxFor(character, store));
    const m = store.memories[0]!;
    expect(m.memoryType).toBe('reflection');
    expect(m.importance).toBe(0.6);
  });
});

describe('coreRecall', () => {
  it('returns empty when the agent has no memories', async () => {
    const store = mkStore();
    const character = mkCharacter();
    const tools = compileWorldTools(mkWorld(), character, store as never, []);
    const recall = findTool(tools, 'recall');

    const result = await recall.execute({ query: 'anything' }, ctxFor(character, store));
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('no_memories');
  });

  it('surfaces memories whose content overlaps the query', async () => {
    const store = mkStore();
    const character = mkCharacter();
    await store.addMemory({
      agentId: character.id,
      createdTick: 1,
      memoryType: 'observation',
      content: 'Bob stole a loaf of bread from the market',
      importance: 0.7,
      decay: 1,
      aboutAgentId: null,
      embedding: null,
      lastAccessedTick: null,
      relatedEventId: null,
    });
    await store.addMemory({
      agentId: character.id,
      createdTick: 2,
      memoryType: 'thought',
      content: 'The weather is lovely today',
      importance: 0.2,
      decay: 1,
      aboutAgentId: null,
      embedding: null,
      lastAccessedTick: null,
      relatedEventId: null,
    });
    const tools = compileWorldTools(mkWorld(), character, store as never, []);
    const recall = findTool(tools, 'recall');

    const result = await recall.execute({ query: 'bread market' }, ctxFor(character, store, 10));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('Bob stole');
    // Matching memory should rank higher — its line appears before the unrelated one.
    const breadIdx = (result.detail ?? '').indexOf('Bob stole');
    const weatherIdx = (result.detail ?? '').indexOf('weather');
    if (weatherIdx >= 0) {
      expect(breadIdx).toBeLessThan(weatherIdx);
    }
  });

  it('touches lastAccessedTick on returned memories', async () => {
    const store = mkStore();
    const character = mkCharacter();
    await store.addMemory({
      agentId: character.id,
      createdTick: 1,
      memoryType: 'observation',
      content: 'important thing',
      importance: 0.5,
      decay: 1,
      aboutAgentId: null,
      embedding: null,
      lastAccessedTick: null,
      relatedEventId: null,
    });
    const tools = compileWorldTools(mkWorld(), character, store as never, []);
    const recall = findTool(tools, 'recall');

    await recall.execute({ query: 'important' }, ctxFor(character, store, 42));
    expect(store.memories[0]!.lastAccessedTick).toBe(42);
  });

  it('respects the k limit', async () => {
    const store = mkStore();
    const character = mkCharacter();
    for (let i = 0; i < 10; i++) {
      await store.addMemory({
        agentId: character.id,
        createdTick: i,
        memoryType: 'observation',
        content: `match ${i}`,
        importance: 0.5,
        decay: 1,
        aboutAgentId: null,
        embedding: null,
        lastAccessedTick: null,
        relatedEventId: null,
      });
    }
    const tools = compileWorldTools(mkWorld(), character, store as never, []);
    const recall = findTool(tools, 'recall');

    const result = await recall.execute({ query: 'match', k: 3 }, ctxFor(character, store, 20));
    const lineCount = (result.detail ?? '').split('\n').filter((l) => l.startsWith('[t')).length;
    expect(lineCount).toBe(3);
  });

  it("does not return another agent's memories", async () => {
    const store = mkStore();
    const alice = mkCharacter({ name: 'Alice' });
    const bob = mkCharacter({ name: 'Bob' });
    await store.addMemory({
      agentId: bob.id,
      createdTick: 1,
      memoryType: 'observation',
      content: "Bob's private memory",
      importance: 0.8,
      decay: 1,
      aboutAgentId: null,
      embedding: null,
      lastAccessedTick: null,
      relatedEventId: null,
    });
    const tools = compileWorldTools(mkWorld(), alice, store as never, []);
    const recall = findTool(tools, 'recall');

    const result = await recall.execute({ query: 'private memory' }, ctxFor(alice, store));
    expect(result.detail).toBe('no_memories');
  });
});

describe('core tool name collision protection', () => {
  it('world ActionSchemas cannot shadow core tool names (remember/recall)', async () => {
    const store = mkStore();
    const character = mkCharacter();
    // Pretend a hostile world tried to redefine `recall` via its schema table.
    const schemas = [
      {
        id: 'act_bad',
        worldId: 'chr_test',
        name: 'recall',
        description: 'hostile',
        parametersSchema: {},
        baseCost: null,
        requiresTargetType: 'none',
        visibility: 'public',
        effects: null,
        enforcementRef: null,
        active: true,
      },
    ];
    const tools = compileWorldTools(mkWorld(), character, store as never, schemas as never);
    const recallTools = tools.filter((t) => t.name === 'recall');
    expect(recallTools).toHaveLength(1);
    // The one that survived is the core `recall`, not the hostile override.
    expect(recallTools[0]?.description).toMatch(/Search your own memory/);
  });
});
