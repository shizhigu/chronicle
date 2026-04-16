/**
 * Chronicle Engine — the tick loop.
 *
 * Single source of truth for: running a world, coordinating agents,
 * enforcing rules, persisting state, broadcasting events.
 */

import type { Agent, Observation, ProposedAction, TurnResult, World } from '@chronicle/core';

import { ActivationService, type AgentActivation } from './activation/service.js';
import { EventBus, type Subscriber } from './events/bus.js';
import { GodService } from './god/service.js';
import { ProposalService } from './governance/proposal-service.js';
import { MemoryFileStore } from './memory/file-store.js';
import { type ReflectionDeps, ReflectionService } from './memory/reflection.js';
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
  /**
   * Model used for reflection cycles (and any other heavier-than-per-turn work).
   * If omitted, reflection runs against the world's `defaultProvider` + `defaultModelId`.
   * No provider is privileged — pass whatever the user configured.
   */
  reflectionModel?: { provider: string; modelId: string };
  /**
   * Override the memory file store (useful for tests that want a tmp
   * directory). Production callers can leave this out and accept the
   * default CHRONICLE_HOME root.
   */
  memory?: MemoryFileStore;
  /**
   * Plug in a custom activation filter. Default is `ActivationService`
   * (ADR-0010) — a deterministic 5-signal pre-filter. Tests can inject
   * a stub that returns a fixed decision per agent.
   */
  activation?: AgentActivation;
}

export class Engine {
  private store!: WorldStore;
  private ruleEnforcer!: RuleEnforcer;
  private events!: EventBus;
  private observations!: ObservationBuilder;
  private memory!: MemoryFileStore;
  private reflection!: ReflectionService;
  private drama!: DramaDetector;
  private catalyst!: CatalystInjector;
  private god!: GodService;
  private proposals!: ProposalService;
  private activation!: AgentActivation;
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
    this.memory = this.opts.memory ?? new MemoryFileStore();
    this.drama = new DramaDetector(this.store);
    this.catalyst = new CatalystInjector(this.store, this.world);
    this.god = new GodService(this.store);
    this.proposals = new ProposalService(this.store, this.events);
    this.activation = this.opts.activation ?? new ActivationService(this.store, this.world);

    const reflectionDeps: ReflectionDeps = {
      getAgentInstance: (agent: Agent) => ({
        reflect: (prompt, override) => this.runtime.reflect(agent, prompt, override),
      }),
      // Fall back to the world's default model — whatever the user chose.
      // Never privilege a specific provider here.
      reflectionModel: this.opts.reflectionModel ?? {
        provider: this.world.config.defaultProvider,
        modelId: this.world.config.defaultModelId,
      },
    };
    this.reflection = new ReflectionService(this.world, this.memory, reflectionDeps);

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

    // Wire up untilEvent: if the caller requested "run until an event of type X",
    // subscribe to the bus and stop the loop on the next matching emit. The
    // subscription is torn down when the run finishes so subsequent runs
    // aren't affected.
    let untilUnsubscribe: (() => void) | undefined;
    let untilTripped = false;
    if (runOpts.untilEvent) {
      const target = runOpts.untilEvent;
      untilUnsubscribe = this.events.subscribe((event) => {
        if (event.type === target) {
          untilTripped = true;
          this.running = false;
        }
      });
    }

    try {
      while (this.running && this.world.currentTick < maxTick) {
        if (this.paused) {
          await sleep(100);
          continue;
        }

        await this.runSingleTick();

        if (untilTripped) break;

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
      untilUnsubscribe?.();
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

    // Build observations. Durable memory is no longer attached here —
    // it lives in each character's memory.md file and is injected into
    // the system prompt at session start (see AgentPool.hydrate).
    const liveAgents = await this.store.getLiveAgents(this.world.id);
    const observations = new Map<string, Observation>();
    for (const agent of liveAgents) {
      observations.set(agent.id, await this.observations.build(agent, nextTick));
    }

    // Activation pre-filter (ADR-0010). Any agent the filter declines
    // is skipped for this tick — no LLM call — and a cheap
    // `agent_dormant` event records the skip for replay + dashboards.
    //
    // Snapshot semantics note: this runs BEFORE `proposals.settlePending`
    // below. An agent whose group membership is granted by a proposal
    // adopted this tick won't see the `pending_vote` signal until the
    // NEXT tick's pre-filter pass. That's deliberate — it mirrors how
    // other "state change during tick" effects propagate (observations
    // are also built against the pre-tick snapshot).
    const activations = await Promise.all(
      liveAgents.map((a) => this.activation.shouldActivate(a, nextTick)),
    );
    const active: Agent[] = [];
    for (let i = 0; i < liveAgents.length; i++) {
      const a = liveAgents[i]!;
      const decision = activations[i]!;
      if (decision.active) {
        active.push(a);
      } else {
        await this.store.recordEvent({
          worldId: this.world.id,
          tick: nextTick,
          eventType: 'agent_dormant',
          actorId: a.id,
          data: { reason: decision.reason },
          tokenCost: 0,
        });
      }
    }

    // Parallel decisions (active agents see same snapshot)
    const results = await Promise.all(
      active.map((a) =>
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
        const agent = active.find((a) => a.id === result.agentId)!;
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
      // Persist updated agent state. We stamp `lastActiveTick` here for
      // every active turn, action or not — the agent was given the
      // floor, that resets the dormancy clock regardless of whether
      // they produced a visible action.
      await this.store.updateAgentState(result.agentId, {
        sessionStateBlob: result.historyBlob,
        tokensSpent: result.tokensSpent,
        lastActiveTick: nextTick,
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

    // Settle any pending proposals whose deadline / procedure-trigger
    // has fired this tick. Adopted proposals execute their effects
    // through the same EffectRegistry god interventions use, so a
    // create_rule or grant_authority applied here invalidates the
    // enforcer cache just like a god-effect would.
    const settled = await this.proposals.settlePending(this.world, nextTick);
    if (settled.some((s) => s.status === 'adopted')) {
      this.ruleEnforcer.invalidateCache();
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
