/**
 * ActivationService — deterministic pre-filter deciding, each tick,
 * which agents deserve a full `takeTurn` call vs. should be skipped.
 *
 * See `docs/adr/0010-agent-activation.md` for rationale. The short
 * version: running every agent every tick is O(N·T) LLM calls even
 * when nothing relevant happened to them, which is both expensive
 * and bad for pacing. This service checks a handful of cheap
 * signals and, if none fire, marks the agent dormant for the tick.
 *
 * Invariants:
 *  - Pure function of (agent, world, DB state). No wall-clock, no
 *    Math.random, no network — everything must be replayable.
 *  - `reason` strings are stable and machine-parseable. They land in
 *    the `agent_dormant` event log and dashboards key off them.
 *  - Cost per call is bounded by (# recent events) + (# groups the
 *    agent is in × # pending proposals per group), typically under
 *    10 DB reads. A full takeTurn is ~1 LLM round-trip and dwarfs
 *    this, so even modest dormancy rates win.
 */

import type { ActivationConfig, Agent, Event, World } from '@chronicle/core';
import type { WorldStore } from '../store.js';

export interface ActivationDecision {
  active: boolean;
  /**
   * Stable machine-parseable tag explaining the choice:
   *   active:   'witnessed' | 'pending_vote' | 'idle_timeout' | 'first_tick'
   *   dormant:  'no_signal'
   * Additional reason tags may be added over time; always prefix the
   * discriminator first for easy parsing.
   */
  reason: string;
}

/**
 * Pluggable activation interface. The engine consumes this; the
 * default `ActivationService` implements the 5 MVP signals. Users
 * can inject their own implementation via EngineOptions to swap in
 * ML-based or scenario-specific activation without touching the
 * tick loop.
 */
export interface AgentActivation {
  shouldActivate(agent: Agent, tick: number): Promise<ActivationDecision>;
}

const DEFAULT_CONFIG: ActivationConfig = {
  idleTimeout: 5,
  lookbackTicks: 2,
};

export class ActivationService implements AgentActivation {
  private readonly config: ActivationConfig;

  constructor(
    private store: WorldStore,
    private world: World,
  ) {
    const override = world.config.activation;
    this.config = {
      idleTimeout: override?.idleTimeout ?? DEFAULT_CONFIG.idleTimeout,
      lookbackTicks: override?.lookbackTicks ?? DEFAULT_CONFIG.lookbackTicks,
    };
    // Input validation — bad world configs would degrade silently.
    // Only `Infinity` is documented as a disabler; anything else
    // non-positive is almost certainly a mistake.
    if (this.config.idleTimeout !== Number.POSITIVE_INFINITY && this.config.idleTimeout <= 0) {
      throw new Error(
        `ActivationService: idleTimeout must be a positive number or Infinity (got ${this.config.idleTimeout})`,
      );
    }
    if (!Number.isFinite(this.config.lookbackTicks) || this.config.lookbackTicks < 0) {
      throw new Error(
        `ActivationService: lookbackTicks must be a non-negative finite number (got ${this.config.lookbackTicks})`,
      );
    }
  }

  async shouldActivate(agent: Agent, tick: number): Promise<ActivationDecision> {
    // First-tick escape: a newborn agent gets one turn regardless of
    // signal, so they can at least observe their world.
    if (agent.lastActiveTick == null) {
      return { active: true, reason: 'first_tick' };
    }

    // Signal 1+2: witnessed event in the lookback window.
    // (`directed_speech` is a subset of `witnessed` — a whisper's
    // `visibleTo` includes the target; a targeted speak's audience
    // includes them too. We don't need a separate lookup.)
    const since = Math.max(0, tick - this.config.lookbackTicks);
    const recent = await this.store.getEventsInRange(this.world.id, since, tick);
    if (this.anyWitnessedBy(recent, agent)) {
      return { active: true, reason: 'witnessed' };
    }

    // Signal 3: a pending proposal in any of the agent's groups
    // where they haven't cast a vote. A councillor never misses
    // their chance to vote.
    if (await this.hasUncastGroupVote(agent)) {
      return { active: true, reason: 'pending_vote' };
    }

    // Signal 4: idle timeout. `idleTimeout = Infinity` disables this
    // signal entirely — pure reactive mode.
    if (
      Number.isFinite(this.config.idleTimeout) &&
      tick - agent.lastActiveTick >= this.config.idleTimeout
    ) {
      return { active: true, reason: 'idle_timeout' };
    }

    return { active: false, reason: 'no_signal' };
  }

  // ============================================================
  // Signal implementations
  // ============================================================

  private anyWitnessedBy(events: Event[], agent: Agent): boolean {
    for (const e of events) {
      // The agent's own actions should not retrigger them. A
      // speaker shouldn't re-activate on the back of their own speech.
      if (e.actorId === agent.id) continue;

      // Engine-wide convention (see perception/observation.ts): an
      // event whose `visibleTo` is empty / absent is public — it
      // propagates to everyone. A non-empty `visibleTo` is a
      // whitelist; the agent must be in it to witness.
      const vis = e.visibleTo;
      if (!vis || vis.length === 0) return true;
      if (vis.includes(agent.id)) return true;
    }
    return false;
  }

  private async hasUncastGroupVote(agent: Agent): Promise<boolean> {
    // Single indexed query via WorldStore.hasUncastGroupVote. We used
    // to walk memberships → proposals → votes serially (O(M·P) round
    // trips); one LEFT JOIN on (proposals ⋈ memberships) LEFT ANTI
    // (votes) collapses that to a constant.
    return this.store.hasUncastGroupVote(agent.id);
  }
}
