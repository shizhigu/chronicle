/**
 * Chronicle Engine — the tick loop.
 *
 * Single source of truth for: running a world, coordinating agents,
 * enforcing rules, persisting state, broadcasting events.
 */

import type { Agent, Observation, ProposedAction, TurnResult, World } from '@chronicle/core';

import { EventBus, type Subscriber } from './events/bus.js';
import { GodService } from './god/service.js';
import { type ReflectionDeps, ReflectionService } from './memory/reflection.js';
import { MemoryService } from './memory/service.js';
import { CatalystInjector } from './narrative/catalyst.js';
import { DramaDetector } from './narrative/drama.js';
import { ObservationBuilder } from './perception/observation.js';
import { RuleEnforcer } from './rules/enforcer.js';
import { WorldStore } from './store.js';

/**
 * Minimal interface the engine needs from the agent runtime layer.
 * The runtime package (or a test mock) implements this.
 */
export interface AgentRuntimeAdapter {
  hydrate(world: World, agents: Agent[]): Promise<void>;
  takeTurn(agent: Agent, observation: Observation, tick: number): Promise<TurnResult>;
  applyAction(agent: Agent, action: ProposedAction, tick: number): Promise<void>;
  reflect(
    agent: Agent,
    prompt: string,
    modelOverride?: { provider: string; modelId: string },
  ): Promise<string>;
  shutdown(): Promise<void>;
}

export interface EngineOptions {
  dbPath: string;
  worldId: string;
  runtime: AgentRuntimeAdapter;
  onEvent?: Subscriber;
  onTickEnd?: (tick: number, worldState: World) => void;
  sonnetModel?: { provider: string; modelId: string };
}

export class Engine {
  private store!: WorldStore;
  private ruleEnforcer!: RuleEnforcer;
  private events!: EventBus;
  private observations!: ObservationBuilder;
  private memory!: MemoryService;
  private reflection!: ReflectionService;
  private drama!: DramaDetector;
  private catalyst!: CatalystInjector;
  private god!: GodService;
  private runtime: AgentRuntimeAdapter;

  private world!: World;
  private running = false;
  private paused = false;

  constructor(private opts: EngineOptions) {
    this.runtime = opts.runtime;
  }

  async init(): Promise<void> {
    this.store = await WorldStore.open(this.opts.dbPath);
    this.world = await this.store.loadWorld(this.opts.worldId);

    this.events = new EventBus();
    if (this.opts.onEvent) this.events.subscribe(this.opts.onEvent);

    this.ruleEnforcer = new RuleEnforcer(this.store, this.world);
    this.observations = new ObservationBuilder(this.store, this.world);
    this.memory = new MemoryService(this.store);
    this.drama = new DramaDetector(this.store);
    this.catalyst = new CatalystInjector(this.store, this.world);
    this.god = new GodService(this.store);

    const reflectionDeps: ReflectionDeps = {
      getAgentInstance: (agent: Agent) => ({
        reflect: (prompt, override) => this.runtime.reflect(agent, prompt, override),
      }),
      sonnetModel: this.opts.sonnetModel ?? {
        provider: this.world.config.defaultProvider,
        modelId: 'claude-sonnet-4-6',
      },
    };
    this.reflection = new ReflectionService(this.store, this.memory, reflectionDeps);

    const live = await this.store.getLiveAgents(this.world.id);
    await this.runtime.hydrate(this.world, live);
  }

  get worldState(): World {
    return this.world;
  }

  get store_(): WorldStore {
    return this.store;
  }

  get bus(): EventBus {
    return this.events;
  }

  async run(runOpts: { ticks?: number; untilEvent?: string; budget?: number } = {}): Promise<void> {
    const maxTick = runOpts.ticks
      ? this.world.currentTick + runOpts.ticks
      : Number.POSITIVE_INFINITY;
    this.running = true;
    this.paused = false;

    await this.store.updateWorldStatus(this.world.id, 'running');

    try {
      while (this.running && this.world.currentTick < maxTick) {
        if (this.paused) {
          await sleep(100);
          continue;
        }

        await this.runSingleTick();

        if (runOpts.budget && this.world.tokensUsed >= runOpts.budget) {
          this.events.emit({ type: 'budget_exceeded', worldId: this.world.id });
          this.pause();
          break;
        }

        if (this.opts.onTickEnd) {
          this.opts.onTickEnd(this.world.currentTick, this.world);
        }
      }
    } finally {
      this.running = false;
      await this.persistWorldState();
      await this.store.updateWorldStatus(this.world.id, this.paused ? 'paused' : 'ended');
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.running = false;
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.runtime.shutdown();
    this.store.close();
  }

  // ============================================================
  // Tick lifecycle
  // ============================================================

  private async runSingleTick(): Promise<void> {
    const nextTick = this.world.currentTick + 1;

    this.events.emit({ type: 'tick_begin', worldId: this.world.id, tick: nextTick });

    // Build observations
    const liveAgents = await this.store.getLiveAgents(this.world.id);
    const observations = new Map<string, Observation>();
    for (const agent of liveAgents) {
      observations.set(agent.id, await this.observations.build(agent, nextTick));
    }

    // Attach relevant memories
    for (const agent of liveAgents) {
      const memories = await this.memory.retrieveRelevant(agent, observations.get(agent.id)!, 10);
      observations.get(agent.id)!.relevantMemories = memories.map((m) => ({
        content: m.content,
        importance: m.importance,
        tick: m.createdTick,
      }));
    }

    // Parallel decisions (all agents see same snapshot)
    const results = await Promise.all(
      liveAgents.map((a) =>
        this.runtime.takeTurn(a, observations.get(a.id)!, nextTick).catch((err) => {
          console.error(`[Engine] takeTurn error for ${a.name}:`, err);
          return {
            agentId: a.id,
            action: null,
            historyBlob: null,
            tokensSpent: a.tokensSpent,
            error: String(err),
          } satisfies TurnResult;
        }),
      ),
    );

    // Deterministic resolution
    const sorted = this.sortForResolution(results, nextTick);
    for (const result of sorted) {
      if (result.action?.actionName) {
        const agent = liveAgents.find((a) => a.id === result.agentId)!;
        try {
          await this.runtime.applyAction(agent, result.action, nextTick);
          await this.store.recordEvent({
            worldId: this.world.id,
            tick: nextTick,
            eventType: 'action',
            actorId: agent.id,
            data: { action: result.action.actionName, args: result.action.args },
            tokenCost: result.tokensSpent,
          });
        } catch (err) {
          console.error(`[Engine] applyAction failed for ${agent.name}:`, err);
        }
      }
      // Persist updated agent state (history blob, tokens)
      await this.store.updateAgentState(result.agentId, {
        sessionStateBlob: result.historyBlob,
        tokensSpent: result.tokensSpent,
      });
    }

    // Apply god interventions scheduled for this tick. Pass `nextTick`
    // explicitly — `world.currentTick` hasn't been advanced yet here.
    const interventions = await this.god.getQueuedFor(this.world.id, nextTick);
    for (const iv of interventions) {
      await this.god.applyEffects(this.world, iv, nextTick);
      await this.god.markApplied(iv.id);
      this.events.emit({
        type: 'god_intervention_applied',
        worldId: this.world.id,
        tick: nextTick,
        description: iv.description,
      });
    }

    // Reflection cycle
    if (nextTick % this.world.config.reflectionFrequency === 0) {
      await this.reflection.triggerFor(liveAgents, nextTick);
    }

    // Drama + catalyst
    const dramaScore = await this.drama.scoreRecentTicks(this.world, 10);
    if (
      this.world.config.dramaCatalystEnabled &&
      dramaScore < 0.25 &&
      nextTick % 10 === 0 &&
      nextTick > 0
    ) {
      await this.catalyst.inject(this.world, nextTick);
    }

    // Advance world tick
    this.world.currentTick = nextTick;
    await this.store.updateWorldTick(this.world.id, nextTick);

    // Token accounting
    const totalSpentThisTick = results.reduce((n, r) => n + (r.tokensSpent ?? 0), 0);
    if (totalSpentThisTick > 0) {
      await this.store.incrementTokensUsed(this.world.id, totalSpentThisTick);
      this.world.tokensUsed += totalSpentThisTick;
    }

    this.events.emit({
      type: 'tick_end',
      worldId: this.world.id,
      tick: nextTick,
      dramaScore,
      liveAgentCount: liveAgents.length,
    });
  }

  private sortForResolution(results: TurnResult[], _tick: number): TurnResult[] {
    // Deterministic: by agent id for now.
    // Future: use rule priority + rng seed for tiebreak.
    return [...results].sort((a, b) => a.agentId.localeCompare(b.agentId));
  }

  private async persistWorldState(): Promise<void> {
    if (this.world.currentTick % 10 === 0) {
      // Snapshot every 10 ticks for fast replay/fork
      const snapshot = JSON.stringify({
        tick: this.world.currentTick,
        tokensUsed: this.world.tokensUsed,
      });
      await this.store.snapshot(this.world.id, this.world.currentTick, snapshot, 0);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
