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
};

export class DramaDetector {
  constructor(private store: WorldStore) {}

  async scoreRecentTicks(world: World, windowTicks: number): Promise<number> {
    const from = Math.max(0, world.currentTick - windowTicks);
    const events = await this.store.getEventsInRange(world.id, from, world.currentTick);

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
