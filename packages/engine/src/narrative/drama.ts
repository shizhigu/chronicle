/**
 * DramaDetector — scores recent-tick drama for catalyst triggering + highlight reels.
 *
 * Simple heuristic-based score. No LLM call. Fast.
 *
 * Drama-event weights:
 *   action (plain)        0.1
 *   speech (neutral)      0.2
 *   speech (angry/shout)  0.8
 *   rule_violation        1.0
 *   death                 2.0
 *   birth                 1.0
 *   god_intervention      0.5
 *   agent_reflection      0.1
 *   catalyst              0.6
 *
 * Final score: sum / tickWindow, clamped to [0,1].
 */

import type { World } from '@chronicle/core';
import type { WorldStore } from '../store.js';

const WEIGHTS: Record<string, number> = {
  action: 0.1,
  speech_neutral: 0.2,
  speech_angry: 0.8,
  speech_shouted: 0.8,
  speech_whispered: 0.3,
  rule_violation: 1.0,
  death: 2.0,
  birth: 1.0,
  god_intervention: 0.5,
  agent_reflection: 0.1,
  catalyst: 0.6,
  tick_begin: 0,
  tick_end: 0,
  // Non-events. An agent being dormant or producing no tool call is
  // the ABSENCE of drama. Previously these fell through to the 0.1
  // default, so a totally silent run steadily drifted upward toward
  // the catalyst threshold for no reason.
  agent_dormant: 0,
  agent_silent: 0,
  // Governance lifecycle moments — narratively meaningful, but not
  // as high-stakes as death/violence. Hand-tuned so a council vote
  // reads as dramatic punctuation rather than as noise.
  proposal_opened: 0.3,
  proposal_adopted: 0.6,
  proposal_rejected: 0.6,
  proposal_expired: 0.2,
  proposal_withdrawn: 0.2,
  vote_cast: 0.2,
};

export class DramaDetector {
  constructor(private store: WorldStore) {}

  /**
   * Score drama over the last `windowTicks` ticks ending at
   * `upToTick` (inclusive). Callers that want to score the
   * just-completed tick MUST pass its tick number — the engine's
   * `runSingleTick` records tick-N events but hasn't advanced
   * `world.currentTick` yet at the drama-check point, so relying on
   * `world.currentTick` silently excludes the current tick's events
   * from the window.
   */
  async scoreRecentTicks(
    world: World,
    windowTicks: number,
    upToTick: number = world.currentTick,
  ): Promise<number> {
    const from = Math.max(0, upToTick - windowTicks);
    const events = await this.store.getEventsInRange(world.id, from, upToTick);

    let total = 0;
    for (const e of events) {
      const key = e.eventType === 'action' ? this.speechSubtype(e.data) : e.eventType;
      total += WEIGHTS[key] ?? 0.1;
    }
    const normalized = Math.min(1, total / (windowTicks * 0.5));
    return normalized;
  }

  private speechSubtype(data: Record<string, unknown>): string {
    if (data.action === 'speak') {
      const tone = (data.args as any)?.tone ?? 'neutral';
      return `speech_${tone}`;
    }
    return 'action';
  }
}
