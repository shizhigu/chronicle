/**
 * AgentPool — verifies the core invariants using a fake pi-module.
 *
 * Invariants tested:
 *   1. One Agent instance per character (created at hydrate).
 *   2. `sessionId` on each pi-Agent is deterministic and unique per character.
 *   3. `beforeToolCall` routes through the RuleEnforcer and blocks on rejection.
 *   4. `afterToolCall` emits `action_completed` on the bus.
 *   5. Session state blob is restored on subsequent hydrates (same-context
 *      = same-agent is preserved via sessionStateBlob restoration).
 *   6. `takeTurn` surfaces a ProposedAction from pi-agent output.
 *   7. Budget-exhausted returns error without touching the LLM.
 *   8. `shutdown` clears instances.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentId, locationId, worldId } from '@chronicle/core';
import type { Agent, Observation, World } from '@chronicle/core';
import { EventBus, RuleEnforcer, WorldStore } from '@chronicle/engine';
import { AgentPool, type PiModule } from '../src/agent-pool.js';

// ============================================================
// Fake pi-module
// ============================================================

interface FakeAgentOptions {
  sessionId: string;
  initialState: {
    systemPrompt: string;
    model: unknown;
    messages: unknown[];
    tools: Array<{ name: string }>;
    thinkingLevel: string;
  };
  beforeToolCall?: (args: {
    toolCall: { name: string };
    args: unknown;
  }) => Promise<{ block?: boolean; reason?: string } | undefined>;
  afterToolCall?: (args: { toolCall: { name: string }; isError: boolean }) => Promise<void>;
}

class FakeAgent {
  public readonly sessionId: string;
  public state: {
    systemPrompt: string;
    model: unknown;
    messages: Array<{ role: string; content: unknown }>;
    tools: Array<{ name: string }>;
    thinkingLevel: string;
  };
  private beforeToolCall?: FakeAgentOptions['beforeToolCall'];
  private afterToolCall?: FakeAgentOptions['afterToolCall'];

  constructor(opts: FakeAgentOptions) {
    this.sessionId = opts.sessionId;
    this.state = {
      ...opts.initialState,
      messages: opts.initialState.messages as Array<{ role: string; content: unknown }>,
    };
    this.beforeToolCall = opts.beforeToolCall;
    this.afterToolCall = opts.afterToolCall;
  }

  /** Scripted prompt() for tests — tests set `nextAction` on the instance beforehand. */
  public nextAction: { tool: string; args: Record<string, unknown> } | null = null;

  async prompt(_text: string): Promise<void> {
    if (!this.nextAction) return;

    // 1. beforeToolCall hook (mirrors pi-agent-core real behavior)
    const beforeResult = await this.beforeToolCall?.({
      toolCall: { name: this.nextAction.tool },
      args: this.nextAction.args,
    });

    if (beforeResult?.block) {
      // Blocked — don't push tool_use into messages; push an assistant decline
      this.state.messages.push({
        role: 'assistant',
        content: `Action blocked: ${beforeResult.reason}`,
      });
      await this.afterToolCall?.({
        toolCall: { name: this.nextAction.tool },
        isError: true,
      });
      return;
    }

    // 2. Push the tool_use content block
    this.state.messages.push({
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: this.nextAction.tool,
          input: this.nextAction.args,
        },
      ],
    });

    // 3. afterToolCall hook
    await this.afterToolCall?.({
      toolCall: { name: this.nextAction.tool },
      isError: false,
    });
  }

  abort(): void {
    /* no-op for tests */
  }
}

function fakePiLoader(created: FakeAgent[]): PiModule {
  return {
    Agent: class extends FakeAgent {
      constructor(opts: FakeAgentOptions) {
        super(opts);
        created.push(this);
      }
    } as unknown as PiModule['Agent'],
    getModel: (provider: string, id: string) => ({ provider, id }),
  };
}

// ============================================================
// Fixtures
// ============================================================

function makeWorld(): World {
  return {
    id: worldId(),
    name: 'T',
    description: 't',
    systemPrompt: 'Be in character.',
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
    currentTick: 0,
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

function makeAgent(wId: string, name: string, locId: string | null): Agent {
  return {
    id: agentId(),
    worldId: wId,
    name,
    persona: `${name} is a character.`,
    traits: {},
    privateState: null,
    alive: true,
    locationId: locId,
    mood: null,
    energy: 100,
    health: 100,
    tokensBudget: null,
    tokensSpent: 0,
    sessionId: null,
    sessionStateBlob: null,
    modelTier: 'haiku',
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    thinkingLevel: 'low',
    birthTick: 0,
    deathTick: null,
    parentIds: null,
    createdAt: new Date().toISOString(),
  };
}

function makeObservation(tick: number): Observation {
  return {
    agentId: 'agt_x',
    tick,
    selfState: {
      location: 'hall',
      mood: 'calm',
      energy: 100,
      health: 100,
      inventory: [],
    },
    nearby: { agents: [], resources: [], locations: [] },
    recentEvents: [],
    currentGoals: [],
  };
}

// ============================================================
// Tests
// ============================================================

let store: WorldStore;
let world: World;
let alice: Agent;
let bob: Agent;
let events: EventBus;
let enforcer: RuleEnforcer;

beforeEach(async () => {
  store = await WorldStore.open(':memory:');
  world = makeWorld();
  await store.createWorld(world);
  const hall = {
    id: locationId(),
    worldId: world.id,
    name: 'hall',
    description: 'the hall',
    x: null,
    y: null,
    parentId: null,
    affordances: [],
    metadata: {},
    spriteHint: null,
    createdAt: new Date().toISOString(),
  };
  await store.createLocation(hall);
  alice = makeAgent(world.id, 'Alice', hall.id);
  bob = makeAgent(world.id, 'Bob', hall.id);
  await store.createAgent(alice);
  await store.createAgent(bob);

  events = new EventBus();
  enforcer = new RuleEnforcer(store, world);
});

afterEach(() => store.close());

describe('AgentPool — hydration and identity', () => {
  it('creates one instance per live character', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
    });

    await pool.hydrate(world, [alice, bob]);
    expect(instances.length).toBe(2);
  });

  it('assigns a deterministic sessionId derived from world + character id', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
    });

    await pool.hydrate(world, [alice]);
    const sid = instances[0]!.sessionId;
    expect(sid).toBe(`chr_${world.id}_${alice.id}`);
    expect(sid).not.toBe(`chr_${world.id}_${bob.id}`);
  });

  it('injects persona + shared worldPrompt into systemPrompt', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
    });
    await pool.hydrate(world, [alice]);
    const sys = instances[0]!.state.systemPrompt;
    expect(sys).toContain('Alice');
    expect(sys).toContain('is a character');
    expect(sys).toContain('Be in character.');
  });

  it('restores sessionStateBlob on rehydrate (same context = same agent)', async () => {
    // First hydrate — no blob yet, messages start empty
    const instances1: FakeAgent[] = [];
    const pool1 = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances1),
    });
    await pool1.hydrate(world, [alice]);
    expect(instances1[0]!.state.messages).toEqual([]);

    // Persist a fake session blob for alice
    const fakeMessages = [
      { role: 'user', content: 'earlier user message' },
      { role: 'assistant', content: 'earlier assistant reply' },
    ];
    const blob = Buffer.from(JSON.stringify(fakeMessages), 'utf-8');
    await store.updateAgentState(alice.id, { sessionStateBlob: blob });
    const freshAlice = await store.getAgent(alice.id);
    expect(freshAlice.sessionStateBlob).not.toBeNull();

    // Second hydrate — new pool. Messages should carry over.
    const instances2: FakeAgent[] = [];
    const pool2 = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances2),
    });
    await pool2.hydrate(world, [freshAlice]);
    expect(instances2[0]!.state.messages.length).toBe(2);
  });
});

describe('AgentPool — takeTurn + hooks', () => {
  it('returns budget_exhausted without touching the instance when over budget', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
    });
    const tired: Agent = { ...alice, tokensBudget: 10, tokensSpent: 10 };
    await pool.hydrate(world, [tired]);
    const result = await pool.takeTurn(tired, makeObservation(1), 1);
    expect(result.action).toBeNull();
    expect(result.error).toBe('budget_exhausted');
  });

  it('extracts a ProposedAction from the latest assistant tool_use block', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
    });
    await pool.hydrate(world, [alice]);
    instances[0]!.nextAction = { tool: 'speak', args: { to: 'all', content: 'Hi' } };

    const result = await pool.takeTurn(alice, makeObservation(1), 1);
    expect(result.action).toBeTruthy();
    expect(result.action?.actionName).toBe('speak');
    expect(result.action?.args).toEqual({ to: 'all', content: 'Hi' });
  });

  it('beforeToolCall blocks an action the rule enforcer rejects', async () => {
    // Seed a hard rule that rejects 'speak' via a predicate that says no-no
    await store.createRule({
      id: 'rul_test',
      worldId: world.id,
      description: 'no speaking while mood is enraged',
      tier: 'hard',
      hardPredicate: 'not enraged',
      hardCheck: 'character.mood != "enraged"',
      hardOnViolation: 'reject',
      active: true,
      priority: 100,
      scope: undefined,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: null,
    });

    // Put alice in enraged mood
    await store.updateAgentState(alice.id, { mood: 'enraged' });
    const freshAlice = await store.getAgent(alice.id);

    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
    });
    await pool.hydrate(world, [freshAlice]);

    instances[0]!.nextAction = { tool: 'speak', args: { to: 'all', content: 'HI' } };

    // afterToolCall fires with isError=true because we blocked
    const seen: { tool: string; isError: boolean }[] = [];
    events.subscribe((e) => {
      if (e.type === 'action_completed') seen.push({ tool: e.tool, isError: e.isError });
    });

    await pool.takeTurn(freshAlice, makeObservation(1), 1);
    expect(seen).toEqual([{ tool: 'speak', isError: true }]);
  });

  it('afterToolCall emits action_completed on the bus for a successful action', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
    });
    await pool.hydrate(world, [alice]);
    instances[0]!.nextAction = { tool: 'think', args: { thought: 'hmm' } };

    const seen: { tool: string; isError: boolean }[] = [];
    events.subscribe((e) => {
      if (e.type === 'action_completed') seen.push({ tool: e.tool, isError: e.isError });
    });

    await pool.takeTurn(alice, makeObservation(1), 1);
    expect(seen).toEqual([{ tool: 'think', isError: false }]);
  });
});

describe('AgentPool — retry on transient provider failures (ADR-0013)', () => {
  it('retries a 503 and eventually succeeds', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
      retryOptions: { baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} },
    });
    await pool.hydrate(world, [alice]);

    const inst = instances[0]!;
    inst.nextAction = { tool: 'think', args: { thought: 'ok' } };

    // Make the first 2 prompt() calls throw a retryable 503, third succeeds.
    const original = inst.prompt.bind(inst);
    let promptCalls = 0;
    inst.prompt = async (text: string) => {
      promptCalls++;
      if (promptCalls < 3) throw { status: 503, message: 'overloaded' };
      return original(text);
    };

    const result = await pool.takeTurn(alice, makeObservation(1), 1);

    expect(promptCalls).toBe(3);
    expect(result.error).toBeUndefined();
    expect(result.action?.actionName).toBe('think');
  });

  it('non-retryable errors (401) short-circuit on attempt 1', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
      retryOptions: { baseDelayMs: 1, sleep: async () => {} },
    });
    await pool.hydrate(world, [alice]);

    const inst = instances[0]!;
    let promptCalls = 0;
    inst.prompt = async () => {
      promptCalls++;
      throw { status: 401, message: 'unauthorized' };
    };

    const result = await pool.takeTurn(alice, makeObservation(1), 1);

    expect(promptCalls).toBe(1);
    expect(result.action).toBeNull();
    expect(result.error).toMatch(/auth:/);
  });

  it('exhausts maxAttempts on persistent retryable failure and returns classified error', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
      retryOptions: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
        sleep: async () => {},
      },
    });
    await pool.hydrate(world, [alice]);

    const inst = instances[0]!;
    let promptCalls = 0;
    inst.prompt = async () => {
      promptCalls++;
      throw { status: 429, message: 'rate limited' };
    };

    const result = await pool.takeTurn(alice, makeObservation(1), 1);
    expect(promptCalls).toBe(2);
    expect(result.action).toBeNull();
    expect(result.error).toMatch(/rate_limit:/);
  });

  it("detects pi-agent's stopReason:'error' assistant message and feeds it to the classifier", async () => {
    // Pi-agent's stream contract is "never throw — encode failures in
    // the returned AssistantMessage via stopReason:'error'". Without
    // surfacing that into the retry loop, transient network/rate
    // errors would silently become empty agent_silent turns with no
    // retry. This test mimics a 429 response that pi-agent buried in
    // the transcript, and verifies retryWithBackoff classifies it as
    // rate_limit (retryable) and the turn ultimately fails with the
    // right error kind.
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
      retryOptions: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} },
    });
    await pool.hydrate(world, [alice]);
    const inst = instances[0]!;

    let promptCalls = 0;
    inst.prompt = async () => {
      promptCalls++;
      // Emulate pi-agent's buried-error shape: append an assistant
      // message whose stopReason is 'error' + a messaged that the
      // classifier's substring heuristics recognise as rate-limit.
      (inst.state.messages as any[]).push({
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'request was throttled — rate limited by upstream',
      });
    };

    const result = await pool.takeTurn(alice, makeObservation(1), 1);

    // Retry fires despite prompt() never throwing.
    expect(promptCalls).toBe(2);
    expect(result.action).toBeNull();
    expect(result.error).toMatch(/rate_limit:/);
  });
});

describe('AgentPool — shutdown', () => {
  it('clears instances', async () => {
    const instances: FakeAgent[] = [];
    const pool = new AgentPool({
      store,
      ruleEnforcer: enforcer,
      events,
      piLoader: async () => fakePiLoader(instances),
    });
    await pool.hydrate(world, [alice, bob]);
    await pool.shutdown();
    // After shutdown, takeTurn on a previously-registered agent should error
    await expect(pool.takeTurn(alice, makeObservation(1), 1)).rejects.toThrow();
  });
});
