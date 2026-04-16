/**
 * GodService — user (god) interventions.
 *
 * Users queue natural-language events: "a storm hits" / "the stranger returns".
 * On each tick, interventions queued for that tick (or earlier and unapplied)
 * get translated into concrete effects and applied.
 *
 * For v0.1, effects are:
 *   - Broadcast the description as an event visible to all live agents
 *   - Optionally parse structured effects via LLM (future)
 */

import type { GodIntervention, World } from '@chronicle/core';
import type { WorldStore } from '../store.js';

export class GodService {
  constructor(private store: WorldStore) {}

  async queue(world: World, description: string, applyAtTick?: number): Promise<number> {
    const queuedTick = world.currentTick;
    const effectiveTick = applyAtTick ?? queuedTick + 1;
    return this.store.queueIntervention({
      worldId: world.id,
      queuedTick,
      applyAtTick: effectiveTick,
      description,
      compiledEffects: null,
      notes: null,
    });
  }

  async getQueuedFor(worldId: string, tick: number): Promise<GodIntervention[]> {
    return this.store.getPendingInterventions(worldId, tick);
  }

  async applyEffects(world: World, iv: GodIntervention): Promise<void> {
    const agents = await this.store.getLiveAgents(world.id);
    const visibleTo = agents.map((a) => a.id);
    await this.store.recordEvent({
      worldId: world.id,
      tick: world.currentTick,
      eventType: 'god_intervention',
      actorId: null,
      data: { description: iv.description, compiled: iv.compiledEffects },
      visibleTo,
      tokenCost: 0,
    });
  }

  async markApplied(id: number): Promise<void> {
    await this.store.markInterventionApplied(id);
  }
}
